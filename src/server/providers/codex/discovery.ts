import { realpath } from 'node:fs/promises';
import { isAbsolute, win32 } from 'node:path';
import type { DiscoveryResult } from '../provider.js';
import type { Rpc, Thread } from './protocol.js';

export async function discoverCodexSessions(
  rpc: Rpc,
  projects: string[],
  excludedSessionIds: string[],
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { sessions: [], warning: null };
  if (!projects.length) return result;
  const projectKey = (path: string) =>
    process.platform === 'win32' ? win32.normalize(path).toLowerCase() : path;
  const saved = new Map(projects.map((project) => [projectKey(project), project]));
  const excluded = new Set(excludedSessionIds);
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    pages++;
    const page: { data: string[]; nextCursor: string | null } = await rpc.request(
      'thread/loaded/list',
      { cursor, limit: 100 },
    );
    for (const id of page.data) {
      if (typeof id !== 'string' || !id || id.length > 4096 || seen.has(id)) continue;
      if (seen.size >= 200) break;
      seen.add(id);
      if (excluded.has(id)) continue;
      try {
        const { thread } = await rpc.request<{ thread: Thread }>('thread/read', {
          threadId: id,
          includeTurns: false,
        });
        // Loaded children and internal review/compaction agents belong under their parent.
        if (
          thread.id !== id ||
          thread.status.type === 'notLoaded' ||
          thread.parentThreadId ||
          (typeof thread.source === 'object' &&
            thread.source !== null &&
            'subAgent' in thread.source) ||
          !['idle', 'active', 'systemError'].includes(thread.status.type) ||
          !isAbsolute(thread.cwd)
        )
          continue;
        const project = await realpath(thread.cwd);
        const savedProject = saved.get(projectKey(project));
        if (!savedProject) continue;
        const date =
          typeof thread.createdAt === 'number' ? new Date(thread.createdAt * 1000) : new Date();
        result.sessions.push({
          sessionId: id,
          name: (
            thread.name?.trim().split('\n')[0] ||
            thread.preview.trim().split('\n')[0] ||
            `Codex ${id.slice(0, 8)}`
          )
            .replace(/\p{Cc}/gu, ' ')
            .slice(0, 60),
          project: savedProject,
          model: typeof thread.model === 'string' ? thread.model : '',
          reasoning: typeof thread.reasoningEffort === 'string' ? thread.reasoningEffort : null,
          createdAt: Number.isFinite(date.getTime())
            ? date.toISOString()
            : new Date().toISOString(),
        });
      } catch {
        if (!rpc.connected) throw new Error('Codex disconnected during discovery.');
        result.warning = 'Some open Codex sessions could not be inspected. Discovery will retry.';
      }
    }
    cursor = page.nextCursor;
    if ((pages >= 2 && cursor) || (seen.size >= 200 && page.data.some((id) => !seen.has(id)))) {
      result.warning =
        'Discovery checked the first 200 loaded Codex sessions. Additional sessions are omitted.';
      break;
    }
  } while (cursor);
  return result;
}
