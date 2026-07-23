const WebSocket = require('ws');
const { createRelayWebSocketOptions } = require('./ws-proxy-bridge.js');

const DEFAULT_TIMEOUT_MS = 12 * 1000;

function probeRelayTunnel({
  relayUrl,
  relayAddress = '',
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  WebSocketImpl = WebSocket
}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(
      relayUrl,
      createRelayWebSocketOptions(token, relayAddress)
    );
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocketImpl.OPEN) socket.close();
      else if (typeof socket.terminate === 'function') socket.terminate();
      if (error) reject(error);
      else resolve(data);
    };
    const timeout = setTimeout(
      () => finish(new Error('PROXY_RELAY_PROBE_TIMEOUT')),
      timeoutMs
    );
    socket.once('open', () => socket.send(JSON.stringify({ host: 'x.com', port: 443 })));
    socket.once('message', (data, isBinary) => {
      if (isBinary) return finish(new Error('PROXY_RELAY_PROBE_INVALID'));
      try {
        const response = JSON.parse(data.toString('utf8'));
        if (!response || response.ok !== true) throw new Error('PROXY_RELAY_PROBE_REJECTED');
        finish(null, { relayReady: true, target: 'x.com:443' });
      } catch (error) {
        finish(error);
      }
    });
    socket.once('unexpected-response', (_request, response) => {
      finish(new Error(`PROXY_RELAY_HTTP_${Number(response && response.statusCode) || 0}`));
    });
    socket.once('error', (error) => finish(error));
    socket.once('close', (code) => {
      if (!settled) finish(new Error(`PROXY_RELAY_CLOSED_${Number(code) || 0}`));
    });
  });
}

module.exports = { DEFAULT_TIMEOUT_MS, probeRelayTunnel };
