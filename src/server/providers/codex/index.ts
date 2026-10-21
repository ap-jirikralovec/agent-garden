import { realpath } from 'node:fs/promises';
import type { Agent, ProviderConfiguration } from '../../../shared/types.js';
import type { TerminalCommand } from '../../terminal.js';
import type { AgentProvider, SessionPreset } from '../provider.js';
import type { Rpc, Thread, Turn } from './protocol.js';
import { observe } from './status.js';
import { discoverCodexSessions } from './discovery.js';
import { readCodexWorkers } from './workers.js';

export function codexCommand(
  agent: Agent,
  executable = 'codex',
  codexHome = process.env.CODEX_HOME,
  initialPrompt?: string,
): TerminalCommand {
  if (agent.provider !== 'codex') throw new Error('This session does not belong to Codex.');
  // Presets are restored before opening. -c would disable implicit daemon reuse;
  // explicit --remote applies incorrect remote trust checks in Codex 0.163.0.
  return {
    executable,
    args: [
      '--enable',
      'daemon_auto_start',
      'resume',
      agent.sessionId,
      '--cd',
      agent.project,
      ...(initialPrompt ? ['--', initialPrompt] : []),
    ],
    ...(codexHome ? { env: { CODEX_HOME: codexHome } } : {}),
  };
}

export class CodexProvider implements AgentProvider {
  readonly id = 'codex';
  readonly name = 'Codex';
  readonly enabled = true;
  constructor(
    private rpc: Rpc,
    private terminal: { open(id: string, command: TerminalCommand): Promise<void> },
    private executable = 'codex',
  ) {}
  get connected() {
    return this.rpc.connected;
  }
  connect() {
    return this.rpc.connect();
  }
  async close() {
    await this.rpc.close();
  }

  async configuration(): Promise<ProviderConfiguration> {
    const { data } = await this.rpc.request<{
      data: {
        model: string;
        displayName: string;
        isDefault: boolean;
        hidden?: boolean;
        defaultReasoningEffort: string;
        supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
      }[];
    }>('model/list', { limit: 100 });
    const models = data.filter((model) => !model.hidden);
    return {
      defaultModel:
        models.find((model) => model.model === 'gpt-6-sol')?.model ??
        models.find((model) => model.isDefault)?.model ??
        models[0]?.model ??
        '',
      models: models.map((model) => ({
        id: model.model,
        name: model.displayName,
        defaultReasoning: !model.supportedReasoningEfforts.length
          ? null
          : model.supportedReasoningEfforts.some((option) => option.reasoningEffort === 'medium')
            ? 'medium'
            : (model.supportedReasoningEfforts.find(
                (option) => option.reasoningEffort === model.defaultReasoningEffort,
              )?.reasoningEffort ?? model.supportedReasoningEfforts[0].reasoningEffort),
        reasoningLevels: model.supportedReasoningEfforts.map((option) => ({
          id: option.reasoningEffort,
          name: option.reasoningEffort,
          description: option.description,
        })),
      })),
    };
  }

  async createSession(preset: SessionPreset) {
    const { thread } = await this.rpc.request<{ thread: Thread }>('thread/start', {
      cwd: preset.project,
      model: preset.model,
      ...(preset.reasoning === null
        ? {}
        : { config: { model_reasoning_effort: preset.reasoning } }),
    });
    let warning: string | null = null;
    try {
      await this.rpc.request('thread/name/set', { threadId: thread.id, name: preset.name });
    } catch {
      warning = 'Its name is saved in Garden, but Codex could not update its title.';
    }
    return { sessionId: thread.id, warning };
  }

  discoverSessions(projects: string[], excludedSessionIds: string[]) {
    return discoverCodexSessions(this.rpc, projects, excludedSessionIds);
  }

  async readSession(agent: Agent) {
    if (agent.provider !== this.id) throw new Error('This session does not belong to Codex.');
    const { thread } = await this.rpc.request<{ thread: Thread }>('thread/read', {
      threadId: agent.sessionId,
    });
    const { data } = await this.rpc.request<{ data: Turn[] }>('thread/turns/list', {
      threadId: agent.sessionId,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'full',
    });
    const observation = observe(agent, thread, data[0]);
    if (agent.origin === 'external')
      observation.project = await realpath(observation.project).catch(() => observation.project);
    try {
      return { ...observation, ...(await readCodexWorkers(this.rpc, agent)) };
    } catch {
      return {
        ...observation,
        workers: (agent.workers ?? []).map((worker) => ({
          ...worker,
          connection: 'disconnected' as const,
        })),
        workersError: 'Could not read Codex workers. Their last known states are retained.',
      };
    }
  }

  async startTask(agent: Agent, prompt: string): Promise<void> {
    if (agent.provider !== this.id) throw new Error('This session does not belong to Codex.');
    // Inherit the new thread's preset and permissions. Never retry task submission.
    await this.rpc.request('turn/start', {
      threadId: agent.sessionId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
    });
  }

  async openTerminal(agent: Agent, initialPrompt?: string) {
    const command = codexCommand(agent, this.executable, process.env.CODEX_HOME, initialPrompt);
    await this.rpc.connect();
    const { thread } = await this.rpc.request<{ thread: Thread }>('thread/read', {
      threadId: agent.sessionId,
    });
    if (thread.status.type === 'notLoaded') {
      // Only an explicit terminal action may load a cold session.
      await this.rpc.request('thread/resume', {
        threadId: agent.sessionId,
        excludeTurns: true,
        ...(agent.origin === 'external'
          ? {}
          : {
              model: agent.model,
              ...(agent.reasoning === null
                ? {}
                : { config: { model_reasoning_effort: agent.reasoning } }),
            }),
      });
    }
    await this.terminal.open(agent.id, command);
  }
}
