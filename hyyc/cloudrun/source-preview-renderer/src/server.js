const http = require('node:http');
const { authorized } = require('./auth.js');
const { createCaptureService } = require('./capture.js');

const PORT = Math.max(1, Number(process.env.PORT) || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.CAPTURE_TOKEN || '';
const CAPTURE_TIMEOUT_MS = Math.max(5000, Math.min(25000, Number(process.env.CAPTURE_TIMEOUT_MS) || 24000));
const MAX_BODY_BYTES = 8 * 1024;
const captureService = createCaptureService();
let activeCaptures = 0;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.setTimeout(5000, () => request.destroy(new Error('REQUEST_TIMEOUT')));
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      request.setTimeout(0);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/health') {
    sendJson(response, 200, { ok: true, configured: TOKEN.length >= 32 });
    return;
  }
  if (request.method !== 'POST' || path !== '/capture') {
    sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
    return;
  }
  if (!authorized(request.headers.authorization, TOKEN)) {
    sendJson(response, TOKEN.length >= 32 ? 401 : 503, { ok: false, error: 'UNAVAILABLE' });
    return;
  }
  if (activeCaptures >= 1) {
    sendJson(response, 429, { ok: false, error: 'BUSY' });
    return;
  }

  activeCaptures += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
  const abortOnDisconnect = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.once('close', abortOnDisconnect);
  try {
    const body = await readJson(request);
    const result = await captureService.capture(body.url, body.maxSegments, controller.signal);
    sendJson(response, 200, { ok: true, data: result });
  } catch (error) {
    console.warn('Source preview capture failed', { message: error && error.message });
    sendJson(response, 422, { ok: false, error: 'CAPTURE_FAILED' });
  } finally {
    clearTimeout(timeout);
    response.removeListener('close', abortOnDisconnect);
    activeCaptures -= 1;
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Source preview renderer listening on ${HOST}:${PORT}`);
});

async function shutdown() {
  server.close();
  await captureService.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
