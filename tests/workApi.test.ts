import { afterEach, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server/app';
import type { Garden } from '../src/server/garden';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  vi.restoreAllMocks();
});
it('serves current valid presets only through the local API without creating an agent or exposing broken content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-work-api-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const create = vi.fn();
  const garden = { create, stop: async () => {} } as unknown as Garden;
  const app = await createApp(garden, { clientDirectory: directory, dataDirectory: directory });
  cleanup.push(() => app.close());
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  function request(headers: Record<string, string> = { 'x-garden-request': '1' }) {
    return new Promise<{
      status: number;
      body: { presets?: { id: string; name: string }[]; directory?: string };
    }>((resolve) => {
      const req = new IncomingMessage(new Socket());
      req.url = '/api/work';
      req.method = 'GET';
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
      req.push(null);
    });
  }
  expect((await request({})).status).toBe(403);
  expect((await request({ 'x-garden-request': '1', origin: 'http://elsewhere.test' })).status).toBe(
    403,
  );
  expect((await request()).body.presets).toEqual([]);
  await mkdir(join(directory, 'work'));
  const yaml =
    'name: Greeting\nauthor: Jiri\ndescription: Greeting task\nparameters: []\nprompt: Say hello\n';
  await writeFile(join(directory, 'work', 'hello.yaml'), yaml);
  await writeFile(join(directory, 'work', 'broken.yml'), 'SECRET: [broken');
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.body.directory).toBe(join(directory, 'work'));
  expect(result.body.presets?.map(({ id }) => id)).toEqual(['hello.yaml']);
  expect(JSON.stringify(result.body)).not.toContain('SECRET');
  expect(log.mock.calls[0][0]).toContain('broken.yml');
  await writeFile(
    join(directory, 'work', 'hello.yaml'),
    yaml.replace('name: Greeting', 'name: Updated'),
  );
  expect((await request()).body.presets?.[0].name).toBe('Updated');
  expect(create).not.toHaveBeenCalled();
});
