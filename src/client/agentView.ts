import type { Agent, ProviderId } from '../shared/types';

export function filterAgents(agents: Agent[], providers: ProviderId[], status: string, search: string) {
  const term = search.trim().toLowerCase();
  return agents.filter(agent => providers.includes(agent.provider)
    && (status === 'all' || (status === 'disconnected' ? agent.connection === 'disconnected' : agent.status === status))
    && [agent.name, agent.project, agent.task, agent.provider, agent.sessionId, ...(agent.workers ?? []).flatMap(worker => [worker.id, worker.name, worker.task, worker.project])].some(value => value.toLowerCase().includes(term)));
}

export function groupAgents(agents: Agent[], byProject: boolean) {
  if (!byProject) return [{ project: '', agents }];
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const group = groups.get(agent.project) ?? [];
    group.push(agent);
    groups.set(agent.project, group);
  }
  return [...groups].map(([project, agents]) => ({ project, agents }));
}
