import type { Agent } from '../../../shared/types.js';
import type { AgentObservation } from '../provider.js';
import type { Thread, Turn } from './protocol.js';

export function observe(previous: Agent, thread: Thread, turn?: Turn): AgentObservation {
  const task = turn?.items
    .filter((item) => item.type === 'userMessage')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
  const agent: AgentObservation = {
    status: previous.status,
    connection: previous.connection,
    detail: previous.detail,
    lastSeen: previous.lastSeen,
    project: thread.cwd || previous.project,
    model: thread.status.type === 'notLoaded' ? previous.model : thread.model || previous.model,
    reasoning:
      thread.status.type === 'notLoaded'
        ? previous.reasoning
        : thread.reasoningEffort || previous.reasoning,
    task: task ? task.slice(0, 4000) : previous.task || thread.preview.slice(0, 4000),
  };
  if (thread.status.type === 'notLoaded') {
    return {
      ...agent,
      connection: 'disconnected',
      detail: 'Session is not loaded. Open terminal to resume it.',
    };
  }
  agent.connection = 'connected';
  agent.lastSeen = new Date().toISOString();
  agent.detail = null;
  if (thread.status.type === 'systemError') {
    agent.status = 'failed';
    agent.detail = 'Codex reported a session error. Open terminal for details.';
  } else if (thread.status.type === 'active') {
    const flags = thread.status.activeFlags ?? [];
    agent.status =
      flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')
        ? 'waiting'
        : 'working';
    if (flags.includes('waitingOnApproval'))
      agent.detail = 'An approval needs your attention in Codex.';
    else if (agent.status === 'waiting') agent.detail = 'Codex has a question for you.';
  } else if (turn?.status === 'failed' || turn?.status === 'interrupted') {
    agent.status = 'failed';
    agent.detail =
      turn.error?.message ||
      (turn.status === 'interrupted'
        ? 'The latest response was interrupted.'
        : 'The latest response failed.');
  } else if (turn?.status === 'completed') {
    agent.status = 'finished';
  } else if (turn?.status === 'inProgress') {
    // A saved in-progress turn is not proof that work is still running.
    agent.status = 'failed';
    agent.detail = 'The last response stopped before completing. Open terminal to continue.';
  } else {
    agent.status = 'idle';
  }
  return agent;
}
