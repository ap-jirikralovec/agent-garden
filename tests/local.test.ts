import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentStore } from '../src/server/store.js';
import { launchScript } from '../src/server/terminal.js';
import { CodexProvider, codexCommand } from '../src/server/providers/codex/index.js';
import { Garden } from '../src/server/garden.js';
import type { Rpc, Thread } from '../src/server/providers/codex/protocol.js';
import type { Agent } from '../src/shared/types.js';

const folders: string[] = [];
const makeAgent = (): Agent => ({
  id: randomUUID(),
  origin: 'garden',
  provider: 'codex',
  sessionId: randomUUID(),
  name: 'Miso',
  project: '/tmp/project',
  model: 'gpt-6-sol',
  reasoning: 'medium',
  status: 'idle',
  task: '',
  connection: 'connected',
  detail: null,
  lastSeen: null,
  createdAt: new Date().toISOString(),
});
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('keeps concurrent session additions and reloads them as stale until verified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-store-'));
  folders.push(directory);
  const store = new AgentStore(directory);
  await store.load();
  const agents = [makeAgent(), makeAgent()];
  await Promise.all(agents.map((agent) => store.put(agent)));
  const reloaded = new AgentStore(directory);
  await reloaded.load();
  expect(
    reloaded
      .list()
      .map((agent) => agent.id)
      .sort(),
  ).toEqual(agents.map((agent) => agent.id).sort());
  expect(reloaded.list().every((agent) => agent.connection === 'disconnected')).toBe(true);
});

it('does not overwrite a corrupted metadata file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-store-'));
  folders.push(directory);
  await writeFile(join(directory, 'agents.json'), '{broken');
  await expect(new AgentStore(directory).load()).rejects.toThrow('will not overwrite');
});

it('passes a project path with quotes and shell syntax literally to the exact session', async () => {
  const agent = {
    ...makeAgent(),
    sessionId: "native'$(printf INJECTED)",
    project: "/tmp/it's a $(printf INJECTED) project",
  };
  const { stdout } = await promisify(execFile)('/bin/sh', [
    '-c',
    launchScript(codexCommand(agent, '/bin/echo', '/tmp/codex home')),
  ]);
  expect(stdout).toContain(`resume ${agent.sessionId}`);
  expect(stdout).toContain('--enable daemon_auto_start');
  expect(stdout).not.toContain('--remote');
  expect(stdout).toContain(agent.project);
  expect(stdout).not.toContain('--model');
  expect(stdout).not.toContain('model_reasoning_effort');
});

it('restores an unloaded preset only when opening, and leaves loaded sessions alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-open-'));
  folders.push(directory);
  const store = new AgentStore(directory);
  await store.load();
  const agent = makeAgent();
  await store.put(agent);
  let status: Thread['status']['type'] = 'notLoaded';
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const rpc: Rpc = {
    connected: true,
    async connect() {},
    async close() {},
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === 'model/list') return { data: [] } as T;
      if (method === 'thread/turns/list') return { data: [] } as T;
      if (method === 'thread/resume') status = 'idle';
      return {
        thread: { id: agent.id, status: { type: status }, cwd: agent.project, preview: '' },
      } as T;
    },
  };
  const garden = new Garden(store, [
    new CodexProvider(rpc, {
      async open(id) {
        opened.push(id);
      },
    }),
  ]);
  await garden.refresh();
  expect(calls.some((call) => call.method === 'thread/resume')).toBe(false);
  await garden.open(agent.id);
  expect(calls.filter((call) => call.method === 'thread/resume')).toEqual([
    {
      method: 'thread/resume',
      params: {
        threadId: agent.sessionId,
        excludeTurns: true,
        model: agent.model,
        config: { model_reasoning_effort: agent.reasoning },
      },
    },
  ]);
  calls.length = 0;
  status = 'active';
  await garden.open(agent.id);
  expect(calls.map((call) => call.method)).toEqual(['thread/read']);
  expect(opened).toEqual([agent.id, agent.id]);
});
