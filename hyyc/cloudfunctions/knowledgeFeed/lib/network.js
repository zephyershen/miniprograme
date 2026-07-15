const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 6000;

function normalizeHttpsUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('INVALID_URL');
  const parsed = new URL(input.trim());
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('INVALID_URL');
  }
  parsed.hash = '';
  return parsed.toString();
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function isPrivateIp(address) {
  const clean = String(address || '').toLowerCase().split('%')[0];
  const family = net.isIP(clean);
  if (family === 4) return isPrivateIpv4(clean);
  if (family !== 6) return true;
  return clean === '::' || clean === '::1' || clean.includes('.') || clean.startsWith('::ffff:') ||
    clean.startsWith('64:ff9b:') || clean.startsWith('fc') || clean.startsWith('fd') ||
    /^fe[89ab]/.test(clean) || clean.startsWith('ff') || clean.startsWith('2001:db8:');
}

async function withTimeout(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function assertPublicHost(url, resolver = dns.lookup, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('PRIVATE_ADDRESS');
    return [{ address: hostname, family: net.isIP(hostname) }];
  }
  const records = await withTimeout(resolver(hostname, { all: true, verbatim: true }), timeoutMs);
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('PRIVATE_ADDRESS');
  return records;
}

function requestPinned(url, addressRecord, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let absoluteTimeout;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimeout);
      if (error) reject(error);
      else resolve(value);
    };
    const parsed = new URL(url);
    const originalHost = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const request = https.request({
      protocol: 'https:',
      hostname: addressRecord.address,
      family: addressRecord.family,
      port: 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      servername: net.isIP(originalHost) ? undefined : originalHost,
      rejectUnauthorized: true,
      headers: {
        accept: options.accept,
        'accept-encoding': 'identity',
        host: parsed.host,
        'user-agent': 'KnowledgePlatform/1.0 (+WeChat Mini Program; AI HOT integration)'
      }
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        finish(null, { status, location, headers: response.headers, buffer: Buffer.alloc(0) });
        return;
      }
      const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
      if (encoding !== 'identity') {
        response.destroy(new Error('UNSUPPORTED_ENCODING'));
        return;
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > options.maxBytes) {
        response.destroy(new Error('RESPONSE_TOO_LARGE'));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > options.maxBytes) {
          response.destroy(new Error('RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        status,
        location,
        headers: response.headers,
        buffer: Buffer.concat(chunks)
      }));
      response.on('error', (error) => finish(error));
    });
    absoluteTimeout = setTimeout(() => request.destroy(new Error('REQUEST_TIMEOUT')), options.timeoutMs);
    request.on('error', (error) => finish(error));
    request.end();
  });
}

async function fetchPublicBuffer(input, options = {}) {
  let currentUrl = normalizeHttpsUrl(input);
  const settings = {
    accept: options.accept || '*/*',
    maxBytes: options.maxBytes || 700 * 1024,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxRedirects: Number.isInteger(options.maxRedirects)
      ? Math.max(0, Math.min(MAX_REDIRECTS, options.maxRedirects))
      : MAX_REDIRECTS
  };
  for (let redirects = 0; redirects <= settings.maxRedirects; redirects += 1) {
    const addresses = await assertPublicHost(currentUrl, options.resolver || dns.lookup, settings.timeoutMs);
    const response = await requestPinned(currentUrl, addresses[0], settings);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects === settings.maxRedirects) throw new Error('TOO_MANY_REDIRECTS');
      currentUrl = normalizeHttpsUrl(new URL(response.location, currentUrl).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}`);
    return { ...response, finalUrl: currentUrl };
  }
  throw new Error('FETCH_FAILED');
}

module.exports = { normalizeHttpsUrl, isPrivateIp, assertPublicHost, fetchPublicBuffer };
