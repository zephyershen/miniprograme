const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:']);

function normalizeLoopbackProxyUrl(input) {
  if (!input) return '';
  if (typeof input !== 'string' || input.length > 256) throw new Error('INVALID_PROXY_URL');

  let parsed;
  try {
    parsed = new URL(input);
  } catch (error) {
    throw new Error('INVALID_PROXY_URL');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)
    || !LOOPBACK_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== '/')
    || parsed.search
    || parsed.hash
    || !parsed.port) {
    throw new Error('INVALID_PROXY_URL');
  }
  return parsed.toString().replace(/\/$/, '');
}

function browserLaunchOptions(
  proxyUrl = process.env.PLAYWRIGHT_PROXY_URL || '',
  { allowDirectEgress = process.env.ALLOW_DIRECT_EGRESS === 'true' } = {}
) {
  const normalizedProxy = normalizeLoopbackProxyUrl(proxyUrl);
  if (!normalizedProxy && !allowDirectEgress) throw new Error('LOOPBACK_PROXY_REQUIRED');
  return {
    headless: true,
    channel: 'chromium',
    args: ['--disable-dev-shm-usage'],
    ...(normalizedProxy ? { proxy: { server: normalizedProxy } } : {})
  };
}

module.exports = { normalizeLoopbackProxyUrl, browserLaunchOptions };
