#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AgentStore } from './store.js';
import { createProviders } from './providers/factory.js';
import { Garden } from './garden.js';
import { createApp } from './app.js';
import { dataDirectory } from './dataDirectory.js';
import { hostPlatform, openBrowser } from './platform.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4317' },
    'no-open': { type: 'boolean', default: false },
    'data-dir': { type: 'string' },
    dev: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  console.log(
    'Agent Garden\n\nUsage: agent-garden [--port 4317] [--no-open] [--data-dir PATH]\n\nRequires macOS or WSL2, Node.js 24.12+, and Codex CLI 0.163.0+ signed in.',
  );
  process.exit(0);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('--port must be between 0 and 65535.');

try {
  const directory = await dataDirectory(values['data-dir']);
  const store = new AgentStore(directory);
  await store.load();
  const garden = new Garden(store, await createProviders(directory));
  const clientDirectory = fileURLToPath(new URL('../client', import.meta.url));
  const app = await createApp(garden, { clientDirectory, dev: values.dev });
  const url = await app.listen({ host: '127.0.0.1', port });
  garden.start();
  console.log(
    `\n  Agent Garden\n  ${url}\n\n  Keep this process running. Press Ctrl+C to close the dashboard.\n`,
  );
  if (!values['no-open'] && hostPlatform() !== 'unsupported') {
    void openBrowser(url).catch(() => console.log(`Open ${url} in your browser.`));
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  console.error(`Garden could not start: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
