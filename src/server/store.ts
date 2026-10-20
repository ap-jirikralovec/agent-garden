import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import {
  isProviderId,
  type Agent,
  type AgentWorker,
  type ProviderId,
  type Project,
} from '../shared/types.js';

const statuses = new Set(['idle', 'working', 'waiting', 'finished', 'failed']);
interface StoredState {
  projects: Project[];
  agents: Agent[];
  connections: Partial<Record<ProviderId, boolean>>;
}

export class AgentStore {
  private agents: Agent[] = [];
  private projects: Project[] = [];
  private connections: Partial<Record<ProviderId, boolean>> = {};
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly directory: string) {}

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const file = JSON.parse(await readFile(join(this.directory, 'agents.json'), 'utf8'));
      if (
        ![1, 2, 3].includes(file.version) ||
        !Array.isArray(file.agents) ||
        !file.agents.every((agent: unknown) => validAgent(agent, file.version === 1)) ||
        (file.version >= 2 &&
          (!file.connections ||
            typeof file.connections !== 'object' ||
            Array.isArray(file.connections) ||
            Object.entries(file.connections).some(
              ([id, enabled]) => !isProviderId(id) || typeof enabled !== 'boolean',
            )))
      ) {
        throw new Error('Unexpected metadata format');
      }
      if (
        file.version === 3 &&
        (!Array.isArray(file.projects) ||
          !file.projects.every(validProject) ||
          new Set(file.projects.map((p: Project) => p.path)).size !== file.projects.length)
      )
        throw new Error('Unexpected project metadata format');
      this.projects = file.version === 3 ? file.projects : [];
      this.agents = file.agents.map((agent: Agent) => ({
        ...agent,
        provider: file.version === 1 ? 'codex' : agent.provider,
        sessionId: file.version === 1 ? agent.id : agent.sessionId,
        connection: 'disconnected',
        ...(agent.workers
          ? { workers: agent.workers.map((worker) => ({ ...worker, connection: 'disconnected' })) }
          : {}),
      }));
      this.connections = file.version >= 2 ? file.connections : {};
      this.projects = includeAgentProjects(this.projects, this.agents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Could not read ${join(this.directory, 'agents.json')}. Restore or move this file before restarting; Garden will not overwrite it.`,
          { cause: error },
        );
      }
    }
  }

  list(): Agent[] {
    return this.agents.map((agent) => ({ ...agent }));
  }

  listProjects(): Project[] {
    return this.projects.map((project) => ({ ...project }));
  }

  async addProject(path: string) {
    return this.mutate((state) => ({
      ...state,
      projects: includeAgentProjects(state.projects, [{ project: path }]),
    }));
  }

  async renameProject(path: string, value: string) {
    return this.mutate((state) => {
      const name = value.trim();
      if (!validProject({ path, name }))
        throw new Error('Use a project name between 1 and 60 characters.');
      if (!state.projects.some((project) => project.path === path))
        throw new Error('This project is not saved.');
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.path === path ? { ...project, name } : project,
        ),
      };
    });
  }

  async removeProject(path: string) {
    return this.mutate((state) => {
      if (state.agents.some((agent) => agent.project === path))
        throw new Error('Remove its agents from Garden before removing this project.');
      return { ...state, projects: state.projects.filter((project) => project.path !== path) };
    });
  }

  async put(agent: Agent) {
    return this.mutate((state) => ({
      ...state,
      agents: [...state.agents.filter((item) => item.id !== agent.id), agent],
      projects: includeAgentProjects(state.projects, [agent]),
    }));
  }

  async remove(id: string) {
    return this.mutate((state) => ({
      ...state,
      agents: state.agents.filter((agent) => agent.id !== id),
    }));
  }

  async update(id: string, update: Partial<Agent>) {
    return this.mutate((state) => {
      const agents = state.agents.map((agent) =>
        agent.id === id ? { ...agent, ...update } : agent,
      );
      return { ...state, agents, projects: includeAgentProjects(state.projects, agents) };
    });
  }

  providerEnabled(id: ProviderId) {
    return this.connections[id] ?? true;
  }

  async setProviderEnabled(id: ProviderId, enabled: boolean) {
    return this.mutate((state) => ({
      ...state,
      connections: { ...state.connections, [id]: enabled },
    }));
  }

  private mutate(change: (state: StoredState) => StoredState) {
    const operation = this.queue.then(async () => {
      const previous = {
        agents: this.agents,
        connections: this.connections,
        projects: this.projects,
      };
      const next = change(previous);
      // Seeing the same state again updates the live timestamp without rewriting
      // the file every poll. State changes (including disconnects) persist it.
      const durable = (state: StoredState) =>
        JSON.stringify({
          agents: state.agents.map(({ lastSeen: _lastSeen, workers, ...agent }) => ({
            ...agent,
            ...(workers
              ? { workers: workers.map(({ lastSeen: _workerSeen, ...worker }) => worker) }
              : {}),
          })),
          connections: state.connections,
          projects: state.projects,
        });
      if (durable(next) !== durable(previous)) {
        const target = join(this.directory, 'agents.json');
        const temporary = target + '.tmp';
        await writeFile(temporary, JSON.stringify({ version: 3, ...next }, null, 2) + '\n', {
          mode: 0o600,
        });
        await rename(temporary, target);
      }
      this.projects = next.projects;
      this.agents = next.agents;
      this.connections = next.connections;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

function validAgent(value: unknown, legacy: boolean): value is Agent {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    ['id', 'name', 'project', 'model', 'task', 'createdAt'].every(
      (key) => typeof a[key] === 'string',
    ) &&
    (typeof a.reasoning === 'string' || (!legacy && a.reasoning === null)) &&
    (legacy ||
      (isProviderId(a.provider) &&
        typeof a.sessionId === 'string' &&
        a.sessionId.length > 0 &&
        a.sessionId.length <= 4096)) &&
    /^[0-9a-f-]{36}$/i.test(a.id as string) &&
    statuses.has(a.status as string) &&
    (a.connection === 'connected' || a.connection === 'disconnected') &&
    (a.workers === undefined ||
      (Array.isArray(a.workers) && a.workers.length <= 200 && a.workers.every(validWorker))) &&
    (a.workersError === undefined ||
      a.workersError === null ||
      typeof a.workersError === 'string') &&
    (a.lastSeen === null || typeof a.lastSeen === 'string') &&
    (a.detail === null || typeof a.detail === 'string')
  );
}

function validWorker(value: unknown): value is AgentWorker {
  if (!value || typeof value !== 'object') return false;
  const worker = value as Record<string, unknown>;
  return (
    ['id', 'parentSessionId', 'name', 'project', 'task'].every(
      (key) => typeof worker[key] === 'string',
    ) &&
    (typeof worker.model === 'string' || worker.model === null) &&
    (statuses.has(worker.status as string) || worker.status === 'unknown') &&
    (worker.connection === 'connected' || worker.connection === 'disconnected') &&
    (worker.lastSeen === null || typeof worker.lastSeen === 'string') &&
    (worker.detail === null || typeof worker.detail === 'string')
  );
}

function includeAgentProjects(projects: Project[], agents: { project: string }[]): Project[] {
  const saved = new Map(projects.map((project) => [project.path, project]));
  for (const { project: path } of agents) {
    if (!saved.has(path)) saved.set(path, { path, name: (basename(path) || path).slice(0, 60) });
  }
  return [...saved.values()];
}

function validProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.path === 'string' &&
    isAbsolute(p.path) &&
    p.path.length <= 4096 &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    p.name.length <= 60 &&
    // eslint-disable-next-line no-control-regex -- Project metadata must contain plain names and paths.
    !/[\x00-\x1f]/.test(p.path + p.name)
  );
}
