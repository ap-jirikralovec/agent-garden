import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';
import { hostPlatform, type HostPlatform } from './platform.js';

async function hasMetadata(directory: string) {
  try {
    await access(join(directory, 'agents.json'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function dataDirectory(
  explicit?: string,
  home = homedir(),
  platform: HostPlatform = hostPlatform(),
  env: NodeJS.ProcessEnv = process.env,
) {
  if (explicit) return resolve(explicit);
  if (platform === 'windows') {
    if (!env.LOCALAPPDATA || !win32.isAbsolute(env.LOCALAPPDATA))
      throw new Error('LOCALAPPDATA is unavailable. Set --data-dir to an absolute folder.');
    return win32.join(env.LOCALAPPDATA, 'Agent Garden');
  }
  if (platform === 'wsl' || platform === 'linux') {
    const parent =
      env.XDG_DATA_HOME && posix.isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : posix.join(home, '.local', 'share');
    return posix.join(parent, 'Agent Garden');
  }
  if (platform === 'unsupported')
    throw new Error('Agent Garden requires macOS, Linux, WSL2, or Windows.');
  const parent = posix.join(home, 'Library', 'Application Support');
  const current = join(parent, 'Agent Garden');
  const legacy = join(parent, 'Codex Garden');
  // Reuse legacy metadata in place: moving it could race a still-running Garden.
  if (!(await hasMetadata(current)) && (await hasMetadata(legacy))) return legacy;
  return current;
}
