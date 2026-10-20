import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
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
  if (platform === 'wsl') {
    const parent =
      env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : join(home, '.local', 'share');
    return join(parent, 'Agent Garden');
  }
  if (platform === 'unsupported') throw new Error('Agent Garden requires macOS or WSL2.');
  const parent = join(home, 'Library', 'Application Support');
  const current = join(parent, 'Agent Garden');
  const legacy = join(parent, 'Codex Garden');
  // Reuse legacy metadata in place: moving it could race a still-running Garden.
  if (!(await hasMetadata(current)) && (await hasMetadata(legacy))) return legacy;
  return current;
}
