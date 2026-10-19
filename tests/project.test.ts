import { afterEach, expect, it } from 'vitest';
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkProject } from '../src/server/project.js';
import { CodexProvider } from '../src/server/providers/codex/index.js';
import { Garden } from '../src/server/garden.js';
import { AgentStore } from '../src/server/store.js';
import type { Rpc } from '../src/server/providers/codex/protocol.js';

const folders: string[] = [];
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'garden-project-'));
  folders.push(path);
  return path;
}
afterEach(async () => { await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('checks existing and missing folders without creating anything', async () => {
  const directory = await folder();
  expect(await checkProject(directory)).toEqual({ path: await realpath(directory), exists: true });
  const missing = join(directory, 'parent', 'new project');
  expect(await checkProject(missing)).toEqual({ path: missing, exists: false });
  await expect(access(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(checkProject('relative/path')).rejects.toThrow('absolute');
});

it('requires confirmation and creates missing parents before starting the session', async () => {
  const directory = await folder();
  const project = join(directory, 'parent', 'new project');
  const store = new AgentStore(join(directory, 'metadata'));
  await store.load();
  const started: string[] = [];
  const opened: string[] = [];
  const rpc: Rpc = {
    connected: true, async connect() {}, async close() {},
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === 'model/list') return { data: [{
        model: 'test-model', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
      }] } as T;
      if (method === 'thread/start') {
        expect(await realpath(project)).toBe(params.cwd);
        started.push(params.cwd as string);
        return { thread: { id: randomUUID() } } as T;
      }
      if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' }, cwd: project, preview: '' } } as T;
      return {} as T;
    },
  };
  const garden = new Garden(store, [new CodexProvider(rpc, { async open(id) { opened.push(id); } })]);
  await garden.refresh();
  const input = { provider: 'codex' as const, name: 'Miso', project, model: 'test-model', reasoning: 'medium' };
  await expect(garden.create(input)).rejects.toThrow('Confirm creation');
  await expect(access(project)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(started).toEqual([]);
  const { agent } = await garden.create({ ...input, createProject: true });
  expect(started).toEqual([await realpath(project)]);
  expect(agent.project).toBe(await realpath(project));
  expect(opened).toEqual([agent.id]);
});

it('rejects file paths and paths beneath files instead of offering folder creation', async () => {
  const directory = await folder();
  const file = join(directory, 'file');
  await writeFile(file, 'keep me');
  await expect(checkProject(file)).rejects.toThrow('not a folder');
  await expect(checkProject(join(file, 'child'))).rejects.toThrow('not a folder');
});
