import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkPreset, loadWorkPresets } from '../src/server/work';
import { renderWorkPrompt } from '../src/shared/work';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const source = `name: Review a PR
author: Jiri
description: Review with a specific focus.
parameters:
  - pull_request: ""
  - focus: "Correctness"
prompt: |
  Review {{pull_request}}.
  Focus on {{ focus }}.
  Repeat {{pull_request}}.
`;

it('reads ordered string defaults and substitutes literally once, including repeated placeholders', () => {
  const work = parseWorkPreset(source, 'review.yaml');
  expect(work.parameters).toEqual([
    { key: 'pull_request', value: '' },
    { key: 'focus', value: 'Correctness' },
  ]);
  expect(
    renderWorkPrompt(work, { pull_request: '$& {{focus}} `literal`', focus: 'Tests\nand errors' }),
  ).toBe(
    'Review $& {{focus}} `literal`.\nFocus on Tests\nand errors.\nRepeat $& {{focus}} `literal`.\n',
  );
  expect(() => renderWorkPrompt(work, { pull_request: '  ', focus: 'Tests' })).toThrow(
    'pull_request',
  );
  expect(() => renderWorkPrompt(work, { pull_request: 'PR', focus: 'a'.repeat(16000) })).toThrow(
    '16,000',
  );
});

it.each([
  source.replace('name: Review a PR', 'name: 123'),
  source.replace('author: Jiri\n', ''),
  source.replace('description: Review with a specific focus.', 'description: null'),
  source.replace('"Correctness"', '42'),
  source.replace('pull_request: ""', '123: ""'),
  source.replace('focus: "Correctness"', 'pull_request: "duplicate"'),
  source.replace('{{ focus }}', '{{ unknown }}'),
  source.replace('{{ focus }}', '{{focus'),
  source.replace('name: Review a PR', 'name: One\nname: Two'),
  source.replace('parameters:', 'parameters: &params'),
  source.replace('prompt: |', 'extra: false\nprompt: |'),
])('rejects malformed or invalid presets', (yaml) => {
  // Merely declaring an unused anchor is valid; aliases are the unsupported case.
  const input = yaml.includes('&params')
    ? yaml.replace('  - focus: "Correctness"', '  - *params')
    : yaml;
  expect(() => parseWorkPreset(input, 'broken.yaml')).toThrow();
});

it('accepts parameter-free work and rejects non-list parameters and blank prompts', () => {
  const work = parseWorkPreset(
    'name: Hello\nauthor: Jiri\ndescription: Greeting\nparameters: []\nprompt: Say hello\n',
    'hello.yml',
  );
  expect(renderWorkPrompt(work, {})).toBe('Say hello');
  expect(() =>
    parseWorkPreset(
      source.replace(
        'parameters:\n  - pull_request: ""\n  - focus: "Correctness"',
        'parameters: {}',
      ),
      'bad.yml',
    ),
  ).toThrow();
  expect(() =>
    parseWorkPreset(
      'name: Hello\nauthor: Jiri\ndescription: Greeting\nparameters: []\nprompt: " "',
      'bad.yml',
    ),
  ).toThrow();
});

it('loads only valid local YAML files, logs broken files without source content, and reloads edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-work-'));
  folders.push(directory);
  const log = vi.fn();
  expect(await loadWorkPresets(directory, log)).toEqual([]);
  await mkdir(join(directory, 'work'));
  await writeFile(join(directory, 'work', 'review.yaml'), source);
  await writeFile(join(directory, 'work', 'broken.yml'), 'name: [secret-prompt');
  await writeFile(join(directory, 'work', 'ignore.txt'), source);
  await mkdir(join(directory, 'work', 'folder.yaml'));
  await writeFile(join(directory, 'outside.yaml'), source);
  await symlink(join(directory, 'outside.yaml'), join(directory, 'work', 'link.yaml'));
  const works = await loadWorkPresets(directory, log);
  expect(works.map((work) => work.id)).toEqual(['review.yaml']);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][0]).toContain('broken.yml');
  expect(log.mock.calls[0][0]).not.toContain('secret-prompt');
  await writeFile(
    join(directory, 'work', 'review.yaml'),
    source.replace('Review a PR', 'Updated work'),
  );
  expect((await loadWorkPresets(directory, log))[0].name).toBe('Updated work');
});
