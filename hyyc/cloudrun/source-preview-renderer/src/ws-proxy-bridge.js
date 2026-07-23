const http = require('node:http');
const net = require('node:net');
const WebSocket = require('ws');
const { isPrivateIp } = require('./network-security.js');

const CONNECT_TIMEOUT_MS = 12000;

function parseConnectTarget(value) {
  const match = /^([a-zA-Z0-9.-]+):([0-9]{1,5})$/.exec(String(value || ''));
  if (!match || Number(match[2]) !== 443) {
    throw new Error('PROXY_TARGET_INVALID');
  }
  return { host: match[1].toLowerCase(), port: 443 };
}

function closeSocket(socket, status = '502 Bad Gateway') {
  if (!socket || socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

function normalizeRelayAddress(value) {
  const address = String(value || '').trim();
  if (!address) return '';
  if (!net.isIP(address) || isPrivateIp(address)) throw new Error('PROXY_RELAY_ADDRESS_INVALID');
  return address;
}

function createRelayWebSocketOptions(token, relayAddress) {
  const address = normalizeRelayAddress(relayAddress);
  const options = {
    headers: { authorization: `Bearer ${token}` },
    handshakeTimeout: CONNECT_TIMEOUT_MS,
    maxPayload: 2 * 1024 * 1024
  };
  if (address) {
    const family = net.isIP(address);
    options.lookup = (_hostname, lookupOptions, callback) => {
      if (lookupOptions && lookupOptions.all) {
        callback(null, [{ address, family }]);
        return;
      }
      callback(null, address, family);
    };
  }
  return options;
}

function createWebSocketProxyBridge({ relayUrl, relayAddress = '', token, logger = console }) {
  if (!/^wss:\/\//i.test(String(relayUrl || '')) || String(token || '').length < 32) {
    throw new Error('PROXY_BRIDGE_CONFIG_INVALID');
  }
  const webSocketOptions = createRelayWebSocketOptions(token, relayAddress);
  const server = http.createServer((request, response) => {
    response.writeHead(405, { connection: 'close' });
    response.end();
  });
  let listenPromise = null;

  server.on('connect', (request, clientSocket, head) => {
    let target;
    try {
      target = parseConnectTarget(request.url);
    } catch (error) {
      closeSocket(clientSocket, '400 Bad Request');
      return;
    }

    const relay = new WebSocket(relayUrl, webSocketOptions);
    let ready = false;
    const pendingClientChunks = head && head.length ? [head] : [];
    let pendingClientBytes = head && head.length || 0;
    const timeout = setTimeout(() => {
      relay.terminate();
      closeSocket(clientSocket, '504 Gateway Timeout');
    }, CONNECT_TIMEOUT_MS);

    const closeBoth = () => {
      clearTimeout(timeout);
      if (!clientSocket.destroyed) clientSocket.destroy();
      if (relay.readyState === WebSocket.OPEN || relay.readyState === WebSocket.CONNECTING) {
        relay.terminate();
      }
    };
    clientSocket.once('error', closeBoth);
    clientSocket.once('close', () => {
      if (relay.readyState === WebSocket.OPEN || relay.readyState === WebSocket.CONNECTING) {
        relay.close();
      }
    });
    relay.once('error', (error) => {
      if (!ready) closeSocket(clientSocket);
      logger.warn('WebSocket proxy relay unavailable', { message: error && error.message });
    });
    relay.once('close', () => {
      clearTimeout(timeout);
      if (!clientSocket.destroyed) clientSocket.destroy();
    });
    relay.once('open', () => relay.send(JSON.stringify(target)));
    relay.on('message', (data, isBinary) => {
      if (!ready) {
        if (isBinary) return closeBoth();
        let response;
        try {
          response = JSON.parse(data.toString('utf8'));
        } catch (error) {
          return closeBoth();
        }
        if (!response || response.ok !== true) return closeBoth();
        ready = true;
        clearTimeout(timeout);
        clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: source-preview-bridge\r\n\r\n');
        pendingClientChunks.forEach((chunk) => relay.send(chunk, { binary: true }));
        pendingClientChunks.length = 0;
        return;
      }
      if (!isBinary || clientSocket.destroyed) return closeBoth();
      clientSocket.write(data);
    });
    clientSocket.on('data', (chunk) => {
      if (ready && relay.readyState === WebSocket.OPEN) {
        relay.send(chunk, { binary: true });
        return;
      }
      pendingClientBytes += chunk.length;
      if (pendingClientBytes > 2 * 1024 * 1024) return closeBoth();
      pendingClientChunks.push(chunk);
    });
  });

  async function listen() {
    if (!listenPromise) {
      listenPromise = new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          const address = server.address();
          resolve(`http://127.0.0.1:${address.port}`);
        });
      }).catch((error) => {
        listenPromise = null;
        throw error;
      });
    }
    return listenPromise;
  }

  async function close() {
    if (!server.listening) return;
    await new Promise((resolve) => server.close(resolve));
    listenPromise = null;
  }

  return { listen, close };
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  parseConnectTarget,
  normalizeRelayAddress,
  createRelayWebSocketOptions,
  createWebSocketProxyBridge
};
