import { open, opendir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { workPlaceholders, type WorkPreset } from '../shared/work.js';

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

export async function loadWorkPresets(
  dataDirectory: string,
  log: (message: string) => void = console.error,
): Promise<WorkPreset[]> {
  const directory = join(dataDirectory, 'work');
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('Could not read the local work folder. Check its permissions.', {
      cause: error,
    });
  }
  const works: WorkPreset[] = [];
  let count = 0;
  for await (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    if (++count > 100) {
      log('[Work] Only the first 100 YAML files are loaded.');
      break;
    }
    try {
      const file = await open(
        join(directory, entry.name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > fileLimit)
          throw new Error('Preset exceeds the 128 KiB file limit.');
        // Bound reads even if another process grows a preset while it is being read.
        const buffer = Buffer.alloc(fileLimit + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
          if (!bytesRead) break;
          total += bytesRead;
        }
        if (total > fileLimit) throw new Error('Preset exceeds the 128 KiB file limit.');
        works.push(parseWorkPreset(buffer.subarray(0, total).toString('utf8'), entry.name));
      } finally {
        await file.close();
      }
    } catch (error) {
      // Parser diagnostics omit source excerpts; report only the filename and reason.
      const reason =
        error instanceof Error ? error.message.split('\n')[0] : 'Could not read preset.';
      log(`[Work] Ignoring ${JSON.stringify(entry.name)}: ${reason}`);
    }
  }
  return works.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
