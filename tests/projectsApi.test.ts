import { afterEach, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app';
import { Garden } from '../src/server/garden';
import { AgentStore } from '../src/server/store';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

it('protects project actions, treats picker cancellation as a no-op and validates selected folders and names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'garden-api-projects-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = new AgentStore(join(directory, 'metadata'));
  await store.load();
  const garden = new Garden(store, []);
  const pickFolder = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
  const app = await createApp(garden, { clientDirectory: directory, pickFolder });
  cleanup.push(() => app.close());
  function request(
    path: string,
    method = 'POST',
    body: unknown = {},
    headers: Record<string, string> = { 'x-garden-request': '1' },
  ) {
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
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
      req.push(JSON.stringify(body));
      req.push(null);
    });
  }
  expect((await request('/api/projects/pick', 'POST', {}, {})).status).toBe(403);
  expect(
    (
      await request(
        '/api/projects/pick',
        'POST',
        {},
        { 'x-garden-request': '1', origin: 'http://other.test' },
      )
    ).status,
  ).toBe(403);
  expect(pickFolder).not.toHaveBeenCalled();
  expect((await request('/api/projects/pick')).body.project).toBeNull();
  expect(store.listProjects()).toEqual([]);
  pickFolder.mockResolvedValue(directory);
  expect((await request('/api/projects/pick')).status).toBe(200);
  const project = await realpath(directory);
  expect(store.listProjects()).toHaveLength(1);
  await request('/api/projects/pick');
  expect(store.listProjects()).toHaveLength(1);
  expect((await request('/api/projects', 'POST', { project, name: '' })).status).toBe(400);
  expect((await request('/api/projects', 'POST', { project, name: 'Ideas' })).status).toBe(200);
  expect(store.listProjects()[0].name).toBe('Ideas');
  expect((await request('/api/projects', 'DELETE', { project })).status).toBe(200);
  expect(store.listProjects()).toEqual([]);
  expect(await realpath(directory)).toBe(project);
  pickFolder.mockResolvedValue(join(directory, 'missing'));
  expect((await request('/api/projects/pick')).status).toBe(400);
  expect(store.listProjects()).toEqual([]);
});
