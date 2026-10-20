export type AgentStatus = 'working' | 'waiting' | 'finished' | 'failed' | 'idle';
export type Connection = 'connected' | 'disconnected';
const providerIds = ['codex', 'claude'] as const;
export type ProviderId = (typeof providerIds)[number];
export function isProviderId(value: unknown): value is ProviderId {
  return providerIds.some((id) => id === value);
}

export interface AgentWorker {
  id: string;
  parentSessionId: string;
  name: string;
  project: string;
  model: string | null;
  task: string;
  status: AgentStatus | 'unknown';
  connection: Connection;
  lastSeen: string | null;
  detail: string | null;
}

export interface Agent {
  origin: 'garden' | 'external';
  id: string;
  provider: ProviderId;
  sessionId: string;
  name: string;
  project: string;
  model: string;
  reasoning: string | null;
  task: string;
  status: AgentStatus;
  connection: Connection;
  detail: string | null;
  lastSeen: string | null;
  createdAt: string;
  lastActiveAt?: string;
  workers?: AgentWorker[];
  workersError?: string | null;
}

export interface ModelOption {
  id: string;
  name: string;
  defaultReasoning: string | null;
  reasoningLevels: { id: string; name: string; description?: string }[];
}

export interface ProviderConfiguration {
  defaultModel: string;
  models: ModelOption[];
}

export interface ProviderSnapshot {
  id: ProviderId;
  name: string;
  available: boolean;
  enabled: boolean;
  connection: Connection;
  error: string | null;
  configuration: ProviderConfiguration | null;
  discoveryError?: string | null;
}

export interface Project {
  path: string;
  name: string;
}

export interface ProjectSummary extends Project {
  agentCount: number;
}

export interface Snapshot {
  settings: { showExternalAgents: boolean };
  projects: ProjectSummary[];
  agents: Agent[];
  providers: ProviderSnapshot[];
  error: string | null;
  projectSuggestion: string;
}

export interface NewAgent {
  provider: ProviderId;
  name: string;
  project: string;
  model: string;
  reasoning: string | null;
  createProject?: boolean;
}

export interface ProjectCheck {
  path: string;
  exists: boolean;
}

export const statusLabels: Record<AgentStatus, string> = {
  working: 'Working',
  waiting: 'Waiting for input',
  finished: 'Finished',
  failed: 'Failed',
  idle: 'Idle',
};
