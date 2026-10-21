import type { Agent, AgentStatus, AgentWorker, Connection } from '../shared/types';

export interface StatusAlert {
  agentId: string;
  kind: 'waiting' | 'finished';
  title: string;
  body: string;
}

interface ObservedAgent {
  status: AgentStatus;
  connection: Connection;
  workers: Map<string, Pick<AgentWorker, 'status' | 'connection'>>;
}

export class NotificationTracker {
  private previous = new Map<string, ObservedAgent>();
  private ready = false;

  observe(agents: Agent[], browserConnected: boolean): StatusAlert[] {
    if (!browserConnected) {
      this.ready = false;
      this.previous.clear();
      return [];
    }
    const current = new Map<string, ObservedAgent>();
    const alerts: StatusAlert[] = [];
    for (const agent of agents) {
      const workers = new Map(
        (agent.workers ?? []).map((worker) => [
          worker.id,
          { status: worker.status, connection: worker.connection },
        ]),
      );
      current.set(agent.id, { status: agent.status, connection: agent.connection, workers });
      if (!this.ready || agent.connection !== 'connected') continue;
      const previous = this.previous.get(agent.id);
      if (!previous || previous.connection !== 'connected') continue;
      if (agent.status === 'waiting' && previous.status !== 'waiting') {
        alerts.push({
          agentId: agent.id,
          kind: 'waiting',
          title: `${agent.name} needs input`,
          body: 'Open Garden to respond in the terminal.',
        });
        continue;
      }
      const waitingWorker = agent.workers?.find((worker) => {
        const before = previous.workers.get(worker.id);
        return (
          worker.connection === 'connected' &&
          worker.status === 'waiting' &&
          before?.connection === 'connected' &&
          before.status !== 'waiting'
        );
      });
      if (waitingWorker) {
        alerts.push({
          agentId: agent.id,
          kind: 'waiting',
          title: `${waitingWorker.name} needs input`,
          body: `Open ${agent.name} in Garden to respond.`,
        });
      } else if (agent.status === 'finished' && previous.status !== 'finished') {
        alerts.push({
          agentId: agent.id,
          kind: 'finished',
          title: `${agent.name} response finished`,
          body: 'Open Garden to review the response.',
        });
      }
    }
    this.previous = current;
    this.ready = true;
    return alerts;
  }
}
