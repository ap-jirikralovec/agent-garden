import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { hostPlatform, runWindowsScript, wslDistroName, type HostPlatform } from './platform.js';

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

export function launchScript(
  command: TerminalCommand,
  ttyFile?: string,
  shell = '/bin/zsh',
): string {
  const environment = Object.entries(command.env ?? {})
    .map(([key, value]) => {
      if (!/^[a-z_][a-z0-9_]*$/i.test(key))
        throw new Error('Invalid terminal environment variable.');
      return `export ${key}=${shellQuote(value)}\n`;
    })
    .join('');
  const args = [command.executable, ...command.args];
  const directory = command.cwd ? `cd ${shellQuote(command.cwd)} || exit 1\n` : '';
  const rememberTerminal = ttyFile
    ? `tty > ${shellQuote(ttyFile)}\nprintf '%s\\n' "$$" > ${shellQuote(ttyFile + '.pid')}\n`
    : '';
  return `#!${shell}\n${environment}${directory}${rememberTerminal}exec ${args.map(shellQuote).join(' ')}\n`;
}

export class TerminalLauncher {
  constructor(
    private directory: string,
    private platform: HostPlatform = hostPlatform(),
    private env: NodeJS.ProcessEnv = process.env,
  ) {}

  async focus(id: string, expectedPid?: number): Promise<boolean> {
    if (this.platform !== 'macos') return false;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Garden agent identifier.');
    if (!Number.isSafeInteger(expectedPid) || !expectedPid || expectedPid < 1) return false;
    let tty: string;
    try {
      const file = join(this.directory, 'launchers', `${id}.tty`);
      tty = (await readFile(file, 'utf8')).trim();
      if (Number((await readFile(file + '.pid', 'utf8')).trim()) !== expectedPid) return false;
    } catch {
      return false;
    }
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
      const { stdout } = await execute('/usr/bin/osascript', ['-e', script, tty], {
        timeout: 10000,
      });
      return stdout.trim() === 'found';
    } catch {
      return false;
    }
  }

  async open(id: string, command: TerminalCommand): Promise<void> {
    if (this.platform === 'unsupported')
      throw new Error('Opening terminals is unsupported on this system.');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Garden agent identifier.');
    if (this.platform === 'windows') {
      // A detached console process uses the user's default Windows terminal host.
      // Argument arrays keep project paths and native session IDs out of a shell.
      const child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ...command.env },
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      });
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
        child.unref();
      } catch {
        throw new Error('Could not open a terminal. Your session is saved; retry Open terminal.');
      }
      return;
    }
    const directory = join(this.directory, 'launchers');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${id}.${this.platform === 'macos' ? 'command' : 'sh'}`);
    await writeFile(
      path,
      launchScript(
        command,
        this.platform === 'macos' ? join(directory, `${id}.tty`) : undefined,
        this.platform === 'macos' ? '/bin/zsh' : '/bin/sh',
      ),
      { mode: 0o700 },
    );
    await chmod(path, 0o700);
    if (this.platform === 'wsl') {
      const payload = Buffer.from(
        JSON.stringify({ distro: wslDistroName(this.env), script: path }),
        'utf8',
      ).toString('base64');
      const source = `
$ErrorActionPreference = 'Stop'
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
if (-not (Get-Command wt.exe -ErrorAction SilentlyContinue)) { throw 'Windows Terminal is unavailable.' }
& wt.exe -w 0 new-tab wsl.exe --distribution $inputData.distro --exec /bin/sh $inputData.script
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`;
      try {
        await runWindowsScript(source);
      } catch {
        throw new Error(
          'Could not open Windows Terminal. Your session is saved; retry Open terminal.',
        );
      }
      return;
    }
    if (this.platform === 'linux') {
      const kde = (this.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase().split(':').includes('kde');
      const desktopTerminals = kde ? ['konsole', 'gnome-terminal'] : ['gnome-terminal', 'konsole'];
      for (const terminal of ['xdg-terminal-exec', 'x-terminal-emulator', ...desktopTerminals]) {
        const args =
          terminal === 'xdg-terminal-exec'
            ? ['/bin/sh', path]
            : terminal === 'gnome-terminal'
              ? ['--', '/bin/sh', path]
              : ['-e', '/bin/sh', path];
        try {
          const child = spawn(terminal, args, {
            env: { ...process.env, ...this.env },
            detached: true,
            stdio: 'ignore',
          });
          await new Promise<void>((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
          });
          child.unref();
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw new Error(
            'Could not open a terminal. Your session is saved; retry Open terminal.',
            {
              cause: error,
            },
          );
        }
      }
      throw new Error('Could not open a terminal. Your session is saved; retry Open terminal.');
    }
    try {
      // Launch Services uses the user's .command file association. Terminal.app is the fallback.
      await execute('/usr/bin/open', [path], { timeout: 10000 });
    } catch {
      try {
        await execute('/usr/bin/open', ['-a', 'Terminal', path], { timeout: 10000 });
      } catch {
        throw new Error('Could not open a terminal. Your session is saved; retry Open terminal.');
      }
    }
  }
}
