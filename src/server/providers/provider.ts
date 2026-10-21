import type { Agent, ProviderConfiguration, ProviderId } from '../../shared/types.js';

export type AgentObservation = Pick<
  Agent,
  | 'project'
  | 'model'
  | 'reasoning'
  | 'status'
  | 'task'
  | 'connection'
  | 'detail'
  | 'lastSeen'
  | 'lastActiveAt'
  | 'workers'
  | 'workersError'
>;

export interface SessionPreset {
  name: string;
  project: string;
  model: string;
  reasoning: string | null;
}

export interface DiscoveredSession extends SessionPreset {
  sessionId: string;
  createdAt: string;
}

export interface DiscoveryResult {
  sessions: DiscoveredSession[];
  warning: string | null;
}

export interface AgentProvider {
  readonly id: ProviderId;
  readonly name: string;
  // Build-time availability. Runtime connection settings cannot override this.
  readonly enabled: boolean;
  readonly connected: boolean;
  connect(): Promise<void>;
  configuration(): Promise<ProviderConfiguration>;
  createSession(preset: SessionPreset): Promise<{ sessionId: string; warning: string | null }>;
  // Observation must never load a session, submit work, or resolve an approval.
  // Discovery is read-only; providers without a supported listing API omit it.
  discoverSessions?(projects: string[], excludedSessionIds: string[]): Promise<DiscoveryResult>;
  readSession(agent: Agent): Promise<AgentObservation>;
  // Explicit creation action only; never called by observation or on reconnect.
  startTask?(agent: Agent, prompt: string): Promise<void>;
  // A creation-only prompt is handed to the interactive terminal, never monitoring.
  openTerminal(agent: Agent, initialPrompt?: string): Promise<void>;
  close(): Promise<void>;
}
