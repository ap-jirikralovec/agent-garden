import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentWorker } from '../../../shared/types.js';
import { shellQuote } from '../../terminal.js';

export const observationEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;
const workerEvents = [
  'SubagentStart',
  'SubagentStop',
  'PermissionRequest',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'StopFailure',
  'TeammateIdle',
] as const;
export interface ClaudeEvent {
  event: (typeof observationEvents)[number];
  at: string;
  project?: string;
  model?: string;
  task?: string;
  transcript?: string;
}

// This standalone hook remains available across npm upgrades. It never writes
// stdout, makes approval decisions, or alters the conversation. Errors fail open.
export const hookSource = `const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 2097152) process.exit(0); });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const [directory, sessionId] = process.argv.slice(2);
    const events = ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'];
    if (data.session_id !== sessionId) return;
    const workerEvents = ['SubagentStart', 'SubagentStop', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'TeammateIdle'];
    const worker = typeof data.agent_id === 'string' && /^[a-z0-9_-]{1,160}$/i.test(data.agent_id);
    if (worker ? !workerEvents.includes(data.hook_event_name) : !events.includes(data.hook_event_name)) return;
    const event = { event: data.hook_event_name, at: new Date().toISOString() };
    if (typeof data.cwd === 'string') event.project = data.cwd;
    if (typeof data.model === 'string') event.model = data.model;
    if (typeof data.prompt === 'string') event.task = data.prompt.slice(0, 4000);
    if (typeof data.transcript_path === 'string') event.transcript = data.transcript_path;
    let targetDirectory = directory;
    if (worker) {
      targetDirectory = path.join(directory, 'workers', data.agent_id);
      event.agentId = data.agent_id;
      if (typeof data.agent_type === 'string') event.name = data.agent_type;
      event.status = data.hook_event_name === 'StopFailure' ? 'failed'
        : ['SubagentStop', 'TeammateIdle'].includes(data.hook_event_name) ? 'finished'
        : data.hook_event_name === 'PermissionRequest' || (data.hook_event_name === 'PreToolUse' && data.tool_name === 'AskUserQuestion') ? 'waiting' : 'working';
      if (typeof data.tool_input?.description === 'string') event.task = data.tool_input.description.slice(0, 4000);
      else if (typeof data.tool_name === 'string') event.task = 'Using ' + data.tool_name.slice(0, 200);
    }
    fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    const target = path.join(targetDirectory, data.hook_event_name + '.json');
    const temporary = target + '.' + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(event), { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch { /* Observation must not block Claude. */ }
});
`;

export class ClaudeObservations {
  constructor(private directory: string) {}
  private sessionDirectory(sessionId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid Claude session identifier.');
    return join(this.directory, 'claude', sessionId);
  }

  async settings(sessionId: string) {
    const directory = this.sessionDirectory(sessionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const script = join(this.directory, 'claude', 'observe.cjs');
    await writeFile(script, hookSource, { mode: 0o600 });
    const command = [process.execPath, script, directory, sessionId].map(shellQuote).join(' ');
    const settings = join(directory, 'settings.json');
    await writeFile(
      settings,
      JSON.stringify({
        defaultToAgentsView: false,
        hooks: Object.fromEntries(
          [...new Set([...observationEvents, ...workerEvents])].map((event) => [
            event,
            [{ hooks: [{ type: 'command', command, timeout: 3 }] }],
          ]),
        ),
      }),
      { mode: 0o600 },
    );
    return settings;
  }

  async read(sessionId: string): Promise<ClaudeEvent[]> {
    const directory = this.sessionDirectory(sessionId);
    const events = await Promise.all(
      observationEvents.map(async (event) => {
        try {
          const result = JSON.parse(
            await readFile(join(directory, `${event}.json`), 'utf8'),
          ) as ClaudeEvent;
          if (
            result.event !== event ||
            !Number.isFinite(Date.parse(result.at)) ||
            [result.project, result.model, result.task, result.transcript].some(
              (value) => value !== undefined && typeof value !== 'string',
            )
          ) {
            throw new Error('Invalid Claude observation.');
          }
          return result;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }),
    );
    return events
      .filter((event): event is ClaudeEvent => event !== null)
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  async workers(sessionId: string, parentLive: boolean, previous: AgentWorker[]) {
    const directory = join(this.sessionDirectory(sessionId), 'workers');
    let ids: string[];
    try {
      ids = (await readdir(directory)).filter((id) => /^[a-z0-9_-]{1,160}$/i.test(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ids = [];
    }
    const workers: AgentWorker[] = [];
    for (const id of ids.slice(0, 200)) {
      const events = [];
      for (const name of workerEvents) {
        try {
          const event = JSON.parse(await readFile(join(directory, id, `${name}.json`), 'utf8'));
          if (
            event.agentId !== id ||
            !Number.isFinite(Date.parse(event.at)) ||
            !['working', 'waiting', 'finished', 'failed'].includes(event.status) ||
            [event.name, event.task, event.project].some(
              (value) => value !== undefined && typeof value !== 'string',
            )
          )
            throw new Error('Invalid worker observation.');
          events.push(event);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      events.sort((a, b) => a.at.localeCompare(b.at));
      // Ignore Claude's internal side agents that only emit a Stop event.
      if (!events.some((event) => event.event === 'SubagentStart')) continue;
      const latest = events.at(-1)!;
      const old = previous.find((worker) => worker.id === id);
      workers.push({
        id,
        parentSessionId: sessionId,
        name: events.find((event) => event.name)?.name || `Worker ${id}`,
        project: latest.project ?? old?.project ?? '',
        model: null,
        task: [...events].reverse().find((event) => event.task)?.task ?? old?.task ?? '',
        status: latest.status,
        connection: parentLive ? 'connected' : 'disconnected',
        lastSeen: latest.at,
        detail: parentLive
          ? 'Last observed Claude lifecycle event. Respond through the parent terminal.'
          : 'Parent session is not running; last observed worker state is retained.',
      });
    }
    for (const old of previous) {
      if (workers.length >= 200) break;
      if (!workers.some((worker) => worker.id === old.id))
        workers.push({ ...old, connection: 'disconnected' });
    }
    return {
      workers,
      workersError: ids.length > 200 ? 'Showing the first 200 observed workers.' : null,
    };
  }
}
