import { open, opendir, mkdir, writeFile, rename, unlink, link, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';
import {
  workPlaceholders,
  type WorkPreset,
  type WorkPresetFile,
  type WorkPresetCatalog,
} from '../shared/work.js';

const fileLimit = 128 * 1024;

export function parseWorkPreset(source: string, id: string): WorkPreset {
  const doc = parseDocument(source, { prettyErrors: false });
  if (doc.errors.length || doc.warnings.length)
    throw new Error(`Invalid YAML (${doc.errors[0]?.code ?? doc.warnings[0]?.code}).`);
  const value: unknown = doc.toJS({ mapAsMap: true, maxAliasCount: 0 });
  if (!(value instanceof Map)) throw new Error('A work preset must be a YAML mapping.');
  const fields = ['name', 'author', 'description', 'parameters', 'prompt'];
  if ([...value.keys()].some((key) => !fields.includes(key)))
    throw new Error('Unknown preset field.');
  const text = (key: string, max: number): string => {
    const result: unknown = value.get(key);
    if (
      typeof result !== 'string' ||
      !result.trim() ||
      result.length > max ||
      result.includes('\0')
    )
      throw new Error(`${key} must be a nonblank string of up to ${max} characters.`);
    return result;
  };
  const name = text('name', 120);
  const author = text('author', 120);
  const description = text('description', 2000);
  const prompt = text('prompt', 16000);
  const parameters: WorkPreset['parameters'] = [];
  const entries: unknown = value.get('parameters');
  if (!Array.isArray(entries) || entries.length > 32)
    throw new Error('parameters must be a list of up to 32 string key:value pairs.');
  for (const entry of entries) {
    if (!(entry instanceof Map) || entry.size !== 1)
      throw new Error('Each parameter must contain exactly one string key:value pair.');
    const [key, defaultValue]: [unknown, unknown] = [...entry.entries()][0];
    if (typeof key !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/.test(key))
      throw new Error(
        'Parameter names must start with a letter or underscore and use letters, numbers, underscores or hyphens.',
      );
    if (parameters.some((parameter) => parameter.key === key))
      throw new Error('Duplicate parameter name.');
    if (
      typeof defaultValue !== 'string' ||
      defaultValue.length > 4000 ||
      defaultValue.includes('\0')
    )
      throw new Error(
        'Parameter defaults must be strings of up to 4,000 characters without null characters.',
      );
    parameters.push({ key, value: defaultValue });
  }
  const keys = new Set(parameters.map(({ key }) => key));
  if (workPlaceholders(prompt).some((key) => !keys.has(key)))
    throw new Error('The prompt references an undeclared parameter.');
  return { id, name, author, description, parameters, prompt };
}

function workFilename(id: string) {
  if (
    typeof id !== 'string' ||
    id.length > 255 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes(':') ||
    [...id].some((character) => character.charCodeAt(0) < 32) ||
    !/\.ya?ml$/i.test(id)
  )
    throw new Error('Choose a valid preset filename.');
  return id;
}

async function readWorkFile(directory: string, id: string) {
  if (!(await lstat(join(directory, workFilename(id)))).isFile())
    throw new Error('Choose a regular preset file.');
  const file = await open(
    join(directory, workFilename(id)),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > fileLimit)
      throw new Error('Preset exceeds the 128 KiB file limit or is not a regular file.');
    const buffer = Buffer.alloc(fileLimit + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > fileLimit) throw new Error('Preset exceeds the 128 KiB file limit.');
    const bytes = buffer.subarray(0, total);
    return {
      source: bytes.toString('utf8'),
      revision: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await file.close();
  }
}

async function workCatalog(dataDirectory: string): Promise<WorkPresetCatalog> {
  const directory = join(dataDirectory, 'work');
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { directory, files: [], truncated: false };
    throw new Error('Could not read the local work folder. Check its permissions.', {
      cause: error,
    });
  }
  const files: WorkPresetFile[] = [];
  let truncated = false;
  for await (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    if (files.length >= 100) {
      truncated = true;
      break;
    }
    let revision: string | null = null;
    try {
      const current = await readWorkFile(directory, entry.name);
      revision = current.revision;
      files.push({
        id: entry.name,
        revision,
        preset: parseWorkPreset(current.source, entry.name),
        error: null,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.split('\n')[0] : 'Could not read preset.';
      files.push({ id: entry.name, revision, preset: null, error: reason });
    }
  }
  files.sort(
    (a, b) =>
      (a.preset?.name ?? a.id).localeCompare(b.preset?.name ?? b.id) || a.id.localeCompare(b.id),
  );
  return { directory, files, truncated };
}

export async function loadWorkPresets(
  dataDirectory: string,
  log: (message: string) => void = console.error,
): Promise<WorkPreset[]> {
  const catalog = await workCatalog(dataDirectory);
  for (const file of catalog.files)
    if (file.error) log(`[Work] Ignoring ${JSON.stringify(file.id)}: ${file.error}`);
  if (catalog.truncated) log('[Work] Only the first 100 YAML files are loaded.');
  return catalog.files.flatMap((file) => (file.preset ? [file.preset] : []));
}

function encodeWorkPreset(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Preset details are required.');
  const values = input as Record<string, unknown>;
  if (
    Object.keys(values).some(
      (key) => !['name', 'author', 'description', 'parameters', 'prompt'].includes(key),
    )
  )
    throw new Error('Unknown preset field.');
  if (!Array.isArray(values.parameters) || values.parameters.length > 32)
    throw new Error('parameters must be a list of up to 32 string key:value pairs.');
  const parameters = values.parameters.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Each parameter needs a name and string default.');
    const parameter = entry as Record<string, unknown>;
    if (
      Object.keys(parameter).length !== 2 ||
      typeof parameter.key !== 'string' ||
      typeof parameter.value !== 'string'
    )
      throw new Error('Each parameter needs a name and string default.');
    return new Map([[parameter.key, parameter.value]]);
  });
  const source = stringify(
    {
      name: values.name,
      author: values.author,
      description: values.description,
      parameters,
      prompt: values.prompt,
    },
    { lineWidth: 0 },
  );
  parseWorkPreset(source, 'new.yaml');
  if (Buffer.byteLength(source) > fileLimit)
    throw new Error('Preset exceeds the 128 KiB file limit.');
  return source;
}

export class WorkPresetConflict extends Error {}

export class WorkPresetStore {
  private queue: Promise<unknown> = Promise.resolve();
  private directory: string;
  constructor(private dataDirectory: string) {
    this.directory = join(dataDirectory, 'work');
  }
  list() {
    return workCatalog(this.dataDirectory);
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  private async checkRevision(id: string, revision: string) {
    workFilename(id);
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
      throw new Error('Reload the preset before changing it.');
    let current;
    try {
      current = await readWorkFile(this.directory, id);
    } catch (error) {
      throw new WorkPresetConflict(
        'This preset changed or was removed. Reload the list before changing it.',
        {
          cause: error,
        },
      );
    }
    if (current.revision !== revision)
      throw new WorkPresetConflict(
        'This preset changed outside this form. Reload the list before changing it.',
      );
  }
  private async save(id: string, source: string, revision?: string): Promise<WorkPresetFile> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.preset-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, source, { flag: 'wx', mode: 0o600 });
      if (revision === undefined) {
        // An exclusive link publishes a complete new file without replacing an existing one.
        await link(temporary, join(this.directory, id));
      } else {
        // Serialize Garden writes and recheck external edits immediately before atomic replacement.
        await this.checkRevision(id, revision);
        await rename(temporary, join(this.directory, id));
      }
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT')
          console.error('[Work] Could not remove a temporary preset file.');
      });
    }
    return {
      id,
      preset: parseWorkPreset(source, id),
      revision: createHash('sha256').update(source).digest('hex'),
      error: null,
    };
  }
  create(input: unknown) {
    return this.mutate(async () => {
      const source = encodeWorkPreset(input);
      const catalog = await this.list();
      if (catalog.files.length >= 100 || catalog.truncated)
        throw new Error(
          'Work supports up to 100 preset files. Remove one before creating another.',
        );
      const name =
        parseWorkPreset(source, 'new.yaml')
          .name.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50) || 'work';
      return this.save(`${name}-${randomUUID()}.yaml`, source);
    });
  }
  update(id: string, revision: string, input: unknown) {
    return this.mutate(async () => {
      workFilename(id);
      const source = encodeWorkPreset(input);
      await this.checkRevision(id, revision);
      return this.save(id, source, revision);
    });
  }
  remove(id: string, revision: string) {
    return this.mutate(async () => {
      await this.checkRevision(id, revision);
      const trash = join(this.directory, '.trash');
      await mkdir(trash, { recursive: true, mode: 0o700 });
      if (!(await lstat(trash)).isDirectory())
        throw new Error('The preset trash path must be a regular directory.');
      const deletedDirectory = join(trash, randomUUID());
      await mkdir(deletedDirectory, { mode: 0o700 });
      await this.checkRevision(id, revision);
      await rename(join(this.directory, id), join(deletedDirectory, id));
    });
  }
}
