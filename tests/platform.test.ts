import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const native = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: native.run, spawn: native.spawn }));

import { dataDirectory } from '../src/server/dataDirectory.js';
import {
  pickProjectFolder,
  linuxFolderPath,
  windowsFolderPath,
  wslFolderPath,
} from '../src/server/folderPicker.js';
import { TerminalLauncher } from '../src/server/terminal.js';
import { executableCandidates } from '../src/server/providers/factory.js';
import {
  hostPlatform,
  isWindowsDriveMount,
  openBrowser,
  powershellCommand,
} from '../src/server/platform.js';

const folders: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sourceFromCall(call: unknown[]) {
  const [command, args] = call as [string, string[]];
  expect(command).toBe('powershell.exe');
  expect(args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand']);
  return Buffer.from(args[4], 'base64').toString('utf16le');
}

it('maps only folders in the current WSL distribution to Linux paths', () => {
  expect(wslFolderPath('\\\\wsl.localhost\\Ubuntu\\home\\ana\\my project', 'Ubuntu')).toBe(
    '/home/ana/my project',
  );
  expect(wslFolderPath('\\\\wsl$\\ubuntu\\home\\ana', 'Ubuntu')).toBe('/home/ana');
  expect(() => wslFolderPath('C:\\Users\\ana', 'Ubuntu')).toThrow('current WSL distribution');
  expect(() => wslFolderPath('\\\\wsl.localhost\\Debian\\home', 'Ubuntu')).toThrow(
    'current WSL distribution',
  );
  expect(() => wslFolderPath('\\\\wsl.localhost\\Ubuntu\\home\\..\\other', 'Ubuntu')).toThrow(
    'invalid',
  );
  expect(() => wslFolderPath('\\\\wsl.localhost\\Ubuntu\\mnt\\c\\Users', 'Ubuntu')).toThrow(
    'mounted Windows drive',
  );
  expect(isWindowsDriveMount('/mnt/c/Users')).toBe(true);
  expect(isWindowsDriveMount('/home/ana/project')).toBe(false);
});

it('routes WSL browser opening to the Windows host', async () => {
  expect(hostPlatform('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe('wsl');
  expect(hostPlatform('win32', {})).toBe('windows');
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '' }));
  await openBrowser('http://127.0.0.1:4317', 'wsl');
  expect(native.run.mock.calls[0].slice(0, 2)).toEqual(['explorer.exe', ['http://127.0.0.1:4317']]);
});

it('recognizes native Linux and opens its browser through xdg-open', async () => {
  expect(hostPlatform('linux', {})).toBe('linux');
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '' }));
  await openBrowser('http://127.0.0.1:4317', 'linux');
  expect(native.run.mock.calls[0].slice(0, 2)).toEqual(['xdg-open', ['http://127.0.0.1:4317']]);
});

it('uses the native Codex executable on Windows', () => {
  expect(executableCandidates('codex', 'win32')).toEqual(['codex.exe']);
  expect(executableCandidates('codex', 'darwin')).toEqual(['codex']);
});

it('opens the browser through the native Windows URL handler', async () => {
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '' }));
  await openBrowser('http://127.0.0.1:4317', 'windows');
  const source = sourceFromCall(native.run.mock.calls[0]);
  expect(source).toContain('Start-Process -FilePath $url');
  expect(source).not.toContain('127.0.0.1');
});

it('asks Windows for a WSL folder and rejects Windows drive selections', async () => {
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(null, { stdout: '\\\\wsl.localhost\\Ubuntu\\home\\ana\\project\r\n' }),
  );
  expect(await pickProjectFolder('wsl', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe('/home/ana/project');
  const source = sourceFromCall(native.run.mock.calls[0]);
  expect(source).toContain('FolderBrowserDialog');
  expect(source).toContain('ShowNewFolderButton = $true');
  expect(source).toContain('ConvertFrom-Json');
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(null, { stdout: 'C:\\Users\\ana\r\n' }),
  );
  await expect(pickProjectFolder('wsl', { WSL_DISTRO_NAME: 'Ubuntu' })).rejects.toThrow(
    'current WSL distribution',
  );
});

it('stores WSL metadata under XDG data home without changing macOS legacy lookup', async () => {
  expect(await dataDirectory(undefined, '/home/ana', 'wsl', {})).toBe(
    '/home/ana/.local/share/Agent Garden',
  );
  expect(
    await dataDirectory(undefined, '/home/ana', 'wsl', { XDG_DATA_HOME: '/home/ana/data' }),
  ).toBe('/home/ana/data/Agent Garden');
  expect(await dataDirectory(join(tmpdir(), 'garden'), '/home/ana', 'wsl', {})).toBe(
    join(tmpdir(), 'garden'),
  );
  expect(await dataDirectory(undefined, '/home/ana', 'linux', {})).toBe(
    '/home/ana/.local/share/Agent Garden',
  );
  expect(
    await dataDirectory(undefined, '/home/ana', 'linux', {
      XDG_DATA_HOME: '/home/ana/data',
    }),
  ).toBe('/home/ana/data/Agent Garden');
  await expect(dataDirectory(undefined, '/home/ana', 'unsupported', {})).rejects.toThrow(
    'requires macOS, Linux, WSL2, or Windows',
  );
});

it('uses GNOME and KDE folder dialogs with safe paths and cancellation', async () => {
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(null, { stdout: '/home/ana/my project\n' }),
  );
  expect(await pickProjectFolder('linux', { XDG_CURRENT_DESKTOP: 'GNOME' })).toBe(
    '/home/ana/my project',
  );
  expect(native.run.mock.calls[0][0]).toBe('zenity');
  expect(native.run.mock.calls[0][1]).toContain('--directory');
  expect(await pickProjectFolder('linux', { XDG_CURRENT_DESKTOP: 'KDE' })).toBe(
    '/home/ana/my project',
  );
  expect(native.run.mock.calls[1][0]).toBe('kdialog');
  expect(native.run.mock.calls[1][1]).toContain('--getexistingdirectory');
  expect(() => linuxFolderPath('relative/folder')).toThrow('invalid');
  expect(() => linuxFolderPath('/home/ana/\nbad')).toThrow('invalid');
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(Object.assign(new Error('cancelled'), { code: 1, stderr: '' }), null),
  );
  expect(await pickProjectFolder('linux', { XDG_CURRENT_DESKTOP: 'GNOME' })).toBeNull();
});

it('falls back to the other Linux folder picker only when the preferred one is absent', async () => {
  native.run.mockImplementation((command, _args, _options, done) =>
    command === 'kdialog'
      ? done(Object.assign(new Error('missing'), { code: 'ENOENT' }), null)
      : done(null, { stdout: '/home/ana/project\n' }),
  );
  expect(await pickProjectFolder('linux', { XDG_CURRENT_DESKTOP: 'KDE' })).toBe(
    '/home/ana/project',
  );
  expect(native.run.mock.calls.map((call) => call[0])).toEqual(['kdialog', 'zenity']);
  native.run.mockClear();
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(Object.assign(new Error('missing'), { code: 'ENOENT' }), null),
  );
  await expect(pickProjectFolder('linux', { XDG_CURRENT_DESKTOP: 'KDE' })).rejects.toThrow(
    'Install Zenity or KDialog',
  );
});

it('selects and validates native Windows folders and local metadata', async () => {
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(null, { stdout: 'C:\\Users\\ana\\my project\r\n' }),
  );
  expect(await pickProjectFolder('windows', { USERPROFILE: 'C:\\Users\\ana' })).toBe(
    'C:\\Users\\ana\\my project',
  );
  expect(sourceFromCall(native.run.mock.calls[0])).toContain('FolderBrowserDialog');
  expect(() => windowsFolderPath('relative\\folder')).toThrow('invalid');
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(null, { stdout: '\r\n' }),
  );
  expect(await pickProjectFolder('windows', { USERPROFILE: 'C:\\Users\\ana' })).toBeNull();
  expect(
    await dataDirectory(undefined, '', 'windows', {
      LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local',
    }),
  ).toBe('C:\\Users\\ana\\AppData\\Local\\Agent Garden');
  await expect(dataDirectory(undefined, '', 'windows', {})).rejects.toThrow('LOCALAPPDATA');
});

it('starts a native console with exact arguments and no shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-windows-launcher-'));
  folders.push(directory);
  const child = { once: vi.fn(), unref: vi.fn() };
  child.once.mockImplementation((event: string, listener: () => void) => {
    if (event === 'spawn') queueMicrotask(listener);
    return child;
  });
  native.spawn.mockReturnValue(child);
  await new TerminalLauncher(directory, 'windows').open(randomUUID(), {
    executable: 'C:\\Program Files\\Codex\\codex.exe',
    args: ['resume', "native'$(printf INJECTED)"],
    cwd: 'C:\\Users\\ana\\my project',
  });
  expect(native.spawn).toHaveBeenCalledWith(
    'C:\\Program Files\\Codex\\codex.exe',
    ['resume', "native'$(printf INJECTED)"],
    expect.objectContaining({
      cwd: 'C:\\Users\\ana\\my project',
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    }),
  );
  expect(child.unref).toHaveBeenCalledOnce();
});

it('reports native console launch failure without losing the saved session', async () => {
  const child = { once: vi.fn(), unref: vi.fn() };
  child.once.mockImplementation((event: string, listener: (error: Error) => void) => {
    if (event === 'error') queueMicrotask(() => listener(new Error('ENOENT')));
    return child;
  });
  native.spawn.mockReturnValue(child);
  await expect(
    new TerminalLauncher('C:\\Garden', 'windows').open(randomUUID(), {
      executable: 'codex.exe',
      args: ['resume', randomUUID()],
    }),
  ).rejects.toThrow('session is saved');
  expect(child.unref).not.toHaveBeenCalled();
});

it('opens a private WSL launcher in Windows Terminal with encoded arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-wsl-launcher-'));
  folders.push(directory);
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '' }));
  const id = randomUUID();
  await new TerminalLauncher(directory, 'wsl', { WSL_DISTRO_NAME: 'Ubuntu' }).open(id, {
    executable: '/usr/bin/echo',
    args: ["native'$(printf INJECTED)"],
    cwd: "/home/ana/it's a project",
  });
  const launcher = join(directory, 'launchers', `${id}.sh`);
  const script = await readFile(launcher, 'utf8');
  expect(script).toContain('#!/bin/sh');
  expect(script).toContain("'native'\\''$(printf INJECTED)'");
  const source = sourceFromCall(native.run.mock.calls[0]);
  expect(source).toContain('wt.exe -w 0 new-tab wsl.exe');
  expect(source).not.toContain('INJECTED');
  expect(source).not.toContain(launcher);
  expect(powershellCommand(source)).toMatch(/^[A-Za-z0-9+/=]+$/);
});

it('opens a quoted Linux launcher in the configured default terminal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-linux-launcher-'));
  folders.push(directory);
  const child = { once: vi.fn(), unref: vi.fn() };
  child.once.mockImplementation((event: string, listener: () => void) => {
    if (event === 'spawn') queueMicrotask(listener);
    return child;
  });
  native.spawn.mockReturnValue(child);
  const id = randomUUID();
  await new TerminalLauncher(directory, 'linux', { XDG_CURRENT_DESKTOP: 'GNOME' }).open(id, {
    executable: '/usr/bin/codex',
    args: ['resume', "native'$(printf INJECTED)"],
    cwd: "/home/ana/it's a project",
  });
  const launcher = join(directory, 'launchers', `${id}.sh`);
  expect(await readFile(launcher, 'utf8')).toContain("'native'\\''$(printf INJECTED)'");
  expect(native.spawn).toHaveBeenCalledWith(
    'xdg-terminal-exec',
    ['/bin/sh', launcher],
    expect.objectContaining({ detached: true, stdio: 'ignore' }),
  );
});

it('uses Konsole when the configured Linux terminal launchers are absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-linux-konsole-'));
  folders.push(directory);
  native.spawn.mockImplementation((terminal) => {
    const child = { once: vi.fn(), unref: vi.fn() };
    child.once.mockImplementation((event: string, listener: (error?: Error) => void) => {
      if (terminal === 'konsole' && event === 'spawn') queueMicrotask(listener);
      if (terminal !== 'konsole' && event === 'error')
        queueMicrotask(() => listener(Object.assign(new Error('missing'), { code: 'ENOENT' })));
      return child;
    });
    return child;
  });
  const id = randomUUID();
  await new TerminalLauncher(directory, 'linux', { XDG_CURRENT_DESKTOP: 'KDE' }).open(id, {
    executable: '/usr/bin/codex',
    args: ['resume', randomUUID()],
  });
  expect(native.spawn.mock.calls.map((call) => call[0])).toEqual([
    'xdg-terminal-exec',
    'x-terminal-emulator',
    'konsole',
  ]);
  expect(native.spawn.mock.calls[2][1]).toEqual([
    '-e',
    '/bin/sh',
    join(directory, 'launchers', `${id}.sh`),
  ]);
});

it('falls back from missing default launchers to Konsole and keeps the session saved on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-linux-fallback-'));
  folders.push(directory);
  native.spawn.mockImplementation(() => {
    const child = { once: vi.fn(), unref: vi.fn() };
    child.once.mockImplementation((event: string, listener: (error?: Error) => void) => {
      if (event === 'error')
        queueMicrotask(() => listener(Object.assign(new Error('missing'), { code: 'ENOENT' })));
      return child;
    });
    return child;
  });
  const command = { executable: '/usr/bin/codex', args: ['resume', randomUUID()] };
  await expect(
    new TerminalLauncher(directory, 'linux', { XDG_CURRENT_DESKTOP: 'KDE' }).open(
      randomUUID(),
      command,
    ),
  ).rejects.toThrow('session is saved');
  expect(native.spawn.mock.calls.map((call) => call[0])).toEqual([
    'xdg-terminal-exec',
    'x-terminal-emulator',
    'konsole',
    'gnome-terminal',
  ]);
});
