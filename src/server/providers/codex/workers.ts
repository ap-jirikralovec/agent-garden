import type { Agent, AgentWorker } from '../../../shared/types.js';
import type { Rpc, Thread, Turn } from './protocol.js';
import { observe } from './status.js';

export async function readCodexWorkers(
  rpc: Rpc,
  agent: Agent,
): Promise<{ workers: AgentWorker[]; workersError: string | null }> {
  const threads: Thread[] = [];
  let truncated = false;
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    do {
      const page: { data: Thread[]; nextCursor: string | null } = await rpc.request('thread/list', {
        ancestorThreadId: agent.sessionId,
        sourceKinds: ['subAgentThreadSpawn'],
        archived,
        limit: 100,
        cursor,
        sortDirection: 'asc',
        useStateDbOnly: true,
      });
      threads.push(...page.data);
      cursor = page.nextCursor;
      if (threads.length >= 200) {
        truncated = !!cursor || !archived || threads.length > 200;
        break;
      }
    } while (cursor);
    if (threads.length >= 200) break;
  }
  const candidates = new Map(threads.slice(0, 200).map((thread) => [thread.id, thread]));
  const descendants = new Map<string, string>();
  const parentOf = (thread: Thread) =>
    typeof thread.source === 'object'
      ? thread.source.subAgent?.thread_spawn?.parent_thread_id
      : undefined;
  // Also validate lineage locally so an ignored/unsupported filter cannot import
  // unrelated sessions. Repeat to accommodate children arriving before parents.
  for (let pass = 0; pass < candidates.size; pass++) {
    let added = false;
    for (const thread of candidates.values()) {
      const parent = parentOf(thread);
      if (
        !descendants.has(thread.id) &&
        parent &&
        thread.id !== agent.sessionId &&
        (parent === agent.sessionId || descendants.has(parent))
      ) {
        descendants.set(thread.id, parent);
        added = true;
      }
    }
    if (!added) break;
  }
  const previous = new Map((agent.workers ?? []).map((worker) => [worker.id, worker]));
  const workers: AgentWorker[] = [];
  for (const [id, parentSessionId] of descendants) {
    const thread = candidates.get(id)!;
    const old = previous.get(id);
    const base: AgentWorker = {
      id,
      parentSessionId,
      name: thread.agentNickname || thread.name || thread.agentRole || `Worker ${id.slice(0, 8)}`,
      project: thread.cwd,
      model: thread.model ?? old?.model ?? null,
      task: old?.task ?? thread.preview,
      status: old?.status ?? 'unknown',
      connection: 'disconnected',
      lastSeen: old?.lastSeen ?? null,
      detail: null,
    };
    try {
      const { data } = await rpc.request<{ data: Turn[] }>('thread/turns/list', {
        threadId: id,
        limit: 1,
        sortDirection: 'desc',
        itemsView: 'full',
      });
      const observation = observe(
        {
          ...agent,
          ...base,
          sessionId: id,
          model: base.model ?? '',
          status: base.status === 'unknown' ? 'idle' : base.status,
        },
        thread,
        data[0],
      );
      if (thread.status.type === 'notLoaded') {
        observation.status =
          data[0]?.status === 'completed'
            ? 'finished'
            : data[0]?.status === 'failed' || data[0]?.status === 'interrupted'
              ? 'failed'
              : old?.status === 'unknown' || !old
                ? 'idle'
                : old.status;
        observation.detail = 'Worker is not loaded. Showing its last recorded response.';
        if (!old?.lastSeen && thread.updatedAt)
          observation.lastSeen = new Date(thread.updatedAt * 1000).toISOString();
      }
      workers.push({
        ...base,
        ...observation,
        id,
        parentSessionId,
        model: observation.model || null,
        status:
          thread.status.type === 'notLoaded' && !data[0]
            ? (old?.status ?? 'unknown')
            : observation.status,
      });
    } catch {
      workers.push({
        ...base,
        detail: 'Could not read this worker. Last known state is retained.',
      });
    }
    previous.delete(id);
  }
  for (const old of previous.values()) {
    if (workers.length >= 200) {
      truncated = true;
      break;
    }
    workers.push({
      ...old,
      connection: 'disconnected',
      detail: 'This worker is no longer listed by Codex. Last known state is retained.',
    });
  }
  return {
    workers,
    workersError: truncated
      ? 'Showing the first 200 workers. Additional descendants are omitted.'
      : null,
  };
}
