const net = require('node:net');
const tls = require('node:tls');
const { createWebSocketProxyBridge } = require('../cloudrun/source-preview-renderer/src/ws-proxy-bridge.js');

function openTunnel(proxyUrl, host) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxyUrl.hostname, port: Number(proxyUrl.port) });
    const chunks = [];
    let total = 0;
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(25000, () => fail(new Error('RELAY_TEST_TIMEOUT')));
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
    });
    const onData = (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 16 * 1024) return fail(new Error('RELAY_RESPONSE_INVALID'));
      const response = Buffer.concat(chunks);
      const boundary = response.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      socket.setTimeout(0);
      const statusLine = response.subarray(0, boundary).toString('latin1').split('\r\n')[0];
      if (!/^HTTP\/1\.[01] 200\b/.test(statusLine)) {
        return fail(new Error(`RELAY_CONNECT_FAILED:${statusLine}`));
      }
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

function requestThroughTunnel(socket, host, path) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host });
    let bytes = 0;
    let firstLine = '';
    const timeout = setTimeout(() => secure.destroy(new Error('RELAY_HTTPS_TIMEOUT')), 25000);
    secure.once('error', reject);
    secure.once('secureConnect', () => {
      secure.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    secure.on('data', (chunk) => {
      bytes += chunk.length;
      if (!firstLine) firstLine = chunk.toString('latin1').split('\r\n')[0];
    });
    secure.once('end', () => {
      clearTimeout(timeout);
      resolve({ status: firstLine, bytes });
    });
  });
}

async function main() {
  const config = require('../../wiki/secrets/SourcePreviewConfig.js');
  const relayUrl = process.argv[2]
    || process.env.SOURCE_PREVIEW_RELAY_URL
    || 'wss://mrshenzf.top/source-proxy/tunnel';
  const relayAddress = process.argv[3]
    || process.env.SOURCE_PREVIEW_RELAY_ADDRESS
    || '';
  const bridge = createWebSocketProxyBridge({
    relayUrl,
    relayAddress,
    token: config.sourcePreviewRendererToken,
    logger: { warn() {} }
  });
  try {
    const proxyUrl = new URL(await bridge.listen());
    const socket = await openTunnel(proxyUrl, 'x.com');
    const result = await requestThroughTunnel(socket, 'x.com', '/robots.txt');
    if (!/^HTTP\/1\.[01] [23]/.test(result.status) || result.bytes < 100) {
      throw new Error(`RELAY_CONTENT_INVALID:${result.status}:${result.bytes}`);
    }
    console.log(JSON.stringify({ relay: 'ready', relayUrl, addressPinned: Boolean(relayAddress), ...result }));
  } finally {
    await bridge.close();
  }
}

main().catch((error) => {
  console.error(error && error.message || error);
  process.exitCode = 1;
});
