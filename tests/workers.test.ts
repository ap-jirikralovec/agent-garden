import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Agent, AgentWorker } from '../src/shared/types.js';
import type { Rpc, Thread, Turn } from '../src/server/providers/codex/protocol.js';
import { readCodexWorkers } from '../src/server/providers/codex/workers.js';
import { ClaudeObservations } from '../src/server/providers/claude/observation.js';
import { AgentStore } from '../src/server/store.js';
import { filterAgents } from '../src/client/agentView.js';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const parent = (): Agent => ({ id: randomUUID(), provider: 'codex', sessionId: randomUUID(), name: 'Lead', project: '/work/app', model: 'gpt-6-sol', reasoning: 'medium', task: '', status: 'working', connection: 'connected', detail: null, lastSeen: null, createdAt: new Date().toISOString() });

it('finds only Codex descendants across pages/archive states and reads workers without resuming them', async () => {
  const agent = parent();
  const child = (id: string, parentId: string, type: Thread['status']['type'] = 'active'): Thread => ({ id, source: { subAgent: { thread_spawn: { parent_thread_id: parentId } } }, agentNickname: id, status: { type, activeFlags: id === 'reviewer' ? ['waitingOnUserInput'] : [] }, cwd: agent.project, preview: 'Review changes' });
  const pages = [
    { data: [child('nested', 'reviewer')], nextCursor: 'page-two' },
    { data: [child('reviewer', agent.sessionId), child('unrelated', 'different-root')], nextCursor: null },
    { data: [child('archived-worker', agent.sessionId, 'notLoaded')], nextCursor: null },
  ];
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const rpc: Rpc = { connected: true, async connect() {}, close() {}, async request<T>(method: string, params: Record<string, unknown>) {
    calls.push({ method, params });
    if (method === 'thread/list') return pages.shift() as T;
    return { data: [{ id: 'turn', status: params.threadId === 'archived-worker' ? 'completed' : 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Check the parser' }] }] } satisfies Turn] } as T;
  } };
  const result = await readCodexWorkers(rpc, agent);
  expect(result.workers.map(worker => worker.id)).toEqual(['reviewer', 'archived-worker', 'nested']);
  expect(result.workers.find(worker => worker.id === 'reviewer')).toMatchObject({ status: 'waiting', task: 'Check the parser', connection: 'connected', parentSessionId: agent.sessionId });
  expect(result.workers.find(worker => worker.id === 'nested')?.parentSessionId).toBe('reviewer');
  expect(result.workers.find(worker => worker.id === 'archived-worker')).toMatchObject({ status: 'finished', connection: 'disconnected' });
  expect(calls.filter(call => call.method === 'thread/list').map(call => [call.params.ancestorThreadId, call.params.cursor, call.params.archived])).toEqual([[agent.sessionId, null, false], [agent.sessionId, 'page-two', false], [agent.sessionId, null, true]]);
  expect(calls.every(call => ['thread/list', 'thread/turns/list'].includes(call.method))).toBe(true);
});

it('observes Claude worker identity, waiting, completion and reactivation without altering the parent or approvals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-workers-'));
  folders.push(directory);
  const agent = { ...parent(), provider: 'claude' as const };
  const observations = new ClaudeObservations(directory);
  const settings = JSON.parse(await readFile(await observations.settings(agent.sessionId), 'utf8'));
  const emit = async (hook_event_name: string, extra: Record<string, unknown> = {}) => {
    const command = settings.hooks[hook_event_name][0].hooks[0].command;
    await new Promise<void>((resolve, reject) => {
      const child = execFile('/bin/zsh', ['-c', command], (error, stdout) => {
        if (error) reject(error); else { expect(stdout).toBe(''); resolve(); }
      });
      child.stdin!.end(JSON.stringify({ session_id: agent.sessionId, cwd: agent.project, agent_id: 'worker-native-1', agent_type: 'Reviewer', hook_event_name, ...extra }));
    });
  };
  await emit('SubagentStart');
  let workers = (await observations.workers(agent.sessionId, true, [])).workers;
  expect(workers[0]).toMatchObject({ id: 'worker-native-1', status: 'working', parentSessionId: agent.sessionId });
  await emit('PermissionRequest', { tool_name: 'Bash' });
  workers = (await observations.workers(agent.sessionId, true, workers)).workers;
  expect(workers[0].status).toBe('waiting');
  await emit('PostToolUse', { tool_name: 'Bash', tool_input: { description: 'Run parser checks' } });
  expect((await observations.workers(agent.sessionId, true, workers)).workers[0]).toMatchObject({ status: 'working', task: 'Run parser checks' });
  await emit('SubagentStop');
  workers = (await observations.workers(agent.sessionId, true, workers)).workers;
  expect(workers[0].status).toBe('finished');
  expect((await observations.workers(agent.sessionId, false, workers)).workers[0]).toMatchObject({ status: 'finished', connection: 'disconnected', lastSeen: workers[0].lastSeen });
  await emit('SubagentStart');
  expect((await observations.workers(agent.sessionId, true, workers)).workers[0]).toMatchObject({ id: 'worker-native-1', status: 'working' });
  await emit('StopFailure');
  expect((await observations.workers(agent.sessionId, true, workers)).workers[0].status).toBe('failed');
  await emit('SubagentStop', { agent_id: 'internal-only' });
  expect((await observations.workers(agent.sessionId, true, workers)).workers).toHaveLength(1);
  await emit('SubagentStart', { agent_id: '../escape' });
  expect((await observations.workers(agent.sessionId, true, workers)).workers).toHaveLength(1);
  expect(await observations.read(agent.sessionId)).toEqual([]);
});

it('persists native worker identities as stale after restart and lets worker searches find the parent card', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-workers-'));
  folders.push(directory);
  const worker: AgentWorker = { id: 'worker-exact-id', parentSessionId: 'native-root', name: 'Reviewer', project: '/work/app', model: null, task: 'Check parser', status: 'waiting', connection: 'connected', lastSeen: new Date().toISOString(), detail: null };
  const agent = { ...parent(), workers: [worker] };
  const store = new AgentStore(directory);
  await store.load(); await store.put(agent);
  const reloaded = new AgentStore(directory); await reloaded.load();
  expect(reloaded.list()[0].workers?.[0]).toEqual({ ...worker, connection: 'disconnected' });
  expect(filterAgents([agent], ['codex'], 'all', worker.id).map(agent => agent.id)).toEqual([agent.id]);
});
