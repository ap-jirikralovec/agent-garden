import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkPresetStore, loadWorkPresets } from '../src/server/work';
import type { WorkPresetInput } from '../src/shared/work';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'garden-work-store-'));
  folders.push(directory);
  return { directory, store: new WorkPresetStore(directory) };
}
const preset: WorkPresetInput = {
  name: 'Review',
  author: 'Jiri',
  description: 'Review changes',
  parameters: [{ key: 'target', value: '' }],
  prompt: 'Review {{target}}.',
};

it('creates local YAML from a structured form, updates the same file, and moves confirmed deletions to trash', async () => {
  const { directory, store } = await setup();
  const file = await store.create(preset);
  expect(file.preset).toMatchObject(preset);
  expect(file.revision).toMatch(/^[a-f0-9]{64}$/);
  const source = await readFile(join(directory, 'work', file.id), 'utf8');
  expect(source).toContain('parameters:');
  expect((await loadWorkPresets(directory))[0]).toMatchObject(preset);
  const saved = await store.update(file.id, file.revision!, {
    ...preset,
    name: 'Updated',
    parameters: [{ key: 'target', value: '123' }],
  });
  expect(saved.id).toBe(file.id);
  expect(saved.revision).not.toBe(file.revision);
  expect(saved.preset?.parameters[0].value).toBe('123');
  await store.remove(saved.id, saved.revision!);
  expect(await loadWorkPresets(directory)).toEqual([]);
  const deleted = await readdir(join(directory, 'work', '.trash'));
  expect(deleted).toHaveLength(1);
  expect(await readFile(join(directory, 'work', '.trash', deleted[0], file.id), 'utf8')).toContain(
    'Updated',
  );
});

it('rejects invalid forms before writing and keeps external edits when update or delete uses an old revision', async () => {
  const { directory, store } = await setup();
  await expect(store.create({ ...preset, prompt: '{{unknown}}' })).rejects.toThrow('undeclared');
  expect((await store.list()).files).toEqual([]);
  const file = await store.create(preset);
  const path = join(directory, 'work', file.id);
  const external = (await readFile(path, 'utf8')) + '# external comment\n';
  await writeFile(path, external);
  await expect(store.update(file.id, file.revision!, { ...preset, name: 'Stale' })).rejects.toThrow(
    'changed',
  );
  await expect(store.remove(file.id, file.revision!)).rejects.toThrow('changed');
  expect(await readFile(path, 'utf8')).toBe(external);
  const fresh = (await store.list()).files[0];
  const results = await Promise.allSettled([
    store.update(file.id, fresh.revision!, { ...preset, name: 'First' }),
    store.update(file.id, fresh.revision!, { ...preset, name: 'Second' }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
});

it('shows broken files for replacement while keeping them out of creation, and rejects paths and symlinks', async () => {
  const { directory, store } = await setup();
  await mkdir(join(directory, 'work'));
  await writeFile(join(directory, 'work', 'broken.yaml'), 'name: [broken');
  const broken = (await store.list()).files[0];
  expect(broken).toMatchObject({ id: 'broken.yaml', preset: null });
  expect(broken.error).toContain('YAML');
  expect(await loadWorkPresets(directory, () => {})).toEqual([]);
  await store.update(broken.id, broken.revision!, preset);
  expect((await loadWorkPresets(directory))[0].name).toBe('Review');
  for (const id of ['../outside.yaml', 'folder/file.yaml', 'folder\\file.yaml', 'not-yaml.txt']) {
    await expect(store.update(id, broken.revision!, preset)).rejects.toThrow('filename');
    await expect(store.remove(id, broken.revision!)).rejects.toThrow('filename');
  }
  if (process.platform !== 'win32') {
    const outside = join(directory, 'outside.yaml');
    await writeFile(outside, 'outside');
    await symlink(outside, join(directory, 'work', 'link.yaml'));
    expect((await store.list()).files.map((file) => file.id)).not.toContain('link.yaml');
    await expect(store.update('link.yaml', broken.revision!, preset)).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('outside');
  }
});
