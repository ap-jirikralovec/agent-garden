import { describe, expect, it } from 'vitest';
import { observe } from '../src/server/providers/codex/status.js';
import type { Agent } from '../src/shared/types.js';
import type { Thread, Turn } from '../src/server/providers/codex/protocol.js';

const agent: Agent = {
  id: 'one', provider: 'codex', sessionId: 'native-one', name: 'Miso', project: '/tmp/project', model: 'model', reasoning: 'medium',
  task: '', status: 'idle', connection: 'disconnected', lastSeen: null, detail: null,
  createdAt: '2026-10-19T00:00:00.000Z',
};
const thread = (type: Thread['status']['type'], flags: string[] = []): Thread => ({
  id: 'one', status: { type, activeFlags: flags }, cwd: agent.project, preview: '',
});
const turn = (status: Turn['status'], text = 'Build a garden'): Turn => ({
  id: 'turn', status, items: [{ type: 'userMessage', content: [{ type: 'text', text }] }],
});

describe('observing Codex sessions', () => {
  it('distinguishes work, input requests and approvals', () => {
    expect(observe(agent, thread('active'), turn('inProgress')).status).toBe('working');
    for (const flag of ['waitingOnApproval', 'waitingOnUserInput']) {
      expect(observe(agent, thread('active', [flag]), turn('inProgress')).status).toBe('waiting');
    }
  });
  it('uses the latest turn outcome instead of treating every idle session as finished', () => {
    expect(observe(agent, thread('idle')).status).toBe('idle');
    expect(observe(agent, thread('idle'), turn('completed')).status).toBe('finished');
    expect(observe(agent, thread('idle'), turn('failed')).status).toBe('failed');
    const stopped = observe(agent, thread('idle'), turn('interrupted'));
    expect(stopped.status).toBe('failed');
    expect(stopped.detail).toMatch(/interrupted/i);
  });
  it('retains last known state when a session is unloaded', () => {
    const previous = { ...agent, status: 'working' as const, task: 'Existing task', lastSeen: 'earlier' };
    const result = observe(previous, { ...thread('notLoaded'), model: 'global-default', reasoningEffort: 'low' });
    expect(result.connection).toBe('disconnected');
    expect(result.status).toBe('working');
    expect(result.lastSeen).toBe('earlier');
    expect(result.task).toBe('Existing task');
    expect(result.model).toBe(previous.model);
    expect(result.reasoning).toBe(previous.reasoning);
  });
  it('extracts the latest user task and tracks terminal-side model changes', () => {
    const result = observe(agent, { ...thread('active'), model: 'other', reasoningEffort: 'high' }, turn('inProgress', 'Fix the tests'));
    expect(result.task).toBe('Fix the tests');
    expect(result.model).toBe('other');
    expect(result.reasoning).toBe('high');
    expect(result.connection).toBe('connected');
  });
  it('reports a runtime error even when the last saved turn completed', () => {
    expect(observe(agent, thread('systemError'), turn('completed')).status).toBe('failed');
  });
});
