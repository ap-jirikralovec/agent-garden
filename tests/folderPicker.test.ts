import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: native.run }));
// The callback-shaped mock is wrapped by the same promisify as production execFile.
import { pickProjectFolder } from '../src/server/folderPicker';
afterEach(() => vi.resetAllMocks());

it('uses a native folder-only panel with New Folder and distinguishes selection from cancellation', async () => {
  native.run.mockImplementation((_command, _args, _options, done) =>
    done(null, { stdout: "/tmp/it's a project \n" }),
  );
  expect(await pickProjectFolder()).toBe("/tmp/it's a project ");
  const [command, args] = native.run.mock.calls[0];
  expect(command).toBe('/usr/bin/osascript');
  expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
  expect(args[3]).toContain('panel.canCreateDirectories = true');
  expect(args[3]).toContain('panel.canChooseFiles = false');
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '\n' }));
  expect(await pickProjectFolder()).toBeNull();
});

it('blocks overlapping pickers and releases the lock on failure', async () => {
  let finish!: (error: Error | null, result?: { stdout: string }) => void;
  native.run.mockImplementation((_command, _args, _options, done) => {
    finish = done;
  });
  const pending = pickProjectFolder();
  await expect(pickProjectFolder()).rejects.toThrow('already open');
  finish(new Error('Panel failed'));
  await expect(pending).rejects.toThrow('Could not select');
  native.run.mockImplementation((_command, _args, _options, done) => done(null, { stdout: '\n' }));
  expect(await pickProjectFolder()).toBeNull();
});
