import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

const execute = promisify(execFile);

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export interface TerminalCommand {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export function launchScript(command: TerminalCommand, ttyFile?: string): string {
  const environment = Object.entries(command.env ?? {}).map(([key, value]) => {
    if (!/^[a-z_][a-z0-9_]*$/i.test(key)) throw new Error('Invalid terminal environment variable.');
    return `export ${key}=${shellQuote(value)}\n`;
  }).join('');
  const args = [command.executable, ...command.args];
  const directory = command.cwd ? `cd -- ${shellQuote(command.cwd)} || exit 1\n` : '';
  const rememberTerminal = ttyFile ? `tty > ${shellQuote(ttyFile)}\nprintf '%s\\n' "$$" > ${shellQuote(ttyFile + '.pid')}\n` : '';
  return `#!/bin/zsh\n${environment}${directory}${rememberTerminal}exec ${args.map(shellQuote).join(' ')}\n`;
}

export class TerminalLauncher {
  constructor(private directory: string) {}

  async focus(id: string, expectedPid?: number): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Garden agent identifier.');
    if (!Number.isSafeInteger(expectedPid) || !expectedPid || expectedPid < 1) return false;
    let tty: string;
    try {
      const file = join(this.directory, 'launchers', `${id}.tty`);
      tty = (await readFile(file, 'utf8')).trim();
      if (Number((await readFile(file + '.pid', 'utf8')).trim()) !== expectedPid) return false;
    }
    catch { return false; }
    if (!/^\/dev\/ttys\d+$/.test(tty)) return false;
    // Focus only: never start a second writer for an already-live conversation.
    const script = `on run argv
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is item 1 of argv then
        set selected tab of w to t
        set index of w to 1
        activate
        return "found"
      end if
    end repeat
  end repeat
end tell
return "missing"
end run`;
    try {
      const { stdout } = await execute('/usr/bin/osascript', ['-e', script, tty], { timeout: 10000 });
      return stdout.trim() === 'found';
    } catch { return false; }
  }

  async open(id: string, command: TerminalCommand): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('Opening terminals is currently supported on macOS only.');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Garden agent identifier.');
    const directory = join(this.directory, 'launchers');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${id}.command`);
    await writeFile(path, launchScript(command, join(directory, `${id}.tty`)), { mode: 0o700 });
    await chmod(path, 0o700);
    try {
      // Launch Services uses the user's .command file association. Terminal.app is the fallback.
      await execute('/usr/bin/open', [path], { timeout: 10000 });
    } catch {
      try { await execute('/usr/bin/open', ['-a', 'Terminal', path], { timeout: 10000 }); }
      catch { throw new Error('Could not open a terminal. Your session is saved; retry Open terminal.'); }
    }
  }
}
