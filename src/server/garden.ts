import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  isProviderId,
  type Agent,
  type NewAgent,
  type ProviderConfiguration,
  type ProviderId,
  type ProviderSnapshot,
  type Snapshot,
} from '../shared/types.js';
import type { AgentProvider } from './providers/provider.js';
import { AgentStore } from './store.js';
import { checkProject, prepareProject } from './project.js';
import { sortRecentAgents, sortRecentProjects } from './ordering.js';

interface ProviderRuntime {
  adapter: AgentProvider;
  configuration: ProviderConfiguration | null;
  error: string | null;
  failures: number;
  retryAt: number;
  epoch: number;
  changing: boolean;
  actions: number;
  refreshing: Promise<void> | null;
  discoveryError: string | null;
}

export class Garden extends EventEmitter {
  private providers = new Map<ProviderId, ProviderRuntime>();
  private error: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private creating = false;

  constructor(
    readonly store: AgentStore,
    private readonly adapters: AgentProvider[],
    private projectSuggestion = process.cwd(),
  ) {
    super();
    const ids = new Set<ProviderId>();
    for (const adapter of adapters) {
      if (!isProviderId(adapter.id) || ids.has(adapter.id))
        throw new Error('Invalid or duplicate provider identifier.');
      ids.add(adapter.id);
      if (!adapter.enabled) continue;
      this.providers.set(adapter.id, {
        adapter,
        configuration: null,
        error: `Connecting to ${adapter.name}…`,
        failures: 0,
        retryAt: 0,
        epoch: 0,
        changing: false,
        actions: 0,
        refreshing: null,
        discoveryError: null,
      });
    }
  }

  snapshot(): Snapshot {
    const agents = this.store.list();
    const projects = this.store.listProjects();
    return {
      settings: { showExternalAgents: this.store.showExternalAgents() },
      projects: sortRecentProjects(
        projects.map((project) => ({
          ...project,
          agentCount: agents.filter((agent) => agent.project === project.path).length,
        })),
        agents,
      ),
      agents: sortRecentAgents(
        agents.filter(
          (agent) =>
            this.providers.has(agent.provider) &&
            (agent.origin !== 'external' ||
              (this.store.showExternalAgents() &&
                projects.some((project) => project.path === agent.project))),
        ),
      ),
      providers: this.adapters.map((adapter): ProviderSnapshot => {
        const runtime = this.providers.get(adapter.id);
        const enabled = !!runtime && this.store.providerEnabled(adapter.id);
        return {
          id: adapter.id,
          name: adapter.name,
          available: !!runtime,
          enabled,
          configuration: runtime?.configuration ?? null,
          connection:
            enabled && adapter.connected && !runtime?.error ? 'connected' : 'disconnected',
          error: enabled ? (runtime?.error ?? null) : null,
          discoveryError: enabled ? (runtime?.discoveryError ?? null) : null,
        };
      }),
      error: this.error,
      projectSuggestion: this.projectSuggestion,
    };
  }

  start() {
    this.stopped = false;
    void this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const runtime of this.providers.values()) runtime.epoch++;
    await Promise.all([...this.providers.values()].map((runtime) => runtime.adapter.close()));
  }

  private emitSnapshot() {
    this.emit('change', this.snapshot());
  }

  private async disconnectAgents(id: ProviderId, detail: string) {
    for (const agent of this.store.list().filter((agent) => agent.provider === id)) {
      await this.store.update(agent.id, {
        connection: 'disconnected',
        detail,
        ...(agent.workers
          ? { workers: agent.workers.map((worker) => ({ ...worker, connection: 'disconnected' })) }
          : {}),
      });
    }
  }

  private refreshProvider(runtime: ProviderRuntime): Promise<void> {
    if (runtime.refreshing) return runtime.refreshing;
    const { adapter } = runtime;
    const epoch = runtime.epoch;
    const current = () =>
      !this.stopped && epoch === runtime.epoch && this.store.providerEnabled(adapter.id);
    const operation = (async () => {
      try {
        const wasConnected = adapter.connected;
        await adapter.connect();
        if (!current()) return;
        if (!runtime.configuration || !wasConnected) {
          const configuration = await adapter.configuration();
          if (!current()) return;
          runtime.configuration = configuration;
        }
        if (adapter.discoverSessions && !this.creating && !runtime.actions) {
          try {
            const discovery = await adapter.discoverSessions(
              this.store.listProjects().map((project) => project.path),
              this.store.excludedSessionIds(adapter.id),
            );
            if (!current()) return;
            runtime.discoveryError = discovery.warning;
            for (const session of discovery.sessions) {
              const imported = await this.store.importSession(
                {
                  ...session,
                  id: randomUUID(),
                  provider: adapter.id,
                  origin: 'external',
                  task: '',
                  status: 'idle',
                  connection: 'disconnected',
                  detail: 'Waiting for a fresh observation.',
                  lastSeen: null,
                },
                () => current() && !this.creating && !runtime.actions,
              );
              if (imported === 'full') {
                runtime.discoveryError =
                  'Garden supports up to 50 tracked sessions. Remove an old card to discover more.';
                break;
              }
            }
          } catch (error) {
            if (!current()) return;
            if (!adapter.connected) throw error;
            runtime.discoveryError =
              error instanceof Error ? error.message : 'Could not discover external sessions.';
          }
        }
        for (const agent of this.store.list().filter((agent) => agent.provider === adapter.id)) {
          if (!current()) return;
          try {
            const update = await adapter.readSession(agent);
            if (!current()) return;
            await this.store.update(agent.id, update);
          } catch (error) {
            if (!current()) return;
            if (!adapter.connected) throw error;
            await this.store.update(agent.id, {
              connection: 'disconnected',
              detail: `Could not read this session: ${error instanceof Error ? error.message : 'Unknown error.'}`,
              ...(agent.workers
                ? {
                    workers: agent.workers.map((worker) => ({
                      ...worker,
                      connection: 'disconnected',
                    })),
                  }
                : {}),
            });
          }
        }
        runtime.error = null;
        runtime.failures = 0;
        runtime.retryAt = 0;
      } catch (error) {
        if (!current()) return;
        runtime.error = error instanceof Error ? error.message : `Could not reach ${adapter.name}.`;
        runtime.retryAt = Date.now() + Math.min(2000 * 2 ** ++runtime.failures, 15000);
        await this.disconnectAgents(adapter.id, runtime.error);
      }
    })().finally(() => {
      runtime.refreshing = null;
    });
    runtime.refreshing = operation;
    return operation;
  }

  async refresh() {
    await Promise.all(
      [...this.providers.values()]
        .filter(
          (runtime) =>
            this.store.providerEnabled(runtime.adapter.id) &&
            !runtime.changing &&
            Date.now() >= runtime.retryAt,
        )
        .map((runtime) => this.refreshProvider(runtime)),
    );
    for (const agent of this.store.list()) {
      if (!this.providers.has(agent.provider))
        await this.store.update(agent.id, {
          connection: 'disconnected',
          detail: 'This provider is not available in this installation.',
          ...(agent.workers
            ? {
                workers: agent.workers.map((worker) => ({ ...worker, connection: 'disconnected' })),
              }
            : {}),
        });
    }
    this.error = null;
    this.emitSnapshot();
  }

  private async tick() {
    try {
      await this.refresh();
    } catch {
      this.error =
        'Could not save agent metadata. Check that the Garden data directory is writable.';
      this.emitSnapshot();
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), 2000);
  }

  private provider(id: ProviderId | undefined) {
    const runtime = id ? this.providers.get(id) : undefined;
    if (!runtime) throw new Error('This agent provider is not available.');
    return runtime;
  }

  private ready(runtime: ProviderRuntime) {
    if (!this.store.providerEnabled(runtime.adapter.id))
      throw new Error(`Enable ${runtime.adapter.name} in connection settings first.`);
    if (runtime.changing)
      throw new Error('This connection is changing. Please try again in a moment.');
    if (!runtime.adapter.connected || runtime.error || !runtime.configuration)
      throw new Error(`Wait for ${runtime.adapter.name} to connect before continuing.`);
  }

  async setProviderEnabled(id: ProviderId, enabled: boolean) {
    const runtime = this.provider(id);
    if (runtime.changing || runtime.actions)
      throw new Error('This provider is busy opening a session. Please try again in a moment.');
    if (this.store.providerEnabled(id) === enabled) return;
    runtime.changing = true;
    runtime.epoch++;
    try {
      await this.store.setProviderEnabled(id, enabled);
      if (!enabled) {
        try {
          await runtime.adapter.close();
        } finally {
          await runtime.refreshing;
          await this.disconnectAgents(
            id,
            `${runtime.adapter.name} connection is disabled. Enable it in settings to reconnect.`,
          );
        }
      } else {
        runtime.configuration = null;
        runtime.error = `Connecting to ${runtime.adapter.name}…`;
        runtime.retryAt = 0;
        await this.refreshProvider(runtime);
      }
    } finally {
      runtime.changing = false;
      this.emitSnapshot();
    }
  }

  async setShowExternalAgents(enabled: boolean) {
    await this.store.setShowExternalAgents(enabled);
    this.emitSnapshot();
  }

  async addProject(path: string) {
    const project = await checkProject(path);
    if (!project.exists) throw new Error('This project folder no longer exists. Choose it again.');
    await this.store.addProject(project.path);
    this.emitSnapshot();
    return this.store.listProjects().find((saved) => saved.path === project.path)!;
  }

  async renameProject(path: string, name: string) {
    await this.store.renameProject(path, name);
    this.emitSnapshot();
  }

  async removeProject(path: string) {
    if (this.creating)
      throw new Error('Wait for agent creation to finish before removing a project.');
    await this.store.removeProject(path);
    this.emitSnapshot();
  }

  async create(input: NewAgent): Promise<{ agent: Agent; warning: string | null }> {
    if (this.creating)
      throw new Error('Another agent is being created. Please try again in a moment.');
    const runtime = this.provider(input.provider);
    this.ready(runtime);
    this.creating = true;
    runtime.actions++;
    try {
      if (this.store.list().length >= 50)
        throw new Error('Garden supports up to 50 tracked sessions. Remove an old card first.');
      const name = input.name.trim();
      // eslint-disable-next-line no-control-regex -- Reject control characters in user-provided names.
      if (!name || name.length > 60 || /[\x00-\x1f]/.test(name))
        throw new Error('Use a name between 1 and 60 characters.');
      const model = runtime.configuration!.models.find((model) => model.id === input.model);
      if (
        !model ||
        (model.reasoningLevels.length
          ? !model.reasoningLevels.some((option) => option.id === input.reasoning)
          : input.reasoning !== null)
      ) {
        throw new Error(
          'Choose a model and reasoning level from this provider’s current configuration.',
        );
      }
      const project = await prepareProject(input.project, input.createProject === true);
      const { sessionId, warning } = await runtime.adapter.createSession({
        name,
        project,
        model: input.model,
        reasoning: input.reasoning,
      });
      const agent: Agent = {
        id: randomUUID(),
        provider: runtime.adapter.id,
        origin: 'garden',
        sessionId,
        name,
        project,
        model: input.model,
        reasoning: input.reasoning,
        task: '',
        status: 'idle',
        connection: 'connected',
        detail: null,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      await this.store.put(agent);
      const warnings = warning ? [warning] : [];
      try {
        await runtime.adapter.openTerminal(agent);
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : 'Session created, but the terminal could not open. Retry Open terminal.',
        );
      }
      this.emitSnapshot();
      return { agent, warning: warnings.length ? warnings.join(' ') : null };
    } finally {
      this.creating = false;
      runtime.actions--;
    }
  }

  async open(id: string) {
    const agent = this.store.list().find((item) => item.id === id);
    if (!agent) throw new Error('This session is not tracked in Garden.');
    const runtime = this.provider(agent.provider);
    // A terminal may reconnect a lost transport, but never a deliberately disabled provider.
    if (!this.store.providerEnabled(agent.provider))
      throw new Error(`Enable ${runtime.adapter.name} in connection settings first.`);
    if (runtime.changing)
      throw new Error('This connection is changing. Please try again in a moment.');
    runtime.actions++;
    try {
      await runtime.adapter.openTerminal(agent);
    } finally {
      runtime.actions--;
    }
  }

  async remove(id: string) {
    await this.store.remove(id);
    this.emitSnapshot();
  }
}
