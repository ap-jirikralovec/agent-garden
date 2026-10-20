import type { Agent, Project } from '../shared/types.js';

function activityTime(agent: Agent): number {
  return Date.parse(agent.lastActiveAt ?? agent.createdAt) || 0;
}

export function sortRecentAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => activityTime(b) - activityTime(a));
}

export function sortRecentProjects<T extends Project>(projects: T[], agents: Agent[]): T[] {
  const latest = new Map<string, number>();
  for (const agent of agents)
    latest.set(agent.project, Math.max(latest.get(agent.project) ?? 0, activityTime(agent)));
  return [...projects].sort((a, b) => (latest.get(b.path) ?? 0) - (latest.get(a.path) ?? 0));
}
