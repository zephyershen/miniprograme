const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePublicHttpsUrl,
  isPrivateIp,
  assertPublicHost,
  fetchPublicPage
} = require('../cloudfunctions/digestIngest/lib/url-security');

test('normalizes HTTPS URLs and removes tracking parameters', () => {
  assert.equal(
    normalizePublicHttpsUrl(' https://Example.com/path?utm_source=x&b=2&a=1#part '),
    'https://example.com/path?a=1&b=2'
  );
});

test('rejects non-HTTPS, credentials, WeChat articles and invalid URLs', () => {
  for (const value of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com:8443/article',
    'https://mp.weixin.qq.com/s/abc',
    'not-a-url'
  ]) {
    assert.throws(() => normalizePublicHttpsUrl(value), { name: 'AppError', code: 'INVALID_URL' });
  }
});

test('classifies private and reserved IP ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.20.1.1', '192.168.1.1', '169.254.1.1', '::1', '::ffff:7f00:1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPrivateIp(address), true, address);
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(address), false, address);
  }
});

test('rejects hostnames resolving to a private address', async () => {
  await assert.rejects(
    assertPublicHost('https://example.com/', async () => [{ address: '10.0.0.5', family: 4 }]),
    { code: 'INVALID_URL' }
  );
});

test('revalidates redirects and reads a limited HTML response', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (seen.length === 1) return new Response('', { status: 302, headers: { location: 'https://news.example/article' } });
    return new Response('<html><article>Hello</article></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const result = await fetchPublicPage('https://example.com/start', {
    fetchImpl,
    resolver: async () => [{ address: '1.1.1.1', family: 4 }]
  });
  assert.equal(result.finalUrl, 'https://news.example/article');
  assert.match(result.html, /Hello/);
  assert.equal(seen.length, 2);
});

test('rejects a redirect to a private hostname before the second fetch', async () => {
  let calls = 0;
  await assert.rejects(
    fetchPublicPage('https://example.com/start', {
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 302, headers: { location: 'https://localhost/private' } });
      },
      resolver: async () => [{ address: '1.1.1.1', family: 4 }]
    }),
    { code: 'INVALID_URL' }
  );
  assert.equal(calls, 1);
});

test('rejects a response larger than the configured body limit', async () => {
  await assert.rejects(
    fetchPublicPage('https://example.com/article', {
      fetchImpl: async () => new Response('12345', {
        status: 200,
        headers: { 'content-type': 'text/html', 'content-length': '5' }
      }),
      resolver: async () => [{ address: '1.1.1.1', family: 4 }],
      maxBytes: 4
    }),
    { code: 'UNSUPPORTED_PAGE' }
  );
});
