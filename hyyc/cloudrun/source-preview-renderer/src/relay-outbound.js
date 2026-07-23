const net = require('node:net');
const { isPrivateIp } = require('./network-security.js');

const DIRECT_MODE = 'direct';
const HTTP_CONNECT_MODE = 'http-connect';
const CONNECT_TIMEOUT_MS = 12000;

function normalizeRelayEgressMode(value) {
  const normalized = String(value || HTTP_CONNECT_MODE).trim().toLowerCase();
  if (normalized !== DIRECT_MODE && normalized !== HTTP_CONNECT_MODE) {
    throw new Error('RELAY_EGRESS_MODE_INVALID');
  }
  return normalized;
}

function connectSocket(options, connect = net.connect, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = connect(options);
    const timeout = setTimeout(() => socket.destroy(new Error('RELAY_CONNECT_TIMEOUT')), timeoutMs);
    const fail = (error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    socket.once('error', fail);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.removeListener('error', fail);
      resolve(socket);
    });
  });
}

async function openDirectTunnel(host, port, {
  resolvePublicHost,
  connect = net.connect,
  timeoutMs = CONNECT_TIMEOUT_MS
} = {}) {
  if (typeof resolvePublicHost !== 'function') throw new Error('RELAY_RESOLVER_REQUIRED');
  const addresses = await resolvePublicHost(host);
  let lastError = null;
  for (const entry of addresses) {
    try {
      const socket = await connectSocket({
        host: entry.address,
        family: Number(entry.family) || undefined,
        port
      }, connect, timeoutMs);
      return { socket, remainder: Buffer.alloc(0) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('RELAY_TARGET_UNAVAILABLE');
}

async function openHttpConnectTunnel(host, port, {
  proxyHost = '127.0.0.1',
  proxyPort = 7890,
  connect = net.connect,
  timeoutMs = CONNECT_TIMEOUT_MS
} = {}) {
  if (!net.isIP(host) || isPrivateIp(host)) throw new Error('RELAY_TARGET_ADDRESS_INVALID');
  const socket = await connectSocket({ host: proxyHost, port: proxyPort }, connect, timeoutMs);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const timeout = setTimeout(() => socket.destroy(new Error('UPSTREAM_PROXY_TIMEOUT')), timeoutMs);
    const fail = (error) => {
      clearTimeout(timeout);
      socket.destroy();
      reject(error);
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 16 * 1024) return fail(new Error('UPSTREAM_PROXY_RESPONSE_INVALID'));
      const response = Buffer.concat(chunks);
      const boundary = response.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      clearTimeout(timeout);
      const head = response.subarray(0, boundary).toString('latin1');
      if (!/^HTTP\/1\.[01] 200\b/.test(head)) return fail(new Error('UPSTREAM_PROXY_REJECTED'));
      resolve({ socket, remainder: response.subarray(boundary + 4) });
    };
    socket.once('error', fail);
    socket.on('data', onData);
    const authority = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Connection: keep-alive\r\n\r\n`);
  });
}

function createRelayConnector({
  mode = HTTP_CONNECT_MODE,
  resolvePublicHost,
  proxyHost = '127.0.0.1',
  proxyPort = 7890,
  connect = net.connect,
  timeoutMs = CONNECT_TIMEOUT_MS
} = {}) {
  const egressMode = normalizeRelayEgressMode(mode);
  return {
    mode: egressMode,
    async open(host, port) {
      if (egressMode === DIRECT_MODE) {
        return openDirectTunnel(host, port, { resolvePublicHost, connect, timeoutMs });
      }
      if (typeof resolvePublicHost !== 'function') throw new Error('RELAY_RESOLVER_REQUIRED');
      const addresses = await resolvePublicHost(host);
      let lastError = null;
      for (const entry of addresses) {
        try {
          // The upstream proxy receives a validated IP literal, so it cannot
          // resolve the attacker-controlled hostname a second time. Chromium
          // still performs TLS over this byte tunnel using the original
          // hostname for SNI and certificate validation.
          return await openHttpConnectTunnel(entry.address, port, {
            proxyHost, proxyPort, connect, timeoutMs
          });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('RELAY_TARGET_UNAVAILABLE');
    }
  };
}

module.exports = {
  DIRECT_MODE,
  HTTP_CONNECT_MODE,
  normalizeRelayEgressMode,
  openDirectTunnel,
  openHttpConnectTunnel,
  createRelayConnector
};
