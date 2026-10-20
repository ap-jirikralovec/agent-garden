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
  | 'workers'
  | 'workersError'
>;

export interface SessionPreset {
  name: string;
  project: string;
  model: string;
  reasoning: string | null;
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
  readSession(agent: Agent): Promise<AgentObservation>;
  openTerminal(agent: Agent): Promise<void>;
  close(): Promise<void>;
}
