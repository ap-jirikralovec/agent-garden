import { afterEach, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { createApp } from '../src/server/app';
import type { Garden } from '../src/server/garden';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

it('accepts optional Unicode prompts, validates their type and bounds, and preserves local request protection', async () => {
  const create = vi.fn().mockResolvedValue({ agent: { name: 'Miso' }, warning: null });
  const garden = { create, stop: async () => {} } as unknown as Garden;
  const app = await createApp(garden, { clientDirectory: '/unused' });
  cleanup.push(() => app.close());
  function request(body: unknown, local = true) {
    return new Promise<number>((resolve) => {
      const req = new IncomingMessage(new Socket());
      req.url = '/api/agents';
      req.method = 'POST';
      req.headers = { host: '127.0.0.1:4317', ...(local ? { 'x-garden-request': '1' } : {}) };
      const response = {
        headersSent: false,
        status: 200,
        setHeader() {},
        writeHead(status: number) {
          this.status = status;
          this.headersSent = true;
        },
        end() {
          resolve(this.status);
        },
      };
      app.server.emit('request', req, response);
      req.push(JSON.stringify(body));
      req.push(null);
    });
  }
  const input = {
    provider: 'codex',
    name: 'Miso',
    project: '/tmp',
    model: 'model',
    reasoning: 'medium',
  };
  const initialPrompt = '界'.repeat(16000);
  expect(await request({ ...input, initialPrompt })).toBe(201);
  expect(create).toHaveBeenLastCalledWith({ ...input, initialPrompt });
  expect(await request({ ...input, initialPrompt: 'Work', openTerminal: false })).toBe(201);
  expect(create).toHaveBeenLastCalledWith({ ...input, initialPrompt: 'Work', openTerminal: false });
  expect(await request(input)).toBe(201);
  expect(await request({ ...input, initialPrompt: '' })).toBe(201);
  create.mockClear();
  for (const initialPrompt of [null, 42, {}, 'a'.repeat(16001), 'hello\0world']) {
    expect(await request({ ...input, initialPrompt })).toBe(400);
  }
  expect(await request({ ...input, initialPrompt: 'Do work' }, false)).toBe(403);
  expect(await request({ ...input, initialPrompt: 'a'.repeat(100000) })).toBe(400);
  expect(await request({ ...input, openTerminal: 'false' })).toBe(400);
  expect(await request({ ...input, openTerminal: null })).toBe(400);
  expect(create).not.toHaveBeenCalled();
});
