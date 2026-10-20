import type { Agent } from '../shared/types';

export type FaviconState = 'default' | 'running' | 'waiting';

export function faviconState(agents: Agent[], browserConnected: boolean): FaviconState {
  if (!browserConnected) return 'default';
  let running = false;
  for (const agent of agents) {
    if (agent.connection !== 'connected') continue;
    if (
      agent.status === 'waiting' ||
      agent.workers?.some(
        (worker) => worker.connection === 'connected' && worker.status === 'waiting',
      )
    )
      return 'waiting';
    if (
      agent.status === 'working' ||
      agent.workers?.some(
        (worker) => worker.connection === 'connected' && worker.status === 'working',
      )
    )
      running = true;
  }
  return running ? 'running' : 'default';
}
