const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BROWSER_NETWORK_HARDENING_ARGS = Object.freeze([
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
]);

function normalizeLoopbackProxyUrl(input) {
  if (!input) return '';
  if (typeof input !== 'string' || input.length > 256) throw new Error('INVALID_PROXY_URL');

  let parsed;
  try {
    parsed = new URL(input);
  } catch (error) {
    throw new Error('INVALID_PROXY_URL');
  }
  if (parsed.protocol !== 'http:'
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

function browserLaunchOptions(proxyUrl = '') {
  const normalizedProxy = normalizeLoopbackProxyUrl(proxyUrl);
  if (!normalizedProxy) throw new Error('LOOPBACK_PROXY_REQUIRED');
  return {
    headless: true,
    channel: 'chromium',
    args: [
      '--disable-dev-shm-usage',
      ...BROWSER_NETWORK_HARDENING_ARGS
    ],
    proxy: {
      server: normalizedProxy,
      // Playwright already forces this for Chromium, but setting it explicitly
      // keeps loopback and link-local targets behind the guarded proxy even if
      // the Playwright escape hatch is enabled in the environment.
      bypass: '<-loopback>'
    }
  };
}

module.exports = {
  BROWSER_NETWORK_HARDENING_ARGS,
  normalizeLoopbackProxyUrl,
  browserLaunchOptions
};
