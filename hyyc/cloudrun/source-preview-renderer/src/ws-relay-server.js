const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const { authorized } = require('./auth.js');
const { createPublicUrlGuard } = require('./network-security.js');
const { createRelayConnector } = require('./relay-outbound.js');

const HOST = process.env.RELAY_HOST || '127.0.0.1';
const PORT = Math.max(1, Number(process.env.RELAY_PORT) || 8792);
const TOKEN = process.env.CAPTURE_TOKEN || '';
const guard = createPublicUrlGuard();
const connector = createRelayConnector({
  mode: process.env.RELAY_EGRESS_MODE || 'http-connect',
  resolvePublicHost: guard.resolvePublicHost,
  proxyHost: process.env.RELAY_UPSTREAM_HOST || '127.0.0.1',
  proxyPort: Math.max(1, Number(process.env.RELAY_UPSTREAM_PORT) || 7890)
});

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({
      ok: true,
      configured: TOKEN.length >= 32,
      egressMode: connector.mode
    }));
    return;
  }
  response.writeHead(404, { connection: 'close' });
  response.end();
});
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

server.on('upgrade', (request, socket, head) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (path !== '/tunnel' || !authorized(request.headers.authorization, TOKEN)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit('connection', webSocket, request);
  });
});

webSockets.on('connection', (webSocket) => {
  let upstream = null;
  let ready = false;
  const timeout = setTimeout(() => webSocket.close(1008, 'target required'), 12000);
  const closeUpstream = () => {
    clearTimeout(timeout);
    if (upstream && !upstream.destroyed) upstream.destroy();
  };
  webSocket.once('close', closeUpstream);
  webSocket.once('error', closeUpstream);
  webSocket.on('message', async (data, isBinary) => {
    if (!ready) {
      if (isBinary) return webSocket.close(1008, 'target required');
      let target;
      try {
        target = JSON.parse(data.toString('utf8'));
        if (!target || typeof target.host !== 'string' || Number(target.port) !== 443) {
          throw new Error('TARGET_INVALID');
        }
        const tunnel = await connector.open(target.host, 443);
        upstream = tunnel.socket;
        upstream.once('error', () => webSocket.close(1011, 'upstream error'));
        upstream.once('close', () => webSocket.close());
        upstream.on('data', (chunk) => {
          if (webSocket.readyState === WebSocket.OPEN) webSocket.send(chunk, { binary: true });
        });
        ready = true;
        clearTimeout(timeout);
        webSocket.send(JSON.stringify({ ok: true }));
        if (tunnel.remainder.length) webSocket.send(tunnel.remainder, { binary: true });
      } catch (error) {
        webSocket.close(1008, 'target rejected');
      }
      return;
    }
    if (!isBinary || !upstream || upstream.destroyed) {
      webSocket.close(1008, 'binary tunnel required');
      return;
    }
    upstream.write(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Source preview WebSocket relay listening on ${HOST}:${PORT}`);
});

async function shutdown() {
  for (const webSocket of webSockets.clients) webSocket.terminate();
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { connector };
