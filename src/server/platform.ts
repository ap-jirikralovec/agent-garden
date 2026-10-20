import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export type HostPlatform = 'macos' | 'wsl' | 'unsupported';

export function hostPlatform(platform = process.platform, env = process.env): HostPlatform {
  if (platform === 'darwin') return 'macos';
  if (platform !== 'linux') return 'unsupported';
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return 'wsl';
  try {
    if (/microsoft|wsl/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8'))) return 'wsl';
  } catch {
    // A Linux host without WSL is outside the current platform scope.
  }
  return 'unsupported';
}

export function wslDistroName(env = process.env): string {
  const name = env.WSL_DISTRO_NAME;
  // eslint-disable-next-line no-control-regex -- Distro names become process arguments and UNC paths.
  if (!name || /[\x00-\x1f\\/]/.test(name))
    throw new Error('WSL_DISTRO_NAME is unavailable. Start Garden inside a WSL distribution.');
  return name;
}

export function isWindowsDriveMount(path: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/i.test(path);
}

// EncodedCommand keeps user-controlled paths and provider arguments out of PowerShell source.
export function powershellCommand(source: string): string {
  return Buffer.from(source, 'utf16le').toString('base64');
}

export async function runWindowsScript(source: string, timeout = 10000): Promise<string> {
  const { stdout } = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', powershellCommand(source)],
    { timeout, maxBuffer: 64 * 1024 },
  );
  return stdout;
}

export async function openBrowser(url: string, platform = hostPlatform()): Promise<void> {
  if (platform === 'macos') {
    await execute('/usr/bin/open', [url], { timeout: 10000 });
  } else if (platform === 'wsl') {
    await execute('explorer.exe', [url], { timeout: 10000 });
  }
}
