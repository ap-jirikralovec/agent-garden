import { randomUUID } from 'node:crypto';
import type { Agent } from '../../../shared/types.js';
import type { TerminalCommand } from '../../terminal.js';
import type { AgentObservation, AgentProvider, SessionPreset } from '../provider.js';
import { ClaudeCli, type ClaudeSession } from './cli.js';
import { ClaudeObservations, type ClaudeEvent } from './observation.js';

export function observeClaude(
  agent: Agent,
  session: ClaudeSession | undefined,
  events: ClaudeEvent[],
): AgentObservation {
  const latest = events.at(-1);
  const prompt = events.find((event) => event.event === 'UserPromptSubmit');
  const start = events.find((event) => event.event === 'SessionStart');
  const stateEvent = events
    .filter((event) => ['UserPromptSubmit', 'Stop', 'StopFailure'].includes(event.event))
    .at(-1);
  let status = agent.status;
  if (stateEvent?.event === 'UserPromptSubmit') status = 'working';
  if (stateEvent?.event === 'Stop') status = 'finished';
  if (stateEvent?.event === 'StopFailure') status = 'failed';
  if (session?.kind === 'background' && session.state) {
    const states = {
      working: 'working',
      blocked: 'waiting',
      done: 'finished',
      failed: 'failed',
      stopped: 'failed',
    } as const;
    status = states[session.state];
  } else if (session?.status === 'busy') status = 'working';
  else if (session?.status === 'waiting') status = 'waiting';
  else if (session?.status === 'idle')
    status =
      stateEvent?.event === 'StopFailure' ? 'failed' : prompt || agent.task ? 'finished' : 'idle';
  const verified = !!session;
  return {
    project: session?.cwd ?? start?.project ?? agent.project,
    model: start?.model ?? agent.model,
    reasoning: agent.reasoning,
    task: prompt?.task ?? agent.task,
    status,
    connection: verified ? 'connected' : 'disconnected',
    lastSeen: verified ? new Date().toISOString() : (latest?.at ?? agent.lastSeen),
    lastActiveAt:
      stateEvent && (!agent.lastActiveAt || stateEvent.at > agent.lastActiveAt)
        ? stateEvent.at
        : agent.lastActiveAt,
    detail: verified
      ? session.waitingFor
        ? `Claude needs ${session.waitingFor}. Open its terminal to respond.`
        : null
      : latest
        ? 'Claude is not running. Open terminal to resume this conversation.'
        : 'Waiting for Claude to start in the terminal.',
  };
}

export function claudeCommand(
  agent: Agent,
  settings: string,
  resume: boolean,
  executable = 'claude',
): TerminalCommand {
  if (agent.provider !== 'claude') throw new Error('This session does not belong to Claude.');
  return {
    executable,
    cwd: agent.project,
    args: [
      resume ? '--resume' : '--session-id',
      agent.sessionId,
      '--settings',
      settings,
      ...(!resume
        ? [
            '--name',
            agent.name,
            '--model',
            agent.model,
            ...(agent.reasoning ? ['--effort', agent.reasoning] : []),
          ]
        : []),
    ],
    ...(process.env.CLAUDE_CONFIG_DIR
      ? { env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } }
      : {}),
  };
}

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude';
  readonly name = 'Claude';
  readonly enabled = true;
  private online = false;
  private sessions: ClaudeSession[] = [];
  constructor(
    private cli: Pick<ClaudeCli, 'sessions' | 'configuration' | 'executable'>,
    private observations: ClaudeObservations,
    private terminal: {
      open(id: string, command: TerminalCommand): Promise<void>;
      focus(id: string, expectedPid?: number): Promise<boolean>;
    },
  ) {}
  get connected() {
    return this.online;
  }
  async connect() {
    try {
      this.sessions = await this.cli.sessions();
      this.online = true;
    } catch (error) {
      this.online = false;
      throw error;
    }
  }
  configuration() {
    return this.cli.configuration();
  }
  async close() {
    this.online = false;
    this.sessions = [];
  }

  async createSession(_preset: SessionPreset) {
    // Reserve the native UUID before opening. Claude creates the conversation in
    // the terminal, where normal authentication and workspace trust can appear.
    const sessionId = randomUUID();
    await this.observations.settings(sessionId);
    return { sessionId, warning: null };
  }

  private check(agent: Agent) {
    if (agent.provider !== this.id) throw new Error('This session does not belong to Claude.');
  }
  async readSession(agent: Agent) {
    this.check(agent);
    const session = this.sessions.find((session) => session.sessionId === agent.sessionId);
    const observation = observeClaude(
      agent,
      session,
      await this.observations.read(agent.sessionId),
    );
    try {
      return {
        ...observation,
        ...(await this.observations.workers(agent.sessionId, !!session, agent.workers ?? [])),
      };
    } catch {
      return {
        ...observation,
        workers: (agent.workers ?? []).map((worker) => ({
          ...worker,
          connection: 'disconnected' as const,
        })),
        workersError: 'Could not read Claude workers. Their last observed states are retained.',
      };
    }
  }

  async openTerminal(agent: Agent) {
    this.check(agent);
    await this.connect();
    const session = this.sessions.find((session) => session.sessionId === agent.sessionId);
    if (session?.kind === 'interactive') {
      if (await this.terminal.focus(agent.id, session.pid)) return;
      throw new Error(
        'This Claude conversation is already open. Use its existing terminal, or exit Claude there and try again.',
      );
    }
    if (session?.kind === 'background') {
      if (!session.id) throw new Error('Claude did not return the background session identifier.');
      const command = claudeCommand(agent, '', true, this.cli.executable);
      command.args = ['attach', session.id];
      await this.terminal.open(agent.id, command);
      return;
    }
    const events = await this.observations.read(agent.sessionId);
    const settings = await this.observations.settings(agent.sessionId);
    await this.terminal.open(
      agent.id,
      claudeCommand(
        agent,
        settings,
        events.some((event) => event.event === 'UserPromptSubmit'),
        this.cli.executable,
      ),
    );
  }
}
