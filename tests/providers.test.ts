import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentStore } from '../src/server/store.js';
import { Garden } from '../src/server/garden.js';
import type { Agent, ProviderConfiguration, ProviderId } from '../src/shared/types.js';
import type {
  AgentObservation,
  AgentProvider,
  SessionPreset,
} from '../src/server/providers/provider.js';

const folders: string[] = [];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'garden-providers-'));
  folders.push(directory);
  const store = new AgentStore(directory);
  await store.load();
  return { directory, store };
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class FakeProvider implements AgentProvider {
  enabled = true;
  connected = false;
  connections = 0;
  opened: Agent[] = [];
  prompts: (string | undefined)[] = [];
  started: { agent: Agent; prompt: string }[] = [];
  presets: SessionPreset[] = [];
  fail = false;
  constructor(
    readonly id: ProviderId,
    readonly name: string,
    readonly config: ProviderConfiguration,
  ) {}
  async connect() {
    this.connections++;
    if (this.fail) throw new Error(`${this.name} offline`);
    this.connected = true;
  }
  async configuration() {
    return this.config;
  }
  async close() {
    this.connected = false;
  }
  async createSession(preset: SessionPreset) {
    this.presets.push(preset);
    return { sessionId: 'same-native-session', warning: null };
  }
  async openTerminal(agent: Agent, initialPrompt?: string) {
    this.opened.push(agent);
    this.prompts.push(initialPrompt);
  }
  async startTask(agent: Agent, prompt: string) {
    this.started.push({ agent, prompt });
  }
  async readSession(agent: Agent): Promise<AgentObservation> {
    return {
      project: agent.project,
      model: agent.model,
      reasoning: agent.reasoning,
      task: 'Observed task',
      status: 'finished',
      connection: 'connected',
      detail: null,
      lastSeen: 'fresh',
    };
  }
}
const config = (id: string, effort: string | null): ProviderConfiguration => ({
  defaultModel: id,
  models: [
    {
      id,
      name: id,
      defaultReasoning: effort,
      reasoningLevels: effort ? [{ id: effort, name: effort }] : [],
    },
  ],
});

it('routes equal native IDs to their own providers and validates each provider’s model and reasoning choices', async () => {
  const { directory, store } = await setup();
  const alpha = new FakeProvider('codex', 'Alpha', config('alpha-model', 'careful'));
  const beta = new FakeProvider('claude', 'Beta', config('beta-model', null));
  const garden = new Garden(store, [alpha, beta]);
  await garden.refresh();
  expect(garden.snapshot().providers.map((provider) => provider.configuration)).toEqual([
    alpha.config,
    beta.config,
  ]);
  const first = (
    await garden.create({
      provider: 'codex',
      name: 'First',
      project: directory,
      model: 'alpha-model',
      reasoning: 'careful',
    })
  ).agent;
  const second = (
    await garden.create({
      provider: 'claude',
      name: 'Second',
      project: directory,
      model: 'beta-model',
      reasoning: null,
    })
  ).agent;
  expect(first.sessionId).toBe(second.sessionId);
  expect(first.id).not.toBe(second.id);
  await garden.open(first.id);
  await garden.open(second.id);
  expect(alpha.opened.map((agent) => agent.id)).toEqual([first.id, first.id]);
  expect(beta.opened.map((agent) => agent.id)).toEqual([second.id, second.id]);
  await expect(
    garden.create({
      provider: 'claude',
      name: 'Wrong model',
      project: directory,
      model: 'alpha-model',
      reasoning: 'careful',
    }),
  ).rejects.toThrow('configuration');
  await expect(
    garden.create({
      provider: 'codex',
      name: 'Wrong effort',
      project: directory,
      model: 'alpha-model',
      reasoning: 'medium',
    }),
  ).rejects.toThrow('configuration');
  beta.fail = true;
  beta.connected = false;
  await garden.refresh();
  expect(garden.snapshot().providers.map((provider) => provider.connection)).toEqual([
    'connected',
    'disconnected',
  ]);
  expect(store.list().find((agent) => agent.id === first.id)?.connection).toBe('connected');
});

it('persists disabled connections, ignores in-flight observations, and reconnects only after enabling', async () => {
  const { directory, store } = await setup();
  const provider = new FakeProvider('codex', 'Alpha', config('alpha-model', 'careful'));
  const garden = new Garden(store, [provider]);
  await garden.refresh();
  const { agent } = await garden.create({
    provider: 'codex',
    name: 'Miso',
    project: directory,
    model: 'alpha-model',
    reasoning: 'careful',
  });
  await store.update(agent.id, {
    workers: [
      {
        id: 'native-worker',
        parentSessionId: agent.sessionId,
        name: 'Reviewer',
        project: directory,
        model: null,
        task: 'Review',
        status: 'waiting',
        connection: 'connected',
        lastSeen: agent.lastSeen,
        detail: null,
      },
    ],
  });
  let signalStarted!: () => void;
  let resolveObservation!: (observation: AgentObservation) => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const observation = new Promise<AgentObservation>((resolve) => {
    resolveObservation = resolve;
  });
  provider.readSession = async () => {
    signalStarted();
    return observation;
  };
  const polling = garden.refresh();
  await started;
  const disabling = garden.setProviderEnabled('codex', false);
  resolveObservation({
    project: directory,
    model: 'alpha-model',
    reasoning: 'careful',
    task: 'stale',
    status: 'working',
    connection: 'connected',
    detail: null,
    lastSeen: 'stale',
  });
  await Promise.all([polling, disabling]);
  const paused = store.list()[0];
  expect(paused.connection).toBe('disconnected');
  expect(paused.status).toBe(agent.status);
  expect(paused.lastSeen).toBe(agent.lastSeen);
  expect(paused.workers?.[0]).toMatchObject({
    id: 'native-worker',
    status: 'waiting',
    connection: 'disconnected',
    lastSeen: agent.lastSeen,
  });
  await expect(garden.open(agent.id)).rejects.toThrow('Enable Alpha');
  await expect(
    garden.create({
      provider: 'codex',
      name: 'Blocked',
      project: directory,
      model: 'alpha-model',
      reasoning: 'careful',
    }),
  ).rejects.toThrow('Enable Alpha');
  const reloaded = new AgentStore(directory);
  await reloaded.load();
  const next = new FakeProvider('codex', 'Alpha', config('alpha-model', 'careful'));
  const restarted = new Garden(reloaded, [next]);
  await restarted.refresh();
  expect(next.connections).toBe(0);
  expect(reloaded.list()[0].id).toBe(agent.id);
  await restarted.setProviderEnabled('codex', true);
  expect(next.connected).toBe(true);
  expect(reloaded.list()[0]).toMatchObject({
    id: agent.id,
    sessionId: agent.sessionId,
    connection: 'connected',
    lastSeen: 'fresh',
  });
});

it('loads legacy Codex cards with the original IDs and saves provider identity alongside connection preferences', async () => {
  const { directory, store } = await setup();
  const id = randomUUID();
  const legacy = {
    id,
    name: 'Miso',
    project: directory,
    model: 'model',
    reasoning: 'medium',
    task: 'Old task',
    status: 'finished',
    connection: 'connected',
    lastSeen: 'old',
    detail: null,
    createdAt: 'earlier',
  };
  await writeFile(join(directory, 'agents.json'), JSON.stringify({ version: 1, agents: [legacy] }));
  await store.load();
  expect(store.list()[0]).toMatchObject({
    ...legacy,
    provider: 'codex',
    sessionId: id,
    connection: 'disconnected',
  });
  await store.setProviderEnabled('codex', false);
  const reloaded = new AgentStore(directory);
  await reloaded.load();
  expect(reloaded.providerEnabled('codex')).toBe(false);
  expect(reloaded.list()[0]).toMatchObject({ id, provider: 'codex', sessionId: id, name: 'Miso' });
});

it('hides backend-disabled providers and cards, prevents connections and access, and preserves native IDs for re-enabling', async () => {
  const { directory, store } = await setup();
  const provider = new FakeProvider('claude', 'Claude', config('claude-model', null));
  const active = new Garden(store, [provider]);
  await active.refresh();
  const { agent } = await active.create({
    provider: 'claude',
    name: 'Dormant',
    project: directory,
    model: 'claude-model',
    reasoning: null,
  });
  await active.stop();
  provider.enabled = false;
  const connections = provider.connections;
  const dormant = new Garden(store, [provider]);
  await dormant.refresh();
  expect(dormant.snapshot().providers).toEqual([
    {
      id: 'claude',
      name: 'Claude',
      available: false,
      discoveryError: null,
      enabled: false,
      configuration: null,
      connection: 'disconnected',
      error: null,
    },
  ]);
  expect(dormant.snapshot().agents).toEqual([]);
  expect(provider.connections).toBe(connections);
  await expect(dormant.setProviderEnabled('claude', true)).rejects.toThrow('not available');
  await expect(dormant.open(agent.id)).rejects.toThrow('not available');
  await expect(
    dormant.create({
      provider: 'claude',
      name: 'Blocked',
      project: directory,
      model: 'claude-model',
      reasoning: null,
    }),
  ).rejects.toThrow('not available');
  expect(store.list()[0]).toMatchObject({
    id: agent.id,
    sessionId: agent.sessionId,
    provider: 'claude',
    connection: 'disconnected',
  });
  provider.enabled = true;
  const enabled = new Garden(store, [provider]);
  await enabled.refresh();
  expect(enabled.snapshot().agents[0]).toMatchObject({
    id: agent.id,
    sessionId: agent.sessionId,
    connection: 'connected',
  });
});

it('hands an initial prompt to the first terminal only, including after a failed launch', async () => {
  const { directory, store } = await setup();
  const provider = new FakeProvider('codex', 'Codex', config('model', null));
  const garden = new Garden(store, [provider]);
  await garden.refresh();
  const prompt = "  Review this project's code.\nKeep $(literal) text.  ";
  const { agent } = await garden.create({
    provider: 'codex',
    name: 'Prompted',
    project: directory,
    model: 'model',
    reasoning: null,
    initialPrompt: prompt,
  });
  expect(provider.prompts).toEqual([prompt]);
  expect(provider.presets[0]).not.toHaveProperty('initialPrompt');
  expect(store.list()[0]).not.toHaveProperty('initialPrompt');
  await garden.open(agent.id);
  expect(provider.prompts).toEqual([prompt, undefined]);

  provider.openTerminal = async () => {
    throw new Error('Terminal unavailable');
  };
  const failed = await garden.create({
    provider: 'codex',
    name: 'Saved',
    project: directory,
    model: 'model',
    reasoning: null,
    initialPrompt: prompt,
  });
  expect(failed.warning).toContain('initial prompt was not sent');
  expect(store.list().some((saved) => saved.id === failed.agent.id)).toBe(true);
});

it('treats whitespace prompts as empty and rejects invalid prompts before creating a session', async () => {
  const { directory, store } = await setup();
  const provider = new FakeProvider('codex', 'Codex', config('model', null));
  const garden = new Garden(store, [provider]);
  await garden.refresh();
  const input = {
    provider: 'codex' as const,
    name: 'Miso',
    project: directory,
    model: 'model',
    reasoning: null,
  };
  await garden.create({ ...input, initialPrompt: ' \n ' });
  expect(provider.prompts).toEqual([undefined]);
  for (const initialPrompt of ['a'.repeat(16001), 'hello\0world', 42]) {
    await expect(
      garden.create({ ...input, initialPrompt: initialPrompt as string }),
    ).rejects.toThrow('initial prompt');
  }
  expect(provider.presets).toHaveLength(1);
});

it('starts a prompted agent without a terminal, never resends on open, and rejects empty background creation', async () => {
  const { directory, store } = await setup();
  const provider = new FakeProvider('codex', 'Codex', config('model', null));
  const garden = new Garden(store, [provider]);
  await garden.refresh();
  const input = {
    provider: 'codex' as const,
    name: 'Background',
    project: directory,
    model: 'model',
    reasoning: null,
    openTerminal: false,
  };
  for (const initialPrompt of [undefined, '', ' \n ']) {
    await expect(garden.create({ ...input, initialPrompt })).rejects.toThrow('prompt');
  }
  expect(provider.presets).toHaveLength(0);
  const { agent, warning } = await garden.create({ ...input, initialPrompt: 'Do the task' });
  expect(warning).toBeNull();
  expect(provider.opened).toEqual([]);
  expect(provider.started).toEqual([{ agent, prompt: 'Do the task' }]);
  await garden.open(agent.id);
  expect(provider.started).toHaveLength(1);
  expect(provider.prompts).toEqual([undefined]);
  provider.startTask = async () => {
    throw new Error('Connection lost');
  };
  const failed = await garden.create({ ...input, initialPrompt: 'Another task' });
  expect(failed.warning).toContain('not confirmed');
  expect(store.list().some((saved) => saved.id === failed.agent.id)).toBe(true);
});
