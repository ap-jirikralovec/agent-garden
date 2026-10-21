import { afterEach, expect, it } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app';
import type { Garden } from '../src/server/garden';
import type { WorkPresetFile } from '../src/shared/work';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
it('protects CRUD, writes valid local files, reports stale revisions as conflicts, and never creates an agent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-work-manager-api-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const garden = { stop: async () => {} } as unknown as Garden;
  const app = await createApp(garden, { clientDirectory: directory, dataDirectory: directory });
  cleanup.push(() => app.close());
  function request(
    path: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = { 'x-garden-request': '1' },
  ) {
    return new Promise<{
      status: number;
      body: WorkPresetFile & { error?: string; files?: WorkPresetFile[] };
    }>((resolve) => {
      const req = new IncomingMessage(new Socket());
      req.url = path;
      req.method = method;
      req.headers = { host: '127.0.0.1:4317', ...headers };
      const response = {
        headersSent: false,
        status: 200,
        setHeader() {},
        writeHead(status: number) {
          this.status = status;
          this.headersSent = true;
        },
        end(body: string) {
          resolve({ status: this.status, body: JSON.parse(body) });
        },
      };
      app.server.emit('request', req, response);
      if (body !== undefined) req.push(JSON.stringify(body));
      req.push(null);
    });
  }
  const preset = {
    name: 'Review',
    author: 'Jiri',
    description: 'Review changes',
    parameters: [{ key: 'target', value: '' }],
    prompt: 'Review {{target}}.',
  };
  expect((await request('/api/work/manage', 'GET', undefined, {})).status).toBe(403);
  expect((await request('/api/work', 'POST', { preset }, {})).status).toBe(403);
  expect(
    (
      await request(
        '/api/work',
        'POST',
        { preset },
        { 'x-garden-request': '1', origin: 'http://other.test' },
      )
    ).status,
  ).toBe(403);
  expect((await request('/api/work', 'POST', { preset: { ...preset, author: 123 } })).status).toBe(
    400,
  );
  expect((await request('/api/work', 'POST', { preset, path: '/tmp/outside.yaml' })).status).toBe(
    400,
  );
  const created = await request('/api/work', 'POST', { preset });
  expect(created.status).toBe(201);
  const file = created.body;
  const path = `/api/work/files/${encodeURIComponent(file.id)}`;
  expect((await request('/api/work/manage', 'GET')).body.files?.[0].preset?.name).toBe('Review');
  expect(
    (
      await request(
        path,
        'POST',
        { revision: file.revision, preset: { ...preset, name: 'Edited' } },
        {},
      )
    ).status,
  ).toBe(403);
  const saved = await request(path, 'POST', {
    revision: file.revision,
    preset: { ...preset, name: 'Edited' },
  });
  expect(saved.status).toBe(200);
  expect(saved.body.preset?.name).toBe('Edited');
  expect((await request(path, 'DELETE', { revision: file.revision })).status).toBe(409);
  const localPath = join(directory, 'work', file.id);
  const external = (await readFile(localPath, 'utf8')) + '# external change\n';
  await writeFile(localPath, external);
  expect((await request(path, 'POST', { revision: saved.body.revision, preset })).status).toBe(409);
  expect(await readFile(localPath, 'utf8')).toBe(external);
  expect(
    (await request('/api/work/files/..%2Foutside.yaml', 'DELETE', { revision: file.revision }))
      .status,
  ).toBe(400);
  const latest = (await request('/api/work/manage', 'GET')).body.files![0];
  expect((await request(path, 'DELETE', { revision: latest.revision }, {})).status).toBe(403);
  expect((await request(path, 'DELETE', { revision: latest.revision })).status).toBe(200);
  expect((await request('/api/work/manage', 'GET')).body.files).toEqual([]);
});
