import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { isProviderId, type NewAgent, type Snapshot } from '../shared/types.js';
import type { Garden } from './garden.js';
import { checkProject } from './project.js';
import { pickProjectFolder } from './folderPicker.js';

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  request.setEncoding('utf8');
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error('The request is too large.');
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new Error('Enter the agent details as JSON.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Agent details are required.');
  return input as Record<string, unknown>;
}

async function readAgent(request: IncomingMessage): Promise<NewAgent> {
  const values = await readObject(request);
  const limits: Record<string, number> = { name: 60, project: 4096, model: 200 };
  if (
    Object.keys(values).some(
      (key) =>
        !['provider', 'reasoning', 'createProject'].includes(key) && !Object.hasOwn(limits, key),
    )
  )
    throw new Error('Unknown agent setting.');
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof values[key] !== 'string' || !values[key].length || values[key].length > limit)
      throw new Error(`Enter a valid ${key}.`);
  }
  if (values.createProject !== undefined && typeof values.createProject !== 'boolean')
    throw new Error('Folder creation confirmation must be true or false.');
  if (
    values.reasoning !== null &&
    (typeof values.reasoning !== 'string' || values.reasoning.length > 40)
  )
    throw new Error('Enter a valid reasoning level.');
  if (!isProviderId(values.provider)) throw new Error('Choose a valid provider.');
  return values as unknown as NewAgent;
}

export async function createApp(
  garden: Garden,
  options: { clientDirectory: string; dev?: boolean; pickFolder?: () => Promise<string | null> },
) {
  let vite: Awaited<ReturnType<(typeof import('vite'))['createServer']>> | undefined;
  if (options.dev) {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  }
  const streams = new Set<ServerResponse>();
  const server = createHttpServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      json(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' });
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const host = request.headers.host ?? '';
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (!options.dev)
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
      return json(response, 403, { error: 'Garden accepts local requests only.' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`)
      return json(response, 403, { error: 'Request origin does not match Garden.' });
    if (
      ['POST', 'DELETE'].includes(request.method ?? '') &&
      request.headers['x-garden-request'] !== '1'
    ) {
      return json(response, 403, {
        error: 'Open Garden in your local browser to perform this action.',
      });
    }
    const pathname = new URL(request.url ?? '/', `http://${host}`).pathname;
    if (request.method === 'GET' && pathname === '/api/state')
      return json(response, 200, garden.snapshot());
    if (request.method === 'POST' && pathname === '/api/settings') {
      const input = await readObject(request);
      if (Object.keys(input).length !== 1 || typeof input.showExternalAgents !== 'boolean')
        throw new Error('Show external agents must be true or false.');
      await garden.setShowExternalAgents(input.showExternalAgents);
      return json(response, 200, garden.snapshot());
    }
    const providerPath = pathname.match(/^\/api\/providers\/([a-z][a-z0-9_-]{0,39})$/);
    if (request.method === 'POST' && providerPath) {
      if (!isProviderId(providerPath[1])) throw new Error('Unknown provider.');
      const input = await readObject(request);
      if (Object.keys(input).length !== 1 || typeof input.enabled !== 'boolean')
        throw new Error('Connection enabled must be true or false.');
      await garden.setProviderEnabled(providerPath[1], input.enabled);
      return json(response, 200, garden.snapshot());
    }
    if (request.method === 'POST' && pathname === '/api/projects/pick') {
      const path = await (options.pickFolder ?? pickProjectFolder)();
      const project = path === null ? null : await garden.addProject(path);
      return json(response, 200, { project, snapshot: garden.snapshot() });
    }
    if (pathname === '/api/projects' && ['POST', 'DELETE'].includes(request.method ?? '')) {
      const input = await readObject(request);
      if (typeof input.project !== 'string' || input.project.length > 4096)
        throw new Error('Choose a saved project.');
      if (request.method === 'DELETE') await garden.removeProject(input.project);
      else {
        if (typeof input.name !== 'string') throw new Error('Enter a project name.');
        await garden.renameProject(input.project, input.name);
      }
      return json(response, 200, garden.snapshot());
    }
    if (request.method === 'POST' && pathname === '/api/projects/check') {
      const input = await readObject(request);
      if (typeof input.project !== 'string') throw new Error('Enter a project folder.');
      return json(response, 200, await checkProject(input.project));
    }
    if (request.method === 'GET' && pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      streams.add(response);
      const send = (snapshot: Snapshot) => {
        if (!response.destroyed) response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      };
      send(garden.snapshot());
      garden.on('change', send);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
      response.on('close', () => {
        clearInterval(heartbeat);
        garden.off('change', send);
        streams.delete(response);
      });
      return;
    }
    if (request.method === 'POST' && pathname === '/api/agents')
      return json(response, 201, await garden.create(await readAgent(request)));
    const agentPath = pathname.match(/^\/api\/agents\/([a-f0-9-]{36})(\/terminal)?$/i);
    if (agentPath && request.method === 'POST' && agentPath[2]) {
      await garden.open(agentPath[1]);
      return json(response, 200, { ok: true });
    }
    if (agentPath && request.method === 'DELETE' && !agentPath[2]) {
      await garden.remove(agentPath[1]);
      return json(response, 200, { ok: true });
    }
    if (pathname.startsWith('/api/')) return json(response, 404, { error: 'Unknown API route.' });
    if (!['GET', 'HEAD'].includes(request.method ?? ''))
      return json(response, 405, { error: 'Method not allowed.' });
    if (vite) {
      vite.middlewares(request, response);
      return;
    }
    const root = resolve(options.clientDirectory);
    const file = resolve(
      root,
      '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname),
    );
    if (!file.startsWith(root + sep)) return json(response, 404, { error: 'Not found.' });
    try {
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      const content = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      json(response, 404, { error: 'Not found. Run npm run build before starting Garden.' });
    }
  }

  return {
    server,
    async listen(options: { host: string; port: number }): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Could not determine the Garden address.');
      return `http://${options.host}:${address.port}`;
    },
    async close() {
      await garden.stop();
      for (const response of streams) response.end();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await vite?.close();
    },
  };
}
