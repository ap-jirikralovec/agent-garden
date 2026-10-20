import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const native = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: native.run }));

import { dataDirectory } from '../src/server/dataDirectory.js';
import { pickProjectFolder, wslFolderPath } from '../src/server/folderPicker.js';
import { TerminalLauncher } from '../src/server/terminal.js';
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
  expect(hostPlatform('win32', {})).toBe('unsupported');
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '' }));
  await openBrowser('http://127.0.0.1:4317', 'wsl');
  expect(native.run.mock.calls[0].slice(0, 2)).toEqual(['explorer.exe', ['http://127.0.0.1:4317']]);
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
  expect(await dataDirectory('/tmp/garden', '/home/ana', 'wsl', {})).toBe('/tmp/garden');
  await expect(dataDirectory(undefined, '/home/ana', 'unsupported', {})).rejects.toThrow(
    'requires macOS or WSL2',
  );
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
