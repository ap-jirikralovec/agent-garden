// A byte-stream proxy peer, like Codex's daemon control socket. No listening port.
import { createServer } from 'node:http';
import { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';

const http = createServer();
const websocket = new WebSocketServer({ noServer: true });
http.on('upgrade', (request, socket, head) => {
  websocket.handleUpgrade(request, socket, head, (client) => {
    client.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id === undefined) return;
      client.send(
        JSON.stringify({
          id: message.id,
          result: message.method === 'model/list' ? { data: [] } : {},
        }),
      );
    });
  });
});
http.emit('connection', Duplex.from({ readable: process.stdin, writable: process.stdout }));
