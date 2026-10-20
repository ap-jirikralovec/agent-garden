import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ClaudeProvider,
  claudeCommand,
  observeClaude,
} from '../src/server/providers/claude/index.js';
import { modelConfiguration, type ClaudeSession } from '../src/server/providers/claude/cli.js';
import { ClaudeObservations } from '../src/server/providers/claude/observation.js';
import { launchScript, type TerminalCommand } from '../src/server/terminal.js';
import { dataDirectory } from '../src/server/dataDirectory.js';
import type { Agent } from '../src/shared/types.js';

const folders: string[] = [];
const execute = promisify(execFile);
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const makeAgent = (): Agent => ({
  id: randomUUID(),
  origin: 'garden',
  provider: 'claude',
  sessionId: randomUUID(),
  name: 'Clove',
  project: '/tmp/project',
  model: 'sonnet',
  reasoning: 'medium',
  task: '',
  status: 'idle',
  connection: 'disconnected',
  detail: null,
  lastSeen: null,
  createdAt: new Date().toISOString(),
});

it('uses Claude model-specific effort choices and structured states without guessing from prose', () => {
  expect(
    modelConfiguration([
      {
        value: 'default',
        displayName: 'Default',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'high', 'max'],
      },
      { value: 'haiku', displayName: 'Haiku' },
    ]),
  ).toEqual({
    defaultModel: 'default',
    models: [
      {
        id: 'default',
        name: 'Default',
        defaultReasoning: 'low',
        reasoningLevels: ['low', 'high', 'max'].map((id) => ({ id, name: id })),
      },
      { id: 'haiku', name: 'Haiku', defaultReasoning: null, reasoningLevels: [] },
    ],
  });
  const agent = makeAgent();
  const session: ClaudeSession = {
    sessionId: agent.sessionId,
    kind: 'background',
    cwd: agent.project,
    state: 'working',
    status: 'idle',
  };
  expect(observeClaude(agent, session, []).status).toBe('working');
  expect(
    observeClaude(agent, { ...session, state: 'blocked', waitingFor: 'permission prompt' }, [])
      .status,
  ).toBe('waiting');
  expect(observeClaude(agent, { ...session, state: 'done' }, []).status).toBe('finished');
  expect(observeClaude(agent, { ...session, state: 'failed' }, []).status).toBe('failed');
  const stale = observeClaude(
    { ...agent, status: 'working', task: 'Ask for a color?', lastSeen: '2026-01-01T00:00:00.000Z' },
    undefined,
    [],
  );
  expect(stale).toMatchObject({
    status: 'working',
    connection: 'disconnected',
    task: 'Ask for a color?',
    lastSeen: '2026-01-01T00:00:00.000Z',
  });
});

it('opens the exact reserved UUID, focuses live interactive sessions, attaches backgrounds and resumes saved work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-claude-'));
  folders.push(directory);
  let sessions: ClaudeSession[] = [];
  const commands: { id: string; command: TerminalCommand }[] = [];
  const focused: string[] = [];
  let canFocus = true;
  const observations = new ClaudeObservations(directory);
  const adapter = new ClaudeProvider(
    {
      executable: '/bin/echo',
      async sessions() {
        return sessions;
      },
      async configuration() {
        return { defaultModel: '', models: [] };
      },
    },
    observations,
    {
      async open(id, command) {
        commands.push({ id, command });
      },
      async focus(id) {
        focused.push(id);
        return canFocus;
      },
    },
  );
  const agent = makeAgent();
  const preset = await adapter.createSession(agent);
  agent.sessionId = preset.sessionId;
  expect(commands).toHaveLength(0); // Creating a preset submits no task.
  await adapter.openTerminal(agent);
  expect(commands[0].id).toBe(agent.id);
  expect(commands[0].command.args).toEqual([
    '--session-id',
    agent.sessionId,
    '--settings',
    expect.any(String),
    '--name',
    'Clove',
    '--model',
    'sonnet',
    '--effort',
    'medium',
  ]);
  expect(commands[0].command.cwd).toBe(agent.project);
  sessions = [
    { sessionId: agent.sessionId, kind: 'interactive', cwd: agent.project, status: 'waiting' },
  ];
  await adapter.openTerminal(agent);
  expect(focused).toEqual([agent.id]);
  expect(commands).toHaveLength(1);
  canFocus = false;
  await expect(adapter.openTerminal(agent)).rejects.toThrow('already open');
  expect(commands).toHaveLength(1);
  sessions = [{ ...sessions[0], kind: 'background', id: 'native-job-id', state: 'blocked' }];
  await adapter.openTerminal(agent);
  expect(commands[1].command.args).toEqual(['attach', 'native-job-id']);
  sessions = [];
  const settingsPath = await observations.settings(agent.sessionId);
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const hook = settings.hooks.UserPromptSubmit[0].hooks[0].command;
  const event = {
    session_id: agent.sessionId,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Fix the parser',
    cwd: directory,
  };
  const result = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
    const child = execFile('/bin/zsh', ['-c', hook], (error, stdout) =>
      error ? reject(error) : resolve({ stdout, code: child.exitCode }),
    );
    child.stdin!.end(JSON.stringify(event));
  });
  expect(result.stdout).toBe('');
  expect((await observations.read(agent.sessionId))[0].task).toBe('Fix the parser');
  await adapter.openTerminal(agent);
  expect(commands[2].command.args).toEqual([
    '--resume',
    agent.sessionId,
    '--settings',
    settingsPath,
  ]);
  expect((await adapter.readSession(agent)).task).toBe('Fix the parser');
});

it('quotes Claude arguments and refuses to launch when the project directory is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-claude-'));
  folders.push(directory);
  const agent = { ...makeAgent(), project: directory, name: "it's $(printf INJECTED)" };
  const { stdout } = await execute('/bin/zsh', [
    '-c',
    launchScript(claudeCommand(agent, "/tmp/settings ' $().json", false, '/bin/echo')),
  ]);
  expect(stdout).toContain(agent.name);
  expect(stdout).toContain(agent.sessionId);
  expect(stdout).not.toContain('--dangerously-skip-permissions');
  await expect(
    execute('/bin/zsh', [
      '-c',
      launchScript({
        executable: '/bin/echo',
        args: ['should not run'],
        cwd: join(directory, 'missing'),
      }),
    ]),
  ).rejects.toMatchObject({ code: 1 });
});

it('keeps existing cards through the Agent Garden rename and honors an explicit data directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'garden-rename-'));
  folders.push(home);
  const current = join(home, 'Library', 'Application Support', 'Agent Garden');
  const legacy = join(home, 'Library', 'Application Support', 'Codex Garden');
  expect(await dataDirectory(undefined, home)).toBe(current);
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'agents.json'), '{}');
  expect(await dataDirectory(undefined, home)).toBe(legacy);
  await mkdir(current, { recursive: true });
  await writeFile(join(current, 'agents.json'), '{}');
  expect(await dataDirectory(undefined, home)).toBe(current);
  expect(await dataDirectory('/tmp/custom-garden', home)).toBe('/tmp/custom-garden');
});
