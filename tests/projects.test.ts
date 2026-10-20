import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentStore } from '../src/server/store';
import type { Agent } from '../src/shared/types';

const folders: string[] = [];
async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'garden-projects-'));
  folders.push(directory);
  const store = new AgentStore(directory);
  await store.load();
  return store;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function agent(project: string): Agent {
  return {
    id: randomUUID(),
    provider: 'codex',
    sessionId: randomUUID(),
    name: 'Miso',
    project,
    model: 'test',
    reasoning: null,
    status: 'idle',
    task: '',
    connection: 'connected',
    lastSeen: null,
    detail: null,
    createdAt: new Date().toISOString(),
  };
}

it('persists independent projects, deduplicates paths and retains names when adding agents', async () => {
  const original = await store();
  await original.addProject('/work/app');
  await original.renameProject('/work/app', 'My application');
  await original.addProject('/work/app');
  const item = agent('/work/app');
  await original.put(item);
  await expect(original.removeProject('/work/app')).rejects.toThrow('Remove its agents');
  await original.remove(item.id);
  const reloaded = new AgentStore(original.directory);
  await reloaded.load();
  expect(reloaded.listProjects()).toEqual([{ path: '/work/app', name: 'My application' }]);
  await reloaded.removeProject('/work/app');
  expect(reloaded.listProjects()).toEqual([]);
});

it.each([1, 2])(
  'migrates version %i agent folders and durably retains them after the last card is removed',
  async (version) => {
    const original = await store();
    const item = { ...agent('/work/legacy'), reasoning: 'medium' };
    await writeFile(
      join(original.directory, 'agents.json'),
      JSON.stringify({ version, agents: [item], connections: {} }),
    );
    await original.load();
    expect(original.listProjects()).toEqual([{ path: item.project, name: 'legacy' }]);
    expect(original.list()[0].id).toBe(item.id);
    await original.remove(item.id);
    const reloaded = new AgentStore(original.directory);
    await reloaded.load();
    expect(reloaded.listProjects()).toEqual(original.listProjects());
    expect(
      JSON.parse(await readFile(join(original.directory, 'agents.json'), 'utf8')).version,
    ).toBe(3);
  },
);

it('serializes project and agent writes and rejects invalid names', async () => {
  const original = await store();
  await Promise.all([original.addProject('/work/one'), original.put(agent('/work/two'))]);
  expect(original.listProjects()).toHaveLength(2);
  await expect(original.renameProject('/work/one', '   ')).rejects.toThrow('1 and 60');
  await expect(original.renameProject('/work/one', 'bad\nname')).rejects.toThrow('1 and 60');
  await expect(original.renameProject('/missing', 'Name')).rejects.toThrow('not saved');
});

it('retains both old and new projects when observation moves an agent to another folder', async () => {
  const original = await store();
  const item = agent('/work/old');
  await original.put(item);
  await original.update(item.id, { project: '/work/new' });
  await original.remove(item.id);
  const reloaded = new AgentStore(original.directory);
  await reloaded.load();
  expect(reloaded.listProjects().map((project) => project.path)).toEqual([
    '/work/old',
    '/work/new',
  ]);
});

it('preserves a malformed version 3 project file instead of overwriting it', async () => {
  const original = await store();
  const content = JSON.stringify({
    version: 3,
    agents: [],
    connections: {},
    projects: [{ path: '/work/a', name: '' }],
  });
  await writeFile(join(original.directory, 'agents.json'), content);
  await expect(original.load()).rejects.toThrow('will not overwrite');
  expect(await readFile(join(original.directory, 'agents.json'), 'utf8')).toBe(content);
});
