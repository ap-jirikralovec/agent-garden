import { expect, it } from 'vitest';
import type { Agent } from '../src/shared/types';
import { faviconState } from '../src/client/favicon';

function agent(status: Agent['status'], connection: Agent['connection'] = 'connected'): Agent {
  return {
    id: 'garden-agent',
    origin: 'garden',
    provider: 'codex',
    sessionId: 'native-session',
    name: 'Miso',
    project: '/tmp/project',
    model: 'test',
    reasoning: null,
    task: '',
    status,
    connection,
    detail: null,
    lastSeen: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

it('uses the plain sprout when no visible work is live', () => {
  expect(faviconState([], true)).toBe('default');
  expect(faviconState([agent('finished')], true)).toBe('default');
  expect(faviconState([agent('working', 'disconnected')], true)).toBe('default');
  expect(faviconState([agent('waiting')], false)).toBe('default');
});

it('shows running work and gives input requests priority', () => {
  expect(faviconState([agent('working')], true)).toBe('running');
  expect(faviconState([agent('working'), agent('waiting')], true)).toBe('waiting');
});

it('includes live subagents without promoting stale worker states', () => {
  const parent = agent('idle');
  parent.workers = [
    {
      id: 'worker',
      parentSessionId: parent.sessionId,
      name: 'Scout',
      project: parent.project,
      model: null,
      task: '',
      status: 'working',
      connection: 'connected',
      lastSeen: null,
      detail: null,
    },
  ];
  expect(faviconState([parent], true)).toBe('running');
  parent.workers[0].status = 'waiting';
  expect(faviconState([parent], true)).toBe('waiting');
  parent.workers[0].connection = 'disconnected';
  expect(faviconState([parent], true)).toBe('default');
  parent.workers[0].connection = 'connected';
  parent.connection = 'disconnected';
  expect(faviconState([parent], true)).toBe('default');
});
