import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import WebSocket from 'ws';
import type { Rpc } from './protocol.js';

export class RpcError extends Error {}

export class CodexRpc implements Rpc {
  connected = false;
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: WebSocket | null = null;
  private sequence = 0;
  private connecting: Promise<void> | null = null;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();

  constructor(
    private options: {
      command?: string;
      args?: string[];
      env?: NodeJS.ProcessEnv;
      startDaemon?: boolean;
      timeout?: number;
      transport?: 'websocket' | 'stdio';
    } = {},
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open() {
    if (this.options.startDaemon !== false) {
      try {
        await promisify(execFile)(
          this.options.command ?? 'codex',
          ['app-server', 'daemon', 'start'],
          {
            env: this.options.env ?? process.env,
            timeout: 15000,
            maxBuffer: 64 * 1024,
          },
        );
      } catch {
        throw new Error(
          'Could not start the Codex session server. Run `codex` in a terminal, then leave Garden running to retry.',
        );
      }
    }
    const child = spawn(
      this.options.command ?? 'codex',
      this.options.args ?? ['app-server', 'proxy'],
      {
        env: this.options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child = child;
    // Drain diagnostics without forwarding local configuration or conversation content.
    child.stderr.resume();
    child.once('error', () =>
      this.lost(child, 'Could not launch Codex. Install Codex CLI and ensure `codex` is on PATH.'),
    );
    child.once('exit', () =>
      this.lost(child, 'Connection to Codex was lost. Retrying automatically.'),
    );
    try {
      if (this.options.transport === 'stdio') {
        createInterface({ input: child.stdout }).on('line', (line) => this.receive(line));
      } else {
        // `app-server proxy` forwards raw bytes to the daemon's Unix socket.
        // That socket expects an HTTP Upgrade followed by WebSocket frames, not JSONL.
        const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
        const socket = new WebSocket('ws://localhost/', {
          createConnection: () => stream as Socket,
          handshakeTimeout: this.options.timeout ?? 12000,
          perMessageDeflate: false,
        });
        this.socket = socket;
        socket.on('message', (data) => this.receive(data.toString()));
        socket.on('error', (error) =>
          this.lost(child, `Codex WebSocket connection failed: ${error.message}`),
        );
        socket.on('close', () =>
          this.lost(child, 'Codex closed its monitoring connection. Retrying automatically.'),
        );
        await new Promise<void>((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
          socket.once('close', () =>
            reject(new Error('Codex closed the connection during initialization.')),
          );
        });
      }
      await this.send('initialize', {
        clientInfo: { name: 'agent_garden', title: 'Agent Garden', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      this.write(JSON.stringify({ method: 'initialized' }));
      this.connected = true;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private receive(line: string) {
    let message: { method?: string; id?: number; error?: { message: string }; result?: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // Server requests have their own ID namespace. Leave approvals pending for
    // the provider's terminal; they must never resolve a client RPC by accident.
    if (message.method !== undefined || typeof message.id !== 'number') return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new RpcError(message.error.message));
    else request.resolve(message.result);
  }

  private write(message: string, callback?: (error?: Error | null) => void) {
    if (this.socket) this.socket.send(message, callback);
    else this.child?.stdin.write(message + '\n', callback);
  }

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.connected) throw new Error('Codex is disconnected. Garden will retry automatically.');
    return this.send(method, params) as Promise<T>;
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child || child.stdin.destroyed)
        return reject(new Error('Codex connection is unavailable.'));
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not respond to ${method}. Reconnecting automatically.`));
        this.close();
      }, this.options.timeout ?? 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.write(JSON.stringify({ id, method, params }), (error) => {
        if (error) this.lost(child, 'Could not write to the Codex connection.');
      });
    });
  }

  private lost(child: ChildProcessWithoutNullStreams, message: string) {
    if (this.child !== child) return;
    this.connected = false;
    this.child = null;
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
    child.kill();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    const child = this.child;
    this.connected = false;
    if (!child) return;
    this.child = null;
    const socket = this.socket;
    this.socket = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Garden disconnected from Codex.'));
    }
    this.pending.clear();
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(() => child.kill(), 2000);
      child.once('close', () => {
        clearTimeout(fallback);
        resolve();
      });
      if (socket?.readyState === WebSocket.OPEN) socket.close();
      else {
        socket?.terminate();
        child.stdin.end();
      }
    });
  }
}
