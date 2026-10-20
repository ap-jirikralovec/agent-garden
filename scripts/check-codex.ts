// An optional integration smoke check. It creates no turns and uses no inference.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRpc } from '../src/server/providers/codex/rpc.js';
import { AgentStore } from '../src/server/store.js';
import { CodexProvider } from '../src/server/providers/codex/index.js';
import { Garden } from '../src/server/garden.js';
import type { Thread } from '../src/server/providers/codex/protocol.js';

if (process.argv.includes('--shared')) {
  const shared = new CodexRpc();
  try {
    await shared.connect();
    const catalog = await shared.request<{ data: unknown[] }>('model/list', { limit: 100 });
    console.log(
      `Connected to the shared Codex server (${catalog.data.length} models). No task or inference requested.`,
    );
  } finally {
    await shared.close();
  }
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), 'garden-codex-check-'));
const home = join(directory, 'codex');
await mkdir(home);
const makeRpc = () =>
  new CodexRpc({
    args: ['app-server', '--stdio'],
    transport: 'stdio',
    startDaemon: false,
    env: { ...process.env, CODEX_HOME: home },
  });
let rpc = makeRpc();
const opened: string[] = [];
const store = new AgentStore(join(directory, 'garden'));
await store.load();
const makeGarden = () =>
  new Garden(store, [
    new CodexProvider(rpc, {
      async open(id) {
        opened.push(id);
      },
    }),
  ]);
let garden = makeGarden();
try {
  await garden.refresh();
  const config = garden.snapshot().providers[0].configuration!;
  const model = config.models.find((model) => model.id === config.defaultModel) ?? config.models[0];
  assert.ok(model, 'Codex must expose a model catalog');
  const effort =
    model.reasoningLevels.find((option) => option.id !== model.defaultReasoning)?.id ??
    model.defaultReasoning;
  const { agent, warning } = await garden.create({
    provider: 'codex',
    name: 'Miso smoke check',
    project: directory,
    model: model.id,
    reasoning: effort,
  });
  assert.equal(warning, null);
  await garden.open(agent.id);
  assert.deepEqual(opened, [agent.id, agent.id]);
  await garden.refresh();
  assert.equal(garden.snapshot().agents[0].status, 'idle');
  assert.equal(garden.snapshot().agents[0].workersError, null);
  assert.deepEqual(garden.snapshot().agents[0].workers, []);
  // Create directly through Codex, bypassing Garden's creation path.
  const external = await rpc.request<{ thread: Thread }>('thread/start', {
    cwd: directory,
    model: model.id,
    ...(effort === null ? {} : { config: { model_reasoning_effort: effort } }),
  });
  await rpc.request('thread/name/set', {
    threadId: external.thread.id,
    name: 'External smoke check',
  });
  const externalPreset = await rpc.request<{ thread: Thread }>('thread/read', {
    threadId: external.thread.id,
  });
  const loadedBefore = await rpc.request<{ data: string[] }>('thread/loaded/list', { limit: 100 });
  await garden.refresh();
  assert.equal(
    store.list().find((item) => item.sessionId === external.thread.id)?.origin,
    'external',
  );
  assert.equal(garden.snapshot().agents.length, 1, 'External agents are hidden by default');
  await garden.setShowExternalAgents(true);
  assert.equal(garden.snapshot().agents.length, 2);
  await garden.setShowExternalAgents(false);
  assert.equal(garden.snapshot().agents.length, 1);
  const externalAfterDiscovery = await rpc.request<{ thread: Thread }>('thread/read', {
    threadId: external.thread.id,
  });
  assert.equal(externalAfterDiscovery.thread.model, externalPreset.thread.model);
  assert.equal(
    externalAfterDiscovery.thread.reasoningEffort,
    externalPreset.thread.reasoningEffort,
  );
  const loadedAfter = await rpc.request<{ data: string[] }>('thread/loaded/list', { limit: 100 });
  assert.deepEqual(
    loadedAfter.data.sort(),
    loadedBefore.data.sort(),
    'Discovery must not load or unload sessions',
  );
  const read = await rpc.request<{ thread: Thread & { name: string } }>('thread/read', {
    threadId: agent.sessionId,
  });
  assert.equal(read.thread.name, 'Miso smoke check');
  assert.equal(read.thread.reasoningEffort, effort);
  await garden.stop();
  rpc = makeRpc();
  await rpc.connect();
  const saved = await rpc.request<{ thread: Thread }>('thread/read', { threadId: agent.sessionId });
  assert.equal(saved.thread.id, agent.sessionId);
  assert.equal(saved.thread.status.type, 'notLoaded');
  garden = makeGarden();
  await garden.refresh();
  await garden.open(agent.id);
  assert.deepEqual(opened, [agent.id, agent.id, agent.id]);
  // A normal terminal resume sends no model/reasoning override. It must retain
  // the preset loaded by Garden, including an effort different from the default.
  const resumed = await rpc.request<{ thread: Thread }>('thread/resume', {
    threadId: agent.sessionId,
    excludeTurns: true,
  });
  assert.equal(resumed.thread.id, agent.sessionId);
  assert.equal(resumed.thread.model, model.id);
  assert.equal(resumed.thread.reasoningEffort, effort);
  const turns = await rpc.request<{ data: unknown[] }>('thread/turns/list', {
    threadId: agent.sessionId,
    limit: 1,
    itemsView: 'full',
  });
  assert.equal(turns.data.length, 0, 'Opening and monitoring must not submit a task');
  const externalCold = await rpc.request<{ thread: Thread }>('thread/read', {
    threadId: external.thread.id,
  });
  const externalCard = store.list().find((item) => item.sessionId === external.thread.id)!;
  await store.update(externalCard.id, { model: 'stale-garden-model', reasoning: 'low' });
  await garden.open(externalCard.id).catch((error) => {
    throw new Error('External cold reopening failed', { cause: error });
  });
  const externalReopened = await rpc.request<{ thread: Thread }>('thread/read', {
    threadId: external.thread.id,
  });
  // Empty Codex threads may retain their title/identity without persisted
  // settings. In that case native resume chooses Codex defaults, never Garden's cache.
  if (externalCold.thread.model !== null && externalCold.thread.model !== undefined)
    assert.equal(externalReopened.thread.model, externalCold.thread.model);
  else assert.notEqual(externalReopened.thread.model, 'stale-garden-model');
  if (
    externalCold.thread.reasoningEffort !== null &&
    externalCold.thread.reasoningEffort !== undefined
  )
    assert.equal(externalReopened.thread.reasoningEffort, externalCold.thread.reasoningEffort);
  const externalTurns = await rpc.request<{ data: unknown[] }>('thread/turns/list', {
    threadId: external.thread.id,
    limit: 1,
    itemsView: 'full',
  });
  assert.equal(externalTurns.data.length, 0, 'External reopening must not submit a task');
  console.log(
    'Codex smoke check passed: model catalog, preset, named session, exact-ID reopening, idle monitoring, saved history, resumption, read-only external discovery, global visibility and external cold reopening. No inference requested.',
  );
} finally {
  await garden.stop();
  await rpc.close();
  await rm(directory, { recursive: true, force: true });
}
