// Codex-specific protocol surface, checked against Codex CLI 0.163.0.
// Keep runtime status separate from transport connectivity and persisted history.
export interface ThreadStatus {
  type: 'active' | 'idle' | 'systemError' | 'notLoaded';
  activeFlags?: string[];
}

export interface Turn {
  id: string;
  status: 'inProgress' | 'completed' | 'failed' | 'interrupted';
  error?: { message: string } | null;
  items: {
    type: string;
    content?: { type: string; text?: string }[];
  }[];
}

export interface Thread {
  id: string;
  status: ThreadStatus;
  model?: string | null;
  reasoningEffort?: string | null;
  preview: string;
  cwd: string;
  name?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  source?:
    | string
    | { custom?: string; subAgent?: string | { thread_spawn?: { parent_thread_id: string } } };
  parentThreadId?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface Rpc {
  readonly connected: boolean;
  connect(): Promise<void>;
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
  close(): void | Promise<void>;
}
