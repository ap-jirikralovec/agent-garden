import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

async function hasMetadata(directory: string) {
  try {
    await access(join(directory, 'agents.json'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function dataDirectory(explicit?: string, home = homedir()) {
  if (explicit) return resolve(explicit);
  const parent = join(home, 'Library', 'Application Support');
  const current = join(parent, 'Agent Garden');
  const legacy = join(parent, 'Codex Garden');
  // Reuse legacy metadata in place: moving it could race a still-running Garden.
  if (!(await hasMetadata(current)) && (await hasMetadata(legacy))) return legacy;
  return current;
}
