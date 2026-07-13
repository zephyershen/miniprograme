const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { AppError } = require('./errors');

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10000;
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'mp.weixin.qq.com']);
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'mc_cid', 'mc_eid',
  'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'
]);

function invalidUrl(message = '只支持无需登录的 HTTPS 文章链接') {
  throw new AppError('INVALID_URL', message);
}

function normalizePublicHttpsUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > MAX_URL_LENGTH) invalidUrl();

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch (error) {
    invalidUrl('链接格式不正确');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) invalidUrl();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (!parsed.hostname || BLOCKED_HOSTS.has(parsed.hostname)) invalidUrl('该站点暂不支持');
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
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
    (a === 192 && b === 0) ||
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

  return clean === '::' || clean === '::1' || clean.includes('.') ||
    clean.startsWith('::ffff:') || clean.startsWith('64:ff9b:') ||
    clean.startsWith('fc') || clean.startsWith('fd') ||
    /^fe[89ab]/.test(clean) || clean.startsWith('ff') ||
    clean.startsWith('2001:db8:');
}

async function assertPublicHost(url, resolver = dns.lookup) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) invalidUrl('不支持内网或保留地址');
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  let records;
  try {
    records = await resolver(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new AppError('UNSUPPORTED_PAGE', '无法解析该站点');
  }
  if (!Array.isArray(records) || !records.length || records.some((record) => isPrivateIp(record.address))) {
    invalidUrl('不支持内网或保留地址');
  }
  return records;
}

async function readLimitedBody(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new AppError('UNSUPPORTED_PAGE', '页面内容超过 2MB 限制');
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new AppError('UNSUPPORTED_PAGE', '页面内容超过 2MB 限制');
    return buffer.toString('utf8');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('UNSUPPORTED_PAGE', '页面内容超过 2MB 限制');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requestPinnedPage(url, addressRecord, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const originalHost = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const maxBytes = options.maxBytes || MAX_RESPONSE_BYTES;
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
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'accept-encoding': 'identity',
        host: parsed.host,
        'user-agent': 'DigestInbox/1.0 (+WeChat Mini Program)'
      }
    }, (response) => {
      const headers = {
        get(name) {
          const value = response.headers[String(name).toLowerCase()];
          return Array.isArray(value) ? value.join(', ') : (value || null);
        }
      };
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        resolve({ status, ok: false, headers, bodyText: '' });
        return;
      }

      const encoding = String(headers.get('content-encoding') || 'identity').toLowerCase();
      if (encoding !== 'identity') {
        response.destroy();
        reject(new AppError('UNSUPPORTED_PAGE', '网页压缩格式暂不支持'));
        return;
      }
      const declaredLength = Number(headers.get('content-length') || 0);
      if (declaredLength > maxBytes) {
        response.destroy();
        reject(new AppError('UNSUPPORTED_PAGE', '页面内容超过 2MB 限制'));
        return;
      }

      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy(new AppError('UNSUPPORTED_PAGE', '页面内容超过 2MB 限制'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers,
          bodyText: Buffer.concat(chunks).toString('utf8')
        });
      });
      response.on('error', reject);
    });

    request.setTimeout(options.timeoutMs || REQUEST_TIMEOUT_MS, () => {
      const error = new Error('REQUEST_TIMEOUT');
      error.code = 'REQUEST_TIMEOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchPublicPage(input, options = {}) {
  const fetchImpl = options.fetchImpl;
  const resolver = options.resolver || dns.lookup;
  let currentUrl = normalizePublicHttpsUrl(input);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const publicAddresses = await assertPublicHost(currentUrl, resolver);
    let response;
    if (fetchImpl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
      try {
        response = await fetchImpl(currentUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
            'user-agent': 'DigestInbox/1.0 (+WeChat Mini Program)'
          }
        });
      } catch (error) {
        throw new AppError('UNSUPPORTED_PAGE', error.name === 'AbortError' ? '页面读取超时' : '无法读取该页面');
      } finally {
        clearTimeout(timeout);
      }
    } else {
      try {
        response = await requestPinnedPage(currentUrl, publicAddresses[0], options);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('UNSUPPORTED_PAGE', error.code === 'REQUEST_TIMEOUT' ? '页面读取超时' : '无法读取该页面');
      }
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) throw new AppError('UNSUPPORTED_PAGE', '页面重定向次数过多');
      const location = response.headers.get('location');
      if (!location) throw new AppError('UNSUPPORTED_PAGE', '页面重定向地址无效');
      currentUrl = normalizePublicHttpsUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) throw new AppError('UNSUPPORTED_PAGE', `页面返回状态 ${response.status}`);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
      throw new AppError('UNSUPPORTED_PAGE', '只支持普通网页文章，不支持 PDF、视频或下载文件');
    }

    return {
      html: Object.prototype.hasOwnProperty.call(response, 'bodyText')
        ? response.bodyText
        : await readLimitedBody(response, options.maxBytes),
      finalUrl: currentUrl,
      contentType
    };
  }

  throw new AppError('UNSUPPORTED_PAGE', '无法读取该页面');
}

module.exports = {
  MAX_RESPONSE_BYTES,
  normalizePublicHttpsUrl,
  isPrivateIp,
  assertPublicHost,
  requestPinnedPage,
  fetchPublicPage
};
