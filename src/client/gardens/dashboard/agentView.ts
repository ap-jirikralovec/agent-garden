import type { Agent, Project, ProviderId } from '../../../shared/types';

export function filterAgents(
  agents: Agent[],
  providers: ProviderId[],
  status: string,
  search: string,
  projects: Project[] = [],
) {
  const term = search.trim().toLowerCase();
  return agents.filter(
    (agent) =>
      providers.includes(agent.provider) &&
      (status === 'all' ||
        (status === 'disconnected'
          ? agent.connection === 'disconnected'
          : agent.status === status)) &&
      [
        agent.name,
        projects.find((project) => project.path === agent.project)?.name ?? '',
        agent.project,
        agent.task,
        agent.provider,
        agent.sessionId,
        ...(agent.workers ?? []).flatMap((worker) => [
          worker.id,
          worker.name,
          worker.task,
          worker.project,
        ]),
      ].some((value) => value.toLowerCase().includes(term)),
  );
}

export function groupAgents(
  agents: Agent[],
  byProject: boolean,
  options?: {
    projects: (Project & { agentCount?: number })[];
    allAgents: Agent[];
    hideEmpty: boolean;
    search: string;
    status?: string;
  },
) {
  if (!byProject) return [{ project: '', agents }];
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const group = groups.get(agent.project) ?? [];
    group.push(agent);
    groups.set(agent.project, group);
  }
  if (options && !options.hideEmpty && (!options.status || options.status === 'all')) {
    const occupied = new Set(options.allAgents.map((agent) => agent.project));
    const term = options.search.trim().toLowerCase();
    for (const project of options.projects) {
      if (
        !(project.agentCount ?? (occupied.has(project.path) ? 1 : 0)) &&
        [project.name, project.path].some((value) => value.toLowerCase().includes(term))
      )
        groups.set(project.path, []);
    }
  }
  return [...groups].map(([project, agents]) => ({ project, agents }));
}
