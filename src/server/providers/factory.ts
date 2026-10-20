import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { TerminalLauncher } from '../terminal.js';
import { CodexProvider } from './codex/index.js';
import { CodexRpc } from './codex/rpc.js';
import { ClaudeProvider } from './claude/index.js';
import { ClaudeCli } from './claude/cli.js';
import { ClaudeObservations } from './claude/observation.js';
import type { AgentProvider } from './provider.js';

async function findExecutable(name: string) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const path = join(directory, name);
    try {
      await access(path, constants.X_OK);
      return await realpath(path);
    } catch {
      /* Continue searching PATH. */
    }
  }
  return name;
}

export async function createProviders(directory: string): Promise<AgentProvider[]> {
  const terminal = new TerminalLauncher(directory);
  const [codex, claude] = await Promise.all([findExecutable('codex'), findExecutable('claude')]);
  return [
    new CodexProvider(new CodexRpc({ command: codex }), terminal, codex),
    new ClaudeProvider(
      new ClaudeCli(claude, directory),
      new ClaudeObservations(directory),
      terminal,
    ),
  ];
}
