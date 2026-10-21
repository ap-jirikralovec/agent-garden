import type { WorkPreset } from '../shared/work';
import type { Agent, NewAgent, Project, ProjectCheck, ProviderId, Snapshot } from '../shared/types';

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Garden-Request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

export const gardenApi = {
  work: (signal?: AbortSignal) =>
    request<{ presets: WorkPreset[]; directory: string }>('/api/work', 'GET', undefined, signal),
  state: (signal?: AbortSignal) => request<Snapshot>('/api/state', 'GET', undefined, signal),
  setShowExternalAgents: (showExternalAgents: boolean) =>
    request<Snapshot>('/api/settings', 'POST', { showExternalAgents }),
  setProvider: (id: ProviderId, enabled: boolean) =>
    request<Snapshot>(`/api/providers/${id}`, 'POST', { enabled }),
  pickProject: () =>
    request<{ project: Project | null; snapshot: Snapshot }>('/api/projects/pick', 'POST'),
  renameProject: (project: string, name: string) =>
    request<Snapshot>('/api/projects', 'POST', { project, name }),
  removeProject: (project: string) => request<Snapshot>('/api/projects', 'DELETE', { project }),
  checkProject: (project: string) =>
    request<ProjectCheck>('/api/projects/check', 'POST', { project }),
  createAgent: (agent: NewAgent) =>
    request<{ agent: Agent; warning: string | null }>('/api/agents', 'POST', agent),
  openTerminal: (id: string) => request(`/api/agents/${encodeURIComponent(id)}/terminal`, 'POST'),
  removeAgent: (id: string) => request(`/api/agents/${encodeURIComponent(id)}`, 'DELETE'),
};
