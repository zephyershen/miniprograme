const http = require('node:http');
const net = require('node:net');
const { createRelayConnector } = require('./relay-outbound.js');

const LOOPBACK_HOST = '127.0.0.1';
const CONNECT_TIMEOUT_MS = 12000;

function parseHttpsConnectTarget(value) {
  const authority = String(value || '').trim();
  const portMatch = /:([0-9]{1,5})$/.exec(authority);
  if (!authority
    || authority.length > 260
    || /[\s/@?#]/.test(authority)
    || !portMatch
    || Number(portMatch[1]) !== 443) {
    throw new Error('PROXY_TARGET_INVALID');
  }

  let parsed;
  try {
    parsed = new URL(`https://${authority}`);
  } catch (error) {
    throw new Error('PROXY_TARGET_INVALID');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw new Error('PROXY_TARGET_INVALID');
  }
  return { host: hostname, port: 443 };
}

function closeClientSocket(socket, status = '502 Bad Gateway') {
  if (!socket || socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

function createFixedIpProxy({
  resolvePublicHost,
  connect = net.connect,
  timeoutMs = CONNECT_TIMEOUT_MS,
  logger = console
} = {}) {
  if (typeof resolvePublicHost !== 'function') throw new Error('PROXY_RESOLVER_REQUIRED');
  const connector = createRelayConnector({
    mode: 'direct',
    resolvePublicHost,
    connect,
    timeoutMs
  });
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    // The renderer permits only HTTPS network requests. data: and blob: never
    // reach this proxy, while clear-text HTTP is rejected at the transport.
    response.writeHead(403, {
      connection: 'close',
      'content-type': 'text/plain; charset=utf-8'
    });
    response.end('HTTPS required');
  });
  let listenPromise = null;

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('connect', async (request, clientSocket, head) => {
    let target;
    try {
      target = parseHttpsConnectTarget(request.url);
    } catch (error) {
      closeClientSocket(clientSocket, '400 Bad Request');
      return;
    }

    let upstream;
    try {
      const tunnel = await connector.open(target.host, target.port);
      upstream = tunnel.socket;
      if (clientSocket.destroyed) {
        upstream.destroy();
        return;
      }
      upstream.once('error', () => clientSocket.destroy());
      clientSocket.once('error', () => upstream.destroy());
      clientSocket.once('close', () => upstream.destroy());
      clientSocket.write(
        'HTTP/1.1 200 Connection Established\r\n'
        + 'Proxy-Agent: source-preview-fixed-ip\r\n\r\n'
      );
      if (head && head.length) upstream.write(head);
      if (tunnel.remainder.length) clientSocket.write(tunnel.remainder);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    } catch (error) {
      logger.warn('Fixed-IP browser proxy rejected target', {
        code: error && error.message
      });
      if (upstream && !upstream.destroyed) upstream.destroy();
      closeClientSocket(clientSocket);
    }
  });

  async function listen() {
    if (!listenPromise) {
      listenPromise = new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOOPBACK_HOST, () => {
          server.removeListener('error', reject);
          const address = server.address();
          resolve(`http://${LOOPBACK_HOST}:${address.port}`);
        });
      }).catch((error) => {
        listenPromise = null;
        throw error;
      });
    }
    return listenPromise;
  }

  async function close() {
    for (const socket of sockets) socket.destroy();
    if (!server.listening) {
      listenPromise = null;
      return;
    }
    await new Promise((resolve) => server.close(resolve));
    listenPromise = null;
  }

  return { listen, close };
}

module.exports = {
  LOOPBACK_HOST,
  CONNECT_TIMEOUT_MS,
  parseHttpsConnectTarget,
  createFixedIpProxy
};
