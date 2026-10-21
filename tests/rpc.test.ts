import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CodexRpc } from '../src/server/providers/codex/rpc.js';

it('initializes and reconnects through a daemon proxy that requires WebSocket framing', async () => {
  const rpc = new CodexRpc({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/websocket-proxy.mjs', import.meta.url))],
    startDaemon: false,
    timeout: 1000,
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await rpc.connect();
      expect(rpc.connected).toBe(true);
      expect(await rpc.request('model/list', {})).toEqual({ data: [] });
      await rpc.close();
      expect(rpc.connected).toBe(false);
    }
  } finally {
    await rpc.close();
  }
});

it('does not mistake a server approval request with a matching ID for an RPC response', async () => {
  const rpc = new CodexRpc({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/websocket-proxy.mjs', import.meta.url))],
    startDaemon: false,
    timeout: 1000,
  });
  try {
    await rpc.connect();
    expect(await rpc.request('test/approval-collision', {})).toEqual({ accepted: true });
  } finally {
    await rpc.close();
  }
});
