import { expect, it } from 'vitest';
import { NotificationTracker } from '../src/client/browserNotifications';
import type { Agent, AgentWorker } from '../src/shared/types';

function agent(status: Agent['status'], connection: Agent['connection'] = 'connected'): Agent {
  return {
    id: 'garden-one',
    origin: 'garden',
    provider: 'codex',
    sessionId: 'native-one',
    name: 'Miso',
    project: '/work/app',
    model: 'test',
    reasoning: null,
    task: '',
    status,
    connection,
    detail: null,
    lastSeen: null,
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function worker(
  status: AgentWorker['status'],
  connection: AgentWorker['connection'] = 'connected',
): AgentWorker {
  return {
    id: 'worker-one',
    parentSessionId: 'native-one',
    name: 'Scout',
    project: '/work/app',
    model: null,
    task: '',
    status,
    connection,
    lastSeen: null,
    detail: null,
  };
}

it('alerts only when an already observed agent enters waiting or finishes a response', () => {
  const tracker = new NotificationTracker();
  expect(tracker.observe([agent('waiting')], true)).toEqual([]);
  expect(tracker.observe([agent('waiting')], true)).toEqual([]);
  expect(tracker.observe([agent('working')], true)).toEqual([]);
  expect(tracker.observe([agent('waiting')], true)).toEqual([
    {
      agentId: 'garden-one',
      kind: 'waiting',
      title: 'Miso needs input',
      body: 'Open Garden to respond in the terminal.',
    },
  ]);
  expect(tracker.observe([agent('waiting')], true)).toEqual([]);
  expect(tracker.observe([agent('working')], true)).toEqual([]);
  expect(tracker.observe([agent('finished')], true)).toEqual([
    {
      agentId: 'garden-one',
      kind: 'finished',
      title: 'Miso response finished',
      body: 'Open Garden to review the response.',
    },
  ]);
});

it('treats browser and provider reconnections as a fresh baseline', () => {
  const tracker = new NotificationTracker();
  tracker.observe([agent('working')], true);
  expect(tracker.observe([agent('working')], false)).toEqual([]);
  expect(tracker.observe([agent('waiting')], true)).toEqual([]);
  expect(tracker.observe([agent('working', 'disconnected')], true)).toEqual([]);
  expect(tracker.observe([agent('finished')], true)).toEqual([]);
});

it('alerts for a newly waiting subagent without promoting stale or newly discovered workers', () => {
  const tracker = new NotificationTracker();
  tracker.observe([{ ...agent('working'), workers: [worker('working')] }], true);
  expect(tracker.observe([{ ...agent('working'), workers: [worker('waiting')] }], true)).toEqual([
    {
      agentId: 'garden-one',
      kind: 'waiting',
      title: 'Scout needs input',
      body: 'Open Miso in Garden to respond.',
    },
  ]);
  expect(tracker.observe([{ ...agent('working'), workers: [worker('waiting')] }], true)).toEqual(
    [],
  );
  expect(
    tracker.observe([{ ...agent('working'), workers: [worker('waiting', 'disconnected')] }], true),
  ).toEqual([]);
  expect(tracker.observe([{ ...agent('working'), workers: [worker('waiting')] }], true)).toEqual(
    [],
  );
  expect(
    tracker.observe(
      [{ ...agent('working'), workers: [worker('waiting'), { ...worker('waiting'), id: 'new' }] }],
      true,
    ),
  ).toEqual([]);
});

it('prioritizes a new input request over a simultaneous finished response', () => {
  const tracker = new NotificationTracker();
  tracker.observe([{ ...agent('working'), workers: [worker('working')] }], true);
  expect(tracker.observe([{ ...agent('finished'), workers: [worker('waiting')] }], true)).toEqual([
    {
      agentId: 'garden-one',
      kind: 'waiting',
      title: 'Scout needs input',
      body: 'Open Miso in Garden to respond.',
    },
  ]);
});
