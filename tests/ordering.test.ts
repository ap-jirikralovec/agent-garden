import { expect, it } from 'vitest';
import { sortRecentAgents, sortRecentProjects } from '../src/server/ordering';
import type { Agent, Project } from '../src/shared/types';

function agent(id: string, project: string, createdAt: string, lastActiveAt?: string): Agent {
  return {
    id,
    origin: 'garden',
    provider: 'codex',
    sessionId: id,
    name: id,
    project,
    model: 'test',
    reasoning: null,
    task: '',
    status: 'idle',
    connection: 'disconnected',
    detail: null,
    lastSeen: '2026-10-20T12:00:00.000Z',
    createdAt,
    ...(lastActiveAt ? { lastActiveAt } : {}),
  };
}

it('orders agents by conversation activity and falls back to creation time', () => {
  const agents = [
    agent('recent', '/recent', '2026-10-18T00:00:00.000Z', '2026-10-20T09:00:00.000Z'),
    agent('new', '/new', '2026-10-19T00:00:00.000Z'),
    agent('old', '/old', '2026-10-17T00:00:00.000Z', '2026-10-18T00:00:00.000Z'),
  ];
  expect(sortRecentAgents(agents).map((item) => item.id)).toEqual(['recent', 'new', 'old']);
  expect(agents.map((item) => item.id)).toEqual(['recent', 'new', 'old']);
});

it('orders projects by their most recently active tracked agent, leaving empty projects last', () => {
  const projects: Project[] = [
    { path: '/empty', name: 'Empty' },
    { path: '/older', name: 'Older' },
    { path: '/recent', name: 'Recent' },
    { path: '/empty-two', name: 'Empty too' },
  ];
  const agents = [
    agent('older', '/older', '2026-10-18T00:00:00.000Z'),
    agent('recent', '/recent', '2026-10-17T00:00:00.000Z', '2026-10-20T09:00:00.000Z'),
    agent('also-old', '/recent', '2026-10-16T00:00:00.000Z'),
  ];
  expect(sortRecentProjects(projects, agents).map((project) => project.path)).toEqual([
    '/recent',
    '/older',
    '/empty',
    '/empty-two',
  ]);
});
