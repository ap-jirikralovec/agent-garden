import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { ProjectCheck } from '../shared/types.js';

export async function checkProject(value: string): Promise<ProjectCheck> {
  let path = value.trim();
  if (path.startsWith('~/')) path = resolve(homedir(), path.slice(2));
  // eslint-disable-next-line no-control-regex -- Control characters are invalid project input.
  if (!isAbsolute(path) || path.length > 4096 || /[\x00-\x1f]/.test(path)) {
    throw new Error('Enter an absolute project folder, such as /Users/you/projects/app.');
  }
  path = resolve(path);
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ENOTDIR') throw new Error('A part of the project path is not a folder.');
    throw new Error('Project folder cannot be accessed. Check the path and permissions.');
  });
  if (!info) return { path, exists: false };
  if (!info.isDirectory()) throw new Error('Project path exists but is not a folder.');
  return { path: await realpath(path), exists: true };
}

export async function prepareProject(value: string, confirmed: boolean): Promise<string> {
  const project = await checkProject(value);
  if (project.exists) return project.path;
  if (!confirmed)
    throw new Error(
      'Project folder does not exist. Confirm creation of the new folder before continuing.',
    );
  try {
    await mkdir(project.path, { recursive: true });
  } catch {
    throw new Error('Could not create the project folder. Check the path and permissions.');
  }
  const created = await checkProject(project.path);
  if (!created.exists)
    throw new Error('Project folder could not be found after creation. Please try again.');
  return created.path;
}
