import type { Agent } from '../shared/types';

export function projectName(path: string) {
  return path.split('/').filter(Boolean).pop() || path;
}
export function hasWaitingWorker(agent: Agent) {
  return !!agent.workers?.some(
    (worker) => worker.connection === 'connected' && worker.status === 'waiting',
  );
}
export function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}
export function seen(value: string | null, now: number) {
  if (!value) return 'Not seen yet';
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 15) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
