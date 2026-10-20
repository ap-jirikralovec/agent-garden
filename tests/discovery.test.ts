import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexProvider } from '../src/server/providers/codex';
import { AgentStore } from '../src/server/store';
import { Garden } from '../src/server/garden';
import type { Rpc, Thread } from '../src/server/providers/codex/protocol';
import type { Agent } from '../src/shared/types';

const folders: string[] = [];
async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'garden-discovery-'));
  folders.push(folder);
  const path = await realpath(folder);
  const store = new AgentStore(join(path, 'metadata'));
  await store.load();
  await store.addProject(path);
  return { path, store };
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});
function rpcFor(threads: Thread[]) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const rpc: Rpc = {
    connected: true,
    async connect() {},
    async close() {},
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === 'model/list') return { data: [] } as T;
      if (method === 'thread/loaded/list')
        return { data: threads.map((thread) => thread.id), nextCursor: null } as T;
      if (method === 'thread/read')
        return { thread: threads.find((thread) => thread.id === params.threadId) } as T;
      if (method === 'thread/turns/list' || method === 'thread/list')
        return { data: [], nextCursor: null } as T;
      return {} as T;
    },
  };
  return { rpc, calls };
}
function thread(cwd: string, extra: Partial<Thread> = {}): Thread {
  return {
    id: randomUUID(),
    cwd,
    preview: 'Work from outside Garden',
    name: 'External work',
    model: 'actual-model',
    reasoningEffort: 'high',
    status: { type: 'idle' },
    source: 'cli',
    ...extra,
  };
}

it('discovers only loaded top-level sessions in exact saved projects, without touching conversations', async () => {
  const { path } = await setup();
  await mkdir(join(path, 'child'));
  const wanted = thread(path);
  const threads = [
    wanted,
    thread(path + '/child'),
    thread('/another/project'),
    thread(path, { status: { type: 'notLoaded' } }),
    thread(path, { source: { subAgent: { thread_spawn: { parent_thread_id: wanted.id } } } }),
    thread(path, { parentThreadId: wanted.id }),
    thread(path, { source: { subAgent: 'review' } }),
  ];
  const { rpc, calls } = rpcFor(threads);
  const provider = new CodexProvider(rpc, { async open() {} });
  const result = await provider.discoverSessions([path], []);
  expect(result.sessions.map((session) => session.sessionId)).toEqual([wanted.id]);
  expect(result.sessions[0]).toMatchObject({
    model: 'actual-model',
    reasoning: 'high',
    name: wanted.name,
  });
  expect(calls.every((call) => ['thread/loaded/list', 'thread/read'].includes(call.method))).toBe(
    true,
  );
  expect((await provider.discoverSessions([path], [wanted.id])).sessions).toEqual([]);
});

it('persists origin, defaults external visibility off, deduplicates and remembers removal across restart', async () => {
  const { path, store } = await setup();
  const external = thread(path);
  const { rpc, calls } = rpcFor([external]);
  const garden = new Garden(store, [new CodexProvider(rpc, { async open() {} })]);
  await garden.refresh();
  expect(store.list()).toHaveLength(1);
  expect(store.list()[0]).toMatchObject({ origin: 'external', sessionId: external.id });
  expect(garden.snapshot().settings.showExternalAgents).toBe(false);
  await garden.refresh();
  expect(store.list()).toHaveLength(1);
  await garden.setShowExternalAgents(true);
  const reloaded = new AgentStore(store.directory);
  await reloaded.load();
  expect(reloaded.showExternalAgents()).toBe(true);
  expect(reloaded.list()[0].origin).toBe('external');
  await garden.remove(store.list()[0].id);
  const restarted = new AgentStore(store.directory);
  await restarted.load();
  const next = new Garden(restarted, [new CodexProvider(rpc, { async open() {} })]);
  await next.refresh();
  expect(restarted.list()).toEqual([]);
  expect(calls.some((call) => /resume|start|name\/set/.test(call.method))).toBe(false);
});

it('does not restore a Garden preset when opening an unloaded external session', async () => {
  const { path } = await setup();
  const external = thread(path, { status: { type: 'notLoaded' } });
  const { rpc, calls } = rpcFor([external]);
  const opened: string[] = [];
  const provider = new CodexProvider(rpc, {
    async open(id) {
      opened.push(id);
    },
  });
  await provider.openTerminal({
    id: randomUUID(),
    provider: 'codex',
    origin: 'external',
    sessionId: external.id,
    project: path,
    model: 'old-model',
    reasoning: 'low',
  } as Agent);
  expect(calls.find((call) => call.method === 'thread/resume')?.params).toEqual({
    threadId: external.id,
    excludeTurns: true,
  });
  expect(opened).toHaveLength(1);
});

it('hides external cards by default while keeping true project-removal counts, and keeps monitoring while hidden', async () => {
  const { path, store } = await setup();
  const alias = join(path, 'alias');
  await symlink(path, alias);
  const external = thread(alias, {
    status: { type: 'active', activeFlags: ['waitingOnApproval'] },
  });
  const { rpc } = rpcFor([external]);
  const garden = new Garden(store, [new CodexProvider(rpc, { async open() {} })]);
  await garden.refresh();
  expect(garden.snapshot().agents).toEqual([]);
  expect(garden.snapshot().projects[0].agentCount).toBe(1);
  expect(store.list()[0].status).toBe('waiting');
  expect(store.listProjects().map((project) => project.path)).toEqual([path]);
  await garden.setShowExternalAgents(true);
  expect(garden.snapshot().agents).toHaveLength(1);
  await garden.setShowExternalAgents(false);
  external.status = { type: 'idle' };
  await garden.refresh();
  expect(store.list()[0].status).toBe('idle');
  expect(garden.snapshot().agents).toEqual([]);
  await expect(garden.removeProject(path)).rejects.toThrow('Remove its agents');
  await garden.setShowExternalAgents(true);
  expect(garden.snapshot().agents[0].origin).toBe('external');
  external.status = { type: 'notLoaded' };
  await garden.refresh();
  expect(garden.snapshot().agents[0].connection).toBe('disconnected');
  expect(store.list()).toHaveLength(1);
});

it.each(['disable', 'remove-project'] as const)(
  'discards pending discovery after %s',
  async (action) => {
    const { path, store } = await setup();
    const external = thread(path);
    const { rpc } = rpcFor([external]);
    const request = rpc.request.bind(rpc);
    let release!: (value: { data: string[]; nextCursor: null }) => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    rpc.request = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      if (method !== 'thread/loaded/list') return request<T>(method, params);
      started();
      return new Promise<{ data: string[]; nextCursor: null }>((resolve) => {
        release = resolve;
      }) as Promise<T>;
    };
    const garden = new Garden(store, [new CodexProvider(rpc, { async open() {} })]);
    const refresh = garden.refresh();
    await pending;
    const changed =
      action === 'disable' ? garden.setProviderEnabled('codex', false) : garden.removeProject(path);
    if (action === 'remove-project') await changed;
    release({ data: [external.id], nextCursor: null });
    await Promise.all([refresh, changed]);
    expect(store.list()).toEqual([]);
    if (action === 'remove-project') expect(store.listProjects()).toEqual([]);
  },
);

it('paginates discovery, excludes already tracked identities and reports bounded truncation', async () => {
  const { path } = await setup();
  const threads = Array.from({ length: 201 }, () => thread(path));
  const { rpc } = rpcFor(threads);
  const request = rpc.request.bind(rpc);
  const cursors: unknown[] = [];
  rpc.request = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (method !== 'thread/loaded/list') return request<T>(method, params);
    cursors.push(params.cursor);
    const offset = params.cursor ? Number(params.cursor) : 0;
    return {
      data: threads.slice(offset, offset + 100).map((thread) => thread.id),
      nextCursor: String(offset + 100),
    } as T;
  };
  const provider = new CodexProvider(rpc, { async open() {} });
  const result = await provider.discoverSessions([path], [threads[0].id]);
  expect(cursors).toEqual([null, '100']);
  expect(result.sessions).toHaveLength(199);
  expect(result.sessions.some((session) => session.sessionId === threads[0].id)).toBe(false);
  expect(result.warning).toContain('200');
});

it('reports discovery failure separately while continuing to observe tracked cards', async () => {
  const { path, store } = await setup();
  const tracked = thread(path);
  await store.put({
    id: randomUUID(),
    origin: 'garden',
    provider: 'codex',
    sessionId: tracked.id,
    name: 'Garden name',
    project: path,
    model: 'saved',
    reasoning: 'medium',
    task: '',
    status: 'working',
    connection: 'disconnected',
    detail: null,
    lastSeen: null,
    createdAt: new Date().toISOString(),
  });
  const { rpc } = rpcFor([tracked]);
  const provider = new CodexProvider(rpc, { async open() {} });
  provider.discoverSessions = async () => {
    throw new Error('Discovery unavailable');
  };
  const garden = new Garden(store, [provider]);
  await garden.refresh();
  expect(store.list()[0]).toMatchObject({
    origin: 'garden',
    name: 'Garden name',
    status: 'idle',
    connection: 'connected',
  });
  expect(garden.snapshot().providers[0]).toMatchObject({
    error: null,
    connection: 'connected',
    discoveryError: 'Discovery unavailable',
  });
});

it('does not create saved projects when an external session moves outside the saved folders', async () => {
  const { path, store } = await setup();
  const external = thread(path);
  const { rpc } = rpcFor([external]);
  const garden = new Garden(store, [new CodexProvider(rpc, { async open() {} })]);
  await garden.refresh();
  await garden.setShowExternalAgents(true);
  external.cwd = '/another/project';
  await garden.refresh();
  expect(store.listProjects().map((project) => project.path)).toEqual([path]);
  expect(store.list()).toHaveLength(1);
  expect(garden.snapshot().agents).toEqual([]);
  external.cwd = path;
  await garden.refresh();
  expect(garden.snapshot().agents).toHaveLength(1);
});

it('keeps Garden provenance when its own creation overlaps discovery, and suppresses removed Garden sessions too', async () => {
  const { path, store } = await setup();
  const native = thread(path);
  const { rpc } = rpcFor([native]);
  const request = rpc.request.bind(rpc);
  rpc.request = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (method === 'model/list')
      return {
        data: [
          {
            model: 'actual-model',
            displayName: 'Actual model',
            isDefault: true,
            defaultReasoningEffort: 'high',
            supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
          },
        ],
      } as T;
    if (method === 'thread/start') return { thread: native } as T;
    return request<T>(method, params);
  };
  let started!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = new CodexProvider(rpc, { async open() {} });
  let discovering = false;
  provider.discoverSessions = async () => {
    if (!discovering) return { sessions: [], warning: null };
    started();
    await released;
    return {
      sessions: [
        {
          sessionId: native.id,
          name: 'External title',
          project: path,
          model: 'actual-model',
          reasoning: 'high',
          createdAt: new Date().toISOString(),
        },
      ],
      warning: null,
    };
  };
  const garden = new Garden(store, [provider]);
  await garden.refresh();
  discovering = true;
  const refresh = garden.refresh();
  await pending;
  const { agent } = await garden.create({
    provider: 'codex',
    name: 'My Garden name',
    project: path,
    model: 'actual-model',
    reasoning: 'high',
  });
  release();
  await refresh;
  expect(store.list()).toHaveLength(1);
  expect(store.list()[0]).toMatchObject({ id: agent.id, name: 'My Garden name', origin: 'garden' });
  await garden.remove(agent.id);
  await garden.refresh();
  expect(store.list()).toEqual([]);
});

it('enforces the existing 50-card limit and makes discovery truncation visible without disconnecting the provider', async () => {
  const { path, store } = await setup();
  const threads = Array.from({ length: 51 }, () => thread(path));
  const { rpc } = rpcFor(threads);
  const garden = new Garden(store, [new CodexProvider(rpc, { async open() {} })]);
  await garden.refresh();
  expect(store.list()).toHaveLength(50);
  expect(garden.snapshot().agents).toEqual([]);
  expect(garden.snapshot().providers[0]).toMatchObject({ connection: 'connected', error: null });
  expect(garden.snapshot().providers[0].discoveryError).toContain('50');
});
