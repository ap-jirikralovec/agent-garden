export interface WorkPreset {
  id: string;
  name: string;
  author: string;
  description: string;
  parameters: { key: string; value: string }[];
  prompt: string;
}

export type WorkPresetInput = Omit<WorkPreset, 'id'>;
export interface WorkPresetFile {
  id: string;
  revision: string | null;
  preset: WorkPreset | null;
  error: string | null;
}
export interface WorkPresetCatalog {
  directory: string;
  files: WorkPresetFile[];
  truncated: boolean;
}

export function workPlaceholders(prompt: string): string[] {
  const keys: string[] = [];
  const remainder = prompt.replace(/{{([\s\S]*?)}}/g, (_, value: string) => {
    const key = value.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key))
      throw new Error('Use {{parameter_name}} for prompt placeholders.');
    keys.push(key);
    return '';
  });
  if (remainder.includes('{{') || remainder.includes('}}'))
    throw new Error('A prompt placeholder has unmatched braces.');
  return keys;
}

export function renderWorkPrompt(work: WorkPreset, values: Record<string, string>): string {
  for (const { key } of work.parameters) {
    if (!Object.hasOwn(values, key) || typeof values[key] !== 'string' || !values[key].trim())
      throw new Error(`Enter a value for ${key}.`);
  }
  // A replacement function keeps $ syntax literal and never expands inserted values again.
  const prompt = work.prompt.replace(/{{([\s\S]*?)}}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key.trim())) throw new Error('Unknown prompt parameter.');
    return values[key.trim()];
  });
  if (!prompt.trim() || prompt.length > 16000 || prompt.includes('\0'))
    throw new Error(
      'The resulting prompt must contain 1–16,000 characters without null characters.',
    );
  return prompt;
}
