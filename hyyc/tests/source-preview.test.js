const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { authorized } = require('../cloudrun/source-preview-renderer/src/auth');
const {
  normalizePublicHttpsUrl,
  isPrivateIp,
  createPublicUrlGuard
} = require('../cloudrun/source-preview-renderer/src/network-security');
const {
  maintenanceAuthorized,
  previewRetryDelay,
  previewAttemptIsDue,
  createPreviewService
} = require('../cloudfunctions/knowledgeFeed/services/preview-service');
const {
  BROWSER_NETWORK_HARDENING_ARGS,
  normalizeLoopbackProxyUrl,
  browserLaunchOptions
} = require('../cloudrun/source-preview-renderer/src/proxy');
const {
  guardedWebSocketUrl,
  installGuardedContextRoutes
} = require('../cloudrun/source-preview-renderer/src/browser-network-policy');
const { assertRenderableResponse } = require('../cloudrun/source-preview-renderer/src/page-policy');
const { createCloudFileDeleter } = require('../cloudfunctions/knowledgeFeed/services/cloud-file-deleter');
const { createFeedCacheRepository } = require('../cloudfunctions/knowledgeFeed/repositories/feed-cache');
const { visualVersion } = require('../cloudfunctions/knowledgeFeed/lib/visual-version');
const {
  VIEWPORT,
  createCapturePlan
} = require('../cloudrun/source-preview-renderer/src/capture-plan');
const {
  capturePageSegments
} = require('../cloudrun/source-preview-renderer/src/capture-segments');
const {
  normalizeCaptureProfile,
  statusIdFromUrl,
  candidateScore,
  chooseFocusCandidate
} = require('../cloudrun/source-preview-renderer/src/focus-policy');
const {
  createFocusCapturePlan
} = require('../cloudrun/source-preview-renderer/src/capture-focused');
const {
  isBrowserLifecycleError,
  isRecoverableFocusCaptureError,
  captureFocusedOrPage,
  createCaptureService
} = require('../cloudrun/source-preview-renderer/src/capture');
const {
  isNewVisualItem,
  isNewVisualJob
} = require('../cloudfunctions/knowledgeFeed/policies/new-visuals');
const {
  LIST_THUMBNAIL_WIDTH,
  LIST_THUMBNAIL_HEIGHT,
  renderListThumbnail
} = require('../cloudrun/source-preview-renderer/src/list-thumbnail');
const {
  createListThumbnailService
} = require('../cloudfunctions/knowledgeFeed/services/list-thumbnail-service');
const {
  functionPayload,
  createSourcePreviewRendererClient
} = require('../cloudfunctions/knowledgeFeed/adapters/source-preview-renderer-client');
const {
  parseConnectTarget,
  normalizeRelayAddress,
  createRelayWebSocketOptions
} = require('../cloudrun/source-preview-renderer/src/ws-proxy-bridge');
const {
  normalizeRelayEgressMode,
  createRelayConnector
} = require('../cloudrun/source-preview-renderer/src/relay-outbound');
const {
  parseHttpsConnectTarget,
  createFixedIpProxy
} = require('../cloudrun/source-preview-renderer/src/fixed-ip-proxy');
const {
  EXPECTED_CHROMIUM_MAJOR,
  assertCompatibleBrowser
} = require('../cloudrun/source-preview-renderer/src/browser-runtime');
const {
  captureEgressPlan,
  captureRouteOptions
} = require('../cloudrun/source-preview-renderer/src/egress-policy');
const {
  probeRelayTunnel
} = require('../cloudrun/source-preview-renderer/src/relay-probe');
const {
  officialXEmbedUrl,
  shouldRetryThroughForeignProxy,
  shouldPreferForeignProxy,
  shouldPreferOpenGraph
} = require('../cloudrun/source-preview-renderer/src/egress-policy');
const {
  normalizeOpenGraphImageUrl
} = require('../cloudrun/source-preview-renderer/src/open-graph-capture');

const FILE_ID_PREFIX = 'cloud://env.bucket/knowledge-previews/source/';

test('renders a fixed low-memory list thumbnail through guarded browser requests', async () => {
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  let routed = null;
  let webSocketRouted = null;
  let assignedUrl = '';
  const setupOrder = [];
  const context = {
    route: async (pattern, handler) => {
      assert.equal(pattern, '**/*');
      setupOrder.push('http-route');
      routed = handler;
    },
    routeWebSocket: async (pattern, handler) => {
      assert.equal(pattern, '**/*');
      setupOrder.push('websocket-route');
      webSocketRouted = handler;
    },
    newPage: async () => {
      setupOrder.push('page');
      return {
        setDefaultTimeout() {},
        setContent: async () => {},
        evaluate: async (operation, value) => { assignedUrl = value; },
        waitForFunction: async () => {},
        screenshot: async () => jpeg
      };
    },
    close: async () => {}
  };
  const result = await renderListThumbnail(
    { newContext: async (options) => {
      assert.deepEqual(options.viewport, { width: LIST_THUMBNAIL_WIDTH, height: LIST_THUMBNAIL_HEIGHT });
      return context;
    } },
    'https://storage.example/signed.jpg?token=private',
    { allowBrowserRequest: async () => true }
  );
  assert.equal(typeof routed, 'function');
  assert.equal(typeof webSocketRouted, 'function');
  assert.deepEqual(setupOrder, ['http-route', 'websocket-route', 'page']);
  assert.equal(assignedUrl, 'https://storage.example/signed.jpg?token=private');
  assert.equal(result.width, 360);
  assert.equal(result.height, 253);
});

test('derives and uploads a list thumbnail from a short-lived CloudBase URL', async () => {
  const sourceFileId = 'cloud://env.bucket/knowledge-previews/source/full.jpg';
  const thumbnailPrefix = 'cloud://env.bucket/knowledge-thumbnails/list/';
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  let requestBody = null;
  const service = createListThumbnailService({
    cloud: {
      getTempFileURL: async () => ({
        fileList: [{ fileID: sourceFileId, code: 'SUCCESS', tempFileURL: 'https://storage.example/full.jpg?sign=short' }]
      }),
      uploadFile: async ({ cloudPath }) => ({ fileID: `${thumbnailPrefix}${cloudPath.split('/').pop()}` })
    },
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      rendererTimeoutMs: 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      version: 1,
      width: 360,
      height: 253,
      cloudPathPrefix: 'knowledge-thumbnails/list/',
      fileIdPrefix: thumbnailPrefix
    },
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: { version: 1, mimeType: 'image/jpeg', width: 360, height: 253, data: jpeg.toString('base64') }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    }
  });
  const result = await service.resolveAndUploadFromFile({ id: 'thumb001', url: 'https://example.com/a' }, sourceFileId);
  assert.equal(requestBody.data, undefined);
  assert.equal(requestBody.url, 'https://storage.example/full.jpg?sign=short');
  assert.equal(result.startsWith(thumbnailPrefix), true);
});

test('requires a constant-time bearer token for source preview capture', () => {
  const token = 'a'.repeat(40);
  assert.equal(authorized(`Bearer ${token}`, token), true);
  assert.equal(authorized(`Bearer ${'b'.repeat(40)}`, token), false);
  assert.equal(authorized('', token), false);
  assert.equal(authorized(`Bearer ${token}`, 'short'), false);
});

test('uses the CloudBase worker contract before any HTTP renderer fallback', async () => {
  const calls = [];
  const client = createSourcePreviewRendererClient({
    cloud: {
      callFunction: async (request) => {
        calls.push(request);
        return { result: { ok: true, data: { fileIds: ['cloud://env.bucket/a.jpg'] } } };
      }
    },
    config: {
      rendererFunctionName: 'sourcePreviewWorker',
      rendererFunctionEnabled: true,
      rendererFunctionTimeoutMs: 1000,
      rendererHttpFallbackEnabled: false,
      rendererToken: 't'.repeat(40)
    }
  });

  assert.deepEqual(await client.capture({ url: 'https://x.com/example/status/1' }), {
    fileIds: ['cloud://env.bucket/a.jpg']
  });
  assert.equal(calls[0].name, 'sourcePreviewWorker');
  assert.equal(calls[0].data.action, 'capture');
  assert.equal(calls[0].data.token, 't'.repeat(40));
  assert.equal(calls[0].timeout, 5000);
  assert.deepEqual(functionPayload({ result: JSON.stringify({ ok: true, data: { ready: true } }) }), {
    ready: true
  });
  assert.throws(() => functionPayload({ result: { ok: false } }), /PREVIEW_FUNCTION_RESPONSE_INVALID/);
});

test('limits the encrypted relay bridge to HTTPS host targets', () => {
  assert.deepEqual(parseConnectTarget('x.com:443'), { host: 'x.com', port: 443 });
  assert.deepEqual(parseConnectTarget('CDN.Example.COM:443'), { host: 'cdn.example.com', port: 443 });
  assert.throws(() => parseConnectTarget('127.0.0.1:80'), /PROXY_TARGET_INVALID/);
  assert.throws(() => parseConnectTarget('x.com:8443'), /PROXY_TARGET_INVALID/);
  assert.throws(() => parseConnectTarget('x.com:443/path'), /PROXY_TARGET_INVALID/);
});

test('can pin the authenticated relay to a validated public address without changing TLS hostname', () => {
  assert.equal(normalizeRelayAddress('8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeRelayAddress(''), '');
  assert.throws(() => normalizeRelayAddress('127.0.0.1'), /PROXY_RELAY_ADDRESS_INVALID/);
  assert.throws(() => normalizeRelayAddress('not-an-ip'), /PROXY_RELAY_ADDRESS_INVALID/);

  const options = createRelayWebSocketOptions('x'.repeat(32), '8.8.8.8');
  let lookupResult = null;
  options.lookup('source-proxy.example.com', {}, (error, address, family) => {
    lookupResult = { error, address, family };
  });
  assert.deepEqual(lookupResult, { error: null, address: '8.8.8.8', family: 4 });
  assert.equal(options.headers.authorization, `Bearer ${'x'.repeat(32)}`);
});

test('probes the authenticated relay through a fixed HTTPS target', async () => {
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;

    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = FakeWebSocket.OPEN;
      queueMicrotask(() => this.emit('open'));
    }

    send(payload) {
      this.payload = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', Buffer.from('{"ok":true}'), false));
    }

    close() {
      this.readyState = 3;
    }

    terminate() {
      this.readyState = 3;
    }
  }

  const result = await probeRelayTunnel({
    relayUrl: 'wss://source-proxy.example.com/source-proxy/tunnel',
    relayAddress: '8.8.8.8',
    token: 'x'.repeat(32),
    WebSocketImpl: FakeWebSocket
  });
  assert.deepEqual(result, { relayReady: true, target: 'x.com:443' });
});

test('keeps relay egress explicit and validates direct targets before connecting', async () => {
  assert.equal(normalizeRelayEgressMode('direct'), 'direct');
  assert.equal(normalizeRelayEgressMode(''), 'http-connect');
  assert.throws(() => normalizeRelayEgressMode('open-proxy'), /RELAY_EGRESS_MODE_INVALID/);

  const calls = [];
  const socket = new EventEmitter();
  socket.destroy = () => {};
  const connector = createRelayConnector({
    mode: 'direct',
    resolvePublicHost: async (host) => {
      calls.push(['resolve', host]);
      return [{ address: '8.8.8.8', family: 4 }];
    },
    connect: (options) => {
      calls.push(['connect', options]);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    }
  });

  const result = await connector.open('x.com', 443);
  assert.equal(result.socket, socket);
  assert.equal(result.remainder.length, 0);
  assert.deepEqual(calls, [
    ['resolve', 'x.com'],
    ['connect', { host: '8.8.8.8', family: 4, port: 443 }]
  ]);
});

test('passes a validated IP literal to the relay upstream proxy', async () => {
  const calls = [];
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.destroy = () => { socket.destroyed = true; };
  socket.write = (payload) => {
    calls.push(['write', payload]);
    queueMicrotask(() => socket.emit('data', Buffer.from(
      'HTTP/1.1 200 Connection Established\r\n\r\n'
    )));
  };
  const connector = createRelayConnector({
    mode: 'http-connect',
    resolvePublicHost: async (host) => {
      calls.push(['resolve', host]);
      return [{ address: '8.8.8.8', family: 4 }];
    },
    proxyHost: '127.0.0.1',
    proxyPort: 7890,
    connect: (options) => {
      calls.push(['connect', options]);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    }
  });

  const result = await connector.open('changing.example', 443);
  assert.equal(result.socket, socket);
  assert.deepEqual(calls.slice(0, 2), [
    ['resolve', 'changing.example'],
    ['connect', { host: '127.0.0.1', port: 7890 }]
  ]);
  assert.match(calls[2][1], /^CONNECT 8\.8\.8\.8:443 HTTP\/1\.1/);
  assert.doesNotMatch(calls[2][1], /changing\.example/);
});

test('pins each browser CONNECT tunnel to the guard result and rejects DNS rebinding', async (t) => {
  assert.deepEqual(parseHttpsConnectTarget('Public.Example:443'), {
    host: 'public.example',
    port: 443
  });
  assert.deepEqual(parseHttpsConnectTarget('[2001:4860:4860::8888]:443'), {
    host: '2001:4860:4860::8888',
    port: 443
  });
  assert.throws(() => parseHttpsConnectTarget('public.example:80'), /PROXY_TARGET_INVALID/);
  assert.throws(() => parseHttpsConnectTarget('user@public.example:443'), /PROXY_TARGET_INVALID/);

  const upstream = net.createServer(() => {});
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const upstreamPort = upstream.address().port;

  let lookupCount = 0;
  const connectCalls = [];
  const guard = createPublicUrlGuard({
    cacheTtlMs: 0,
    resolver: async () => {
      lookupCount += 1;
      return [{
        address: lookupCount === 1 ? '8.8.8.8' : '127.0.0.1',
        family: 4
      }];
    }
  });
  const proxy = createFixedIpProxy({
    resolvePublicHost: guard.resolvePublicHost,
    connect: (options) => {
      connectCalls.push(options);
      return net.connect({ host: '127.0.0.1', port: upstreamPort });
    },
    logger: { warn() {} }
  });
  t.after(() => proxy.close());
  const proxyUrl = new URL(await proxy.listen());

  async function connectStatus(authority) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port)
      });
      let response = '';
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('TEST_CONNECT_TIMEOUT'));
      }, 2000);
      socket.once('error', reject);
      socket.on('data', (chunk) => {
        response += chunk.toString('latin1');
        if (!response.includes('\r\n\r\n')) return;
        clearTimeout(timeout);
        socket.destroy();
        resolve(Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1] || 0));
      });
      socket.once('connect', () => {
        socket.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`
        );
      });
    });
  }

  assert.equal(await connectStatus('changing.example:443'), 200);
  assert.deepEqual(connectCalls, [{ host: '8.8.8.8', family: 4, port: 443 }]);
  assert.equal(await connectStatus('changing.example:443'), 502);
  assert.equal(connectCalls.length, 1);
});

test('enforces one Chromium major across Docker and CloudBase runtimes', () => {
  assert.equal(EXPECTED_CHROMIUM_MAJOR, 143);
  const compatible = { version: () => '143.0.7499.4' };
  assert.equal(assertCompatibleBrowser(compatible), compatible);
  assert.throws(
    () => assertCompatibleBrowser({ version: () => '149.0.7827.55' }),
    /CHROMIUM_VERSION_MISMATCH/
  );
});

test('uses the foreign relay only for connectivity or regional access failures', () => {
  assert.equal(shouldRetryThroughForeignProxy(new Error('page.goto: net::ERR_TIMED_OUT')), true);
  assert.equal(shouldRetryThroughForeignProxy(new Error('page.goto: Timeout 16000ms exceeded')), true);
  assert.equal(shouldRetryThroughForeignProxy(new Error('UPSTREAM_HTTP_401')), true);
  assert.equal(shouldRetryThroughForeignProxy(new Error('UPSTREAM_HTTP_403')), true);
  assert.equal(shouldRetryThroughForeignProxy(new Error('UPSTREAM_HTTP_404')), true);
  assert.equal(shouldRetryThroughForeignProxy(new Error('PAGE_QUALITY_LOGIN_WALL')), true);
  assert.equal(shouldRetryThroughForeignProxy(new Error('TARGET_STATUS_NOT_FOUND')), false);
  assert.equal(shouldRetryThroughForeignProxy(new Error('SOURCE_PREVIEW_IMAGE_INVALID')), false);
});

test('builds a bounded official embed fallback only for an exact X status', () => {
  assert.equal(
    officialXEmbedUrl('https://x.com/rohanpaul_ai/status/2079465855797334131?ref=feed'),
    'https://platform.twitter.com/embed/Tweet.html?id=2079465855797334131&dnt=true'
  );
  assert.equal(
    officialXEmbedUrl('https://twitter.com/XDevelopers/status/1228393702244134912'),
    'https://platform.twitter.com/embed/Tweet.html?id=1228393702244134912&dnt=true'
  );
  assert.equal(officialXEmbedUrl('https://x.com/rohanpaul_ai'), '');
  assert.equal(officialXEmbedUrl('https://example.com/status/2079465855797334131'), '');
  assert.equal(statusIdFromUrl(
    'https://platform.twitter.com/embed/Tweet.html?id=2079465855797334131&dnt=true'
  ), '2079465855797334131');
});

test('prefers the official X embed through the authenticated relay', () => {
  const target = 'https://x.com/rohanpaul_ai/status/2079465855797334131';
  assert.deepEqual(captureEgressPlan(target, true).map((route) => route.mode), [
    'foreign-proxy-x-embed',
    'foreign-proxy',
    'direct-x-embed',
    'direct'
  ]);
  assert.deepEqual(captureEgressPlan(target, false).map((route) => route.mode), [
    'direct',
    'direct-x-embed'
  ]);
  assert.deepEqual(captureEgressPlan('https://example.com/article', true).map((route) => route.mode), [
    'direct',
    'foreign-proxy'
  ]);
});

test('keeps the direct relay probe single-shot and reloads the selected route', () => {
  assert.deepEqual(captureRouteOptions({ proxied: false }, true), {
    allowQualityReload: false
  });
  assert.deepEqual(captureRouteOptions({ proxied: true }, true), {
    allowQualityReload: true
  });
  assert.deepEqual(captureRouteOptions({ proxied: false }, false), {
    allowQualityReload: true
  });
});

test('uses the relay first only for confirmed region-sensitive editorial hosts', () => {
  assert.equal(shouldPreferForeignProxy(
    'https://techcrunch.com/2026/07/22/example'
  ), true);
  assert.equal(shouldPreferForeignProxy('https://www.ithome.com/0/980/150.htm'), false);
  assert.deepEqual(captureEgressPlan(
    'https://techcrunch.com/2026/07/22/example',
    true
  ).map((route) => route.mode), ['foreign-proxy', 'direct']);
  assert.deepEqual(captureEgressPlan(
    'https://www.ithome.com/0/980/150.htm',
    true
  ).map((route) => route.mode), ['direct', 'foreign-proxy']);
});

test('uses reviewed Open Graph media before a known registration wall', () => {
  const target = 'https://www.marktechpost.com/2026/07/22/example';
  assert.equal(shouldPreferOpenGraph(target), true);
  assert.deepEqual(captureEgressPlan(target, true).map((route) => route.mode), [
    'foreign-proxy-open-graph',
    'foreign-proxy',
    'direct-open-graph',
    'direct'
  ]);
  assert.equal(
    normalizeOpenGraphImageUrl('/media/hero.png', target),
    'https://www.marktechpost.com/media/hero.png'
  );
  assert.equal(normalizeOpenGraphImageUrl('http://example.com/hero.png', target), '');
  assert.equal(normalizeOpenGraphImageUrl('https://user:secret@example.com/hero.png', target), '');
});

test('captures consecutive page segments beyond three while enforcing the safety ceiling', () => {
  const fiveScreens = createCapturePlan(VIEWPORT.height * 5, 12);
  assert.equal(fiveScreens.segmentCount, 5);
  assert.equal(fiveScreens.truncated, false);
  assert.deepEqual(fiveScreens.scrollPositions, [0, 1350, 2700, 4050, 5400]);

  const twentyScreens = createCapturePlan(VIEWPORT.height * 20, 99);
  assert.equal(twentyScreens.requiredSegments, 20);
  assert.equal(twentyScreens.segmentCount, 12);
  assert.equal(twentyScreens.truncated, true);
  assert.equal(twentyScreens.scrollPositions[11], 14850);
});

test('focuses the matching X status and crops the selected article into bounded segments', () => {
  const target = 'https://x.com/example/status/2078044693817184577';
  assert.equal(statusIdFromUrl(target), '2078044693817184577');
  assert.equal(normalizeCaptureProfile('focus-v1'), 'focus-v1');
  assert.equal(normalizeCaptureProfile('unknown'), 'page');

  const selected = chooseFocusCandidate([
    {
      id: 'sidebar',
      kind: 'content',
      textLength: 900,
      linkTextLength: 850,
      width: 340,
      height: 1100,
      imageCount: 3,
      meaningfulImageCount: 2
    },
    {
      id: 'tweet',
      kind: 'x-status',
      targetStatus: true,
      textLength: 360,
      linkTextLength: 40,
      width: 620,
      height: 1960,
      imageCount: 2,
      meaningfulImageCount: 2,
      semanticWeight: 900
    }
  ], target);
  assert.equal(selected.id, 'tweet');
  assert.equal(selected.confidence, 'high');
  assert.ok(candidateScore(selected) > 10000);

  const plan = createFocusCapturePlan(
    { x: 180, y: 90, width: 620, height: 1960 },
    { width: 1080, height: 4000 },
    12
  );
  assert.equal(plan.width, 676);
  assert.equal(plan.segmentCount, 2);
  assert.equal(plan.truncated, false);
  assert.ok(plan.clips.every((clip) => clip.width === 676 && clip.height <= VIEWPORT.height));
});

test('rejects a focused box that no longer intersects the latest document', () => {
  assert.equal(createFocusCapturePlan(
    { x: 4000, y: 9000, width: 620, height: 1960 },
    { width: 1080, height: 2400 },
    12
  ), null);
  assert.equal(createFocusCapturePlan(
    { x: Number.NaN, y: 20, width: 620, height: 400 },
    { width: 1080, height: 2400 },
    12
  ), null);
});

test('keeps only a useful intersection when a focused box is partly stale', () => {
  const plan = createFocusCapturePlan(
    { x: 980, y: 2250, width: 620, height: 1960 },
    { width: 1080, height: 2400 },
    12
  );
  assert.equal(plan.x, 952);
  assert.equal(plan.y, 2222);
  assert.ok(plan.clips.every((clip) => (
    clip.x >= 0
    && clip.y >= 0
    && clip.x + clip.width <= 1080
    && clip.y + clip.height <= 2400
  )));
});

test('falls back to a page capture for a recoverable focused clip error', async () => {
  const calls = [];
  const result = await captureFocusedOrPage(
    {},
    { x: 1, y: 1, width: 500, height: 500 },
    12,
    async () => {
      calls.push('focus');
      throw new Error('page.screenshot: Clipped area is either empty or outside the resulting image');
    },
    async () => {
      calls.push('page');
      return { segmentCount: 1, screenshots: [{}] };
    }
  );
  assert.deepEqual(calls, ['focus', 'page']);
  assert.equal(result.segmentCount, 1);
  assert.equal(isRecoverableFocusCaptureError(new Error('Target page, context or browser has been closed')), false);
});

test('relaunches Chromium once when a thawed CloudBase browser handle is stale', async () => {
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  let launches = 0;
  let staleClosed = 0;
  const observedLaunchOptions = [];
  const workingContext = {
    route: async () => {},
    routeWebSocket: async () => {},
    newPage: async () => ({
      setDefaultTimeout() {},
      setContent: async () => {},
      evaluate: async () => {},
      waitForFunction: async () => {},
      screenshot: async () => jpeg
    }),
    close: async () => {}
  };
  const service = createCaptureService({
    launch: async (options) => {
      observedLaunchOptions.push(options);
      launches += 1;
      if (launches === 1) {
        return {
          isConnected: () => true,
          once() {},
          close: async () => { staleClosed += 1; },
          newContext: async () => ({
            route: async () => {},
            routeWebSocket: async () => {},
            newPage: async () => { throw new Error('Target page, context or browser has been closed'); },
            close: async () => {}
          })
        };
      }
      return {
        isConnected: () => true,
        once() {},
        close: async () => {},
        newContext: async () => workingContext
      };
    },
    guard: {
      assertPublicUrl: async (url) => url,
      allowBrowserRequest: async () => true,
      resolvePublicHost: async () => [{ address: '8.8.8.8', family: 4 }]
    },
    fixedIpProxyFactory: () => ({
      listen: async () => 'http://127.0.0.1:18791',
      close: async () => {}
    }),
    allowDirectEgress: true
  });

  const result = await service.thumbnail({
    version: 1,
    url: 'https://storage.example/source.jpg'
  });
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(launches, 2);
  assert.equal(staleClosed, 1);
  assert.equal(
    observedLaunchOptions.every((options) => (
      options.proxy && options.proxy.server === 'http://127.0.0.1:18791'
    )),
    true
  );
  assert.equal(isBrowserLifecycleError(new Error('Target page, context or browser has been closed')), true);
  await service.close();
});

test('keeps visual generation forward-only when a release cutoff is configured', () => {
  const cutoff = '2026-07-18T04:43:08.568Z';
  assert.equal(isNewVisualItem({ firstStoredAt: '2026-07-18T04:43:08.567Z' }, cutoff), false);
  assert.equal(isNewVisualItem({ firstObservedAt: '2026-07-18T04:43:08.568Z' }, cutoff), true);
  assert.equal(isNewVisualJob({ createdAt: '2026-07-19T00:00:00.000Z' }, cutoff), false);
  assert.equal(isNewVisualJob({ eligibleAt: '2026-07-18T05:00:00.000Z' }, cutoff), true);
  assert.equal(isNewVisualItem({}, ''), true);
});

test('remeasures a lazy-loading page while capturing consecutive segments', async () => {
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  let metricReads = 0;
  const scrollPositions = [];
  const page = {
    evaluate: async (operation, value) => {
      if (typeof value === 'number') {
        scrollPositions.push(value);
        return undefined;
      }
      metricReads += 1;
      return {
        height: metricReads <= 2 ? VIEWPORT.height * 2 : VIEWPORT.height * 5,
        title: 'Lazy article'
      };
    },
    waitForTimeout: async () => {},
    screenshot: async () => jpeg
  };

  const result = await capturePageSegments(page, 12);
  assert.equal(result.segmentCount, 5);
  assert.equal(result.pageHeight, VIEWPORT.height * 5);
  assert.equal(result.truncated, false);
  assert.deepEqual(scrollPositions, [0, 1350, 2700, 4050, 5400]);
});

test('allows only public HTTPS targets for the browser renderer', async () => {
  const guard = createPublicUrlGuard({
    resolver: async (hostname) => hostname === 'public.example'
      ? [{ address: '8.8.8.8', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }]
  });
  assert.equal(await guard.assertPublicUrl('https://public.example/article#section'), 'https://public.example/article');
  await assert.rejects(() => guard.assertPublicUrl('https://private.example/admin'), /PRIVATE_HOST/);
  await assert.rejects(() => guard.assertPublicUrl('http://public.example/article'), /INVALID_URL/);
  assert.throws(() => normalizePublicHttpsUrl('https://user:pass@public.example'), /INVALID_URL/);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('100.100.100.200'), true);
  assert.equal(isPrivateIp('192.0.66.108'), false);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('0:0:0:0:0:0:0:1'), true);
  assert.equal(isPrivateIp('0:0:0:0:0:ffff:7f00:1'), true);
  assert.equal(isPrivateIp('64:ff9b::7f00:1'), true);
  assert.equal(isPrivateIp('ff02::1'), true);
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
});

test('guards every browser-context request and secure WebSocket before connection', async () => {
  let httpHandler = null;
  let webSocketHandler = null;
  await installGuardedContextRoutes({
    route: async (_pattern, handler) => { httpHandler = handler; },
    routeWebSocket: async (_pattern, handler) => { webSocketHandler = handler; }
  }, {
    allowBrowserRequest: async (url) => url === 'https://public.example/path'
  });

  let continued = 0;
  let aborted = 0;
  await httpHandler({
    request: () => ({ url: () => 'https://public.example/path' }),
    continue: async () => { continued += 1; },
    abort: async () => { aborted += 1; }
  });
  await httpHandler({
    request: () => ({ url: () => 'https://127.0.0.1/private' }),
    continue: async () => { continued += 1; },
    abort: async (reason) => {
      assert.equal(reason, 'blockedbyclient');
      aborted += 1;
    }
  });
  assert.equal(continued, 1);
  assert.equal(aborted, 1);

  let connected = 0;
  let closed = 0;
  await webSocketHandler({
    url: () => 'wss://public.example/path',
    connectToServer: () => { connected += 1; },
    close: async () => { closed += 1; }
  });
  await webSocketHandler({
    url: () => 'ws://public.example/path',
    connectToServer: () => { connected += 1; },
    close: async (options) => {
      assert.equal(options.code, 1008);
      closed += 1;
    }
  });
  await webSocketHandler({
    url: () => 'wss://127.0.0.1/private',
    connectToServer: () => { connected += 1; },
    close: async (options) => {
      assert.equal(options.code, 1008);
      closed += 1;
    }
  });
  assert.equal(guardedWebSocketUrl('wss://public.example/path#fragment'), 'https://public.example/path');
  assert.equal(guardedWebSocketUrl('ws://public.example/path'), '');
  assert.equal(connected, 1);
  assert.equal(closed, 2);
});

test('revalidates an expired DNS result before allowing another browser request', async () => {
  let lookupCount = 0;
  const guard = createPublicUrlGuard({
    cacheTtlMs: 0,
    resolver: async () => {
      lookupCount += 1;
      return [{ address: lookupCount === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
    }
  });
  await guard.assertPublicUrl('https://changing.example/article');
  await assert.rejects(() => guard.assertPublicUrl('https://changing.example/article'), /PRIVATE_HOST/);
});

test('accepts only a renderer-owned fixed-IP browser proxy', () => {
  assert.equal(normalizeLoopbackProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890');
  const launchOptions = browserLaunchOptions('http://127.0.0.1:7890');
  assert.deepEqual(launchOptions.proxy, {
    server: 'http://127.0.0.1:7890',
    bypass: '<-loopback>'
  });
  assert.equal(
    BROWSER_NETWORK_HARDENING_ARGS.every((argument) => launchOptions.args.includes(argument)),
    true
  );
  assert.throws(() => normalizeLoopbackProxyUrl('socks5://localhost:7891'), /INVALID_PROXY_URL/);
  assert.throws(() => normalizeLoopbackProxyUrl('https://127.0.0.1:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => normalizeLoopbackProxyUrl('http://0.0.0.0:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => normalizeLoopbackProxyUrl('http://proxy.example:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => normalizeLoopbackProxyUrl('http://user:pass@127.0.0.1:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => browserLaunchOptions(''), /LOOPBACK_PROXY_REQUIRED/);
  assert.throws(() => createCaptureService({
    externalProxyUrl: 'http://127.0.0.1:7890'
  }), /EXTERNAL_BROWSER_PROXY_UNSUPPORTED/);
  assert.equal(
    launchOptions.args.includes('--no-sandbox'),
    false
  );
});

test('rejects error pages before storing a source screenshot', () => {
  assert.doesNotThrow(() => assertRenderableResponse({ status: () => 200 }));
  assert.throws(() => assertRenderableResponse({ status: () => 403 }), /UPSTREAM_HTTP_403/);
  assert.throws(() => assertRenderableResponse({ status: () => 500 }), /UPSTREAM_HTTP_500/);
  assert.throws(() => assertRenderableResponse(null), /NO_DOCUMENT_RESPONSE/);
});

test('classifies cloud file deletion outcomes per file and keeps uncertain files retryable', async () => {
  const fileIds = [`${FILE_ID_PREFIX}old-1.jpg`, `${FILE_ID_PREFIX}old-2.jpg`];
  const successful = createCloudFileDeleter({
    deleteFile: async ({ fileList }) => ({ fileList: fileList.map((fileID) => ({ fileID, code: 'SUCCESS' })) })
  });
  assert.deepEqual(await successful(fileIds), {
    deletedFileIds: fileIds,
    retryFileIds: [],
    uncertain: false
  });

  const partial = createCloudFileDeleter({
    deleteFile: async () => ({
      fileList: [{ fileID: fileIds[0], status: 0 }, { fileID: fileIds[1], code: 'TEMPORARY_FAILURE' }]
    })
  });
  assert.deepEqual(await partial(fileIds), {
    deletedFileIds: [fileIds[0]],
    retryFileIds: [fileIds[1]],
    uncertain: true
  });

  const unavailable = createCloudFileDeleter({
    deleteFile: async () => { throw new Error('network unavailable'); }
  });
  assert.deepEqual(await unavailable(fileIds), {
    deletedFileIds: [],
    retryFileIds: fileIds,
    uncertain: true
  });
});

test('renders, stores and safely replaces source preview screenshots behind the maintenance boundary', async () => {
  const cache = {
    items: [{
      id: 'item0001',
      url: 'https://public.example/article',
      coverFileId: '',
      coverStatus: 'missing',
      previewFileIds: []
    }]
  };
  let updatedItems = null;
  let queuedVisualDeletes = [];
  const repository = {
    get: async () => cache,
    patchItems: async (patches, updatedAt, visualDeletes) => {
      const patchById = new Map(patches.map((entry) => [entry.id, entry]));
      const appliedIds = [];
      updatedItems = cache.items.map((item) => {
        const patch = patchById.get(item.id);
        if (!patch || (patch.expectedUrl && patch.expectedUrl !== item.url)) return item;
        appliedIds.push(item.id);
        return { ...item, ...patch.fields };
      });
      cache.items = updatedItems;
      queuedVisualDeletes = visualDeletes || [];
      return { items: updatedItems, appliedIds, pendingVisualDeletes: queuedVisualDeletes };
    }
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const service = createPreviewService({
    cloud: {
      getWXContext: () => ({}),
      uploadFile: async ({ cloudPath, fileContent }) => {
        assert.equal(fileContent.equals(jpeg), true);
        return { fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}` };
      }
    },
    repository,
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 's'.repeat(40),
      maintenanceToken: 'm'.repeat(40),
      rendererTimeoutMs: 1000,
      retryMs: 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 3,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://renderer.example/capture');
      assert.equal(options.headers.authorization, `Bearer ${'s'.repeat(40)}`);
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 1,
          segmentCount: 1,
          screenshots: [{ mimeType: 'image/jpeg', data: jpeg.toString('base64') }]
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    },
    now: () => new Date('2026-07-16T06:00:00.000Z')
  });

  const result = await service.hydratePreviews(1, false, 'm'.repeat(40));
  assert.equal(result.resolved, 1);
  assert.equal(result.totalWithVisuals, 1);
  assert.equal(updatedItems[0].previewStatus, 'ready');
  assert.equal(updatedItems[0].previewFileIds.length, 1);

  const activeFileId = updatedItems[0].previewFileIds[0];
  assert.match(activeFileId, new RegExp(`item0001-${visualVersion(cache.items[0].url)}-[a-f0-9]{12}-1\\.jpg$`));
  const staleFileIds = [
    `${FILE_ID_PREFIX}item0001-${visualVersion(cache.items[0].url)}-legacy-2.jpg`,
    `${FILE_ID_PREFIX}item0001-${visualVersion(cache.items[0].url)}-legacy-3.jpg`
  ];
  cache.items[0].previewFileIds = [activeFileId, ...staleFileIds];
  const rebuilt = await service.hydratePreview('item0001', true, 'm'.repeat(40));
  assert.equal(rebuilt.status, 'ready');
  assert.equal(rebuilt.previewFileIds.length, 1);
  assert.notEqual(rebuilt.previewFileIds[0], activeFileId);
  assert.deepEqual(queuedVisualDeletes, [activeFileId, ...staleFileIds]);

  let stored = {
    items: [{ id: 'item0001', previewFileIds: [activeFileId] }],
    pendingVisualDeletes: [`${FILE_ID_PREFIX}already-pending.jpg`]
  };
  const reference = {
    get: async () => ({ data: stored }),
    update: async ({ data }) => { stored = { ...stored, ...data }; }
  };
  const persistentRepository = createFeedCacheRepository({
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: () => reference })
    })
  }, { collectionName: 'feed', documentId: 'public' });
  await persistentRepository.patchItems([], new Date('2026-07-16T06:01:00.000Z'), [
    staleFileIds[0],
    activeFileId
  ]);
  assert.deepEqual(stored.pendingVisualDeletes, [
    `${FILE_ID_PREFIX}already-pending.jpg`,
    staleFileIds[0]
  ]);

  const staleUpload = `${FILE_ID_PREFIX}item0001-${visualVersion('https://old.example/article')}-1.jpg`;
  stored = {
    items: [{
      id: 'item0001',
      url: 'https://new.example/article',
      previewFileIds: []
    }],
    pendingVisualDeletes: []
  };
  const stalePatch = await persistentRepository.patchItems([{
    id: 'item0001',
    expectedUrl: 'https://old.example/article',
    discardFileIds: [staleUpload],
    fields: { previewFileIds: [staleUpload], previewStatus: 'ready' }
  }], new Date('2026-07-16T06:02:00.000Z'));
  assert.deepEqual(stalePatch.appliedIds, []);
  assert.deepEqual(stored.items[0].previewFileIds, []);
  assert.deepEqual(stored.pendingVisualDeletes, [staleUpload]);

  const sameUrl = 'https://public.example/concurrent';
  const visualA = `${FILE_ID_PREFIX}concurrent-a.jpg`;
  const visualB = `${FILE_ID_PREFIX}concurrent-b.jpg`;
  const visualC = `${FILE_ID_PREFIX}concurrent-c.jpg`;
  stored = {
    items: [{
      id: 'item0001',
      url: sameUrl,
      previewFileIds: [visualA]
    }],
    pendingVisualDeletes: [],
    visualDeleteClaims: []
  };
  await persistentRepository.patchItems([{
    id: 'item0001',
    expectedUrl: sameUrl,
    discardFileIds: [visualB],
    fields: { previewFileIds: [visualB], previewStatus: 'ready' }
  }], new Date('2026-07-16T06:03:00.000Z'));
  await persistentRepository.patchItems([{
    id: 'item0001',
    expectedUrl: sameUrl,
    discardFileIds: [visualC],
    fields: { previewFileIds: [visualC], previewStatus: 'ready' }
  }], new Date('2026-07-16T06:04:00.000Z'));
  assert.deepEqual(stored.items[0].previewFileIds, [visualC]);
  assert.deepEqual(stored.pendingVisualDeletes.sort(), [visualA, visualB].sort());

  const claimed = await persistentRepository.claimVisualDeletes(
    [visualB],
    new Date('2026-07-16T06:05:00.000Z')
  );
  assert.deepEqual(claimed, [visualB]);
  assert.equal(stored.pendingVisualDeletes.includes(visualB), false);
  assert.deepEqual(stored.visualDeleteClaims, [visualB]);
  const reactivation = await persistentRepository.patchItems([{
    id: 'item0001',
    expectedUrl: sameUrl,
    fields: { previewFileIds: [visualB], previewStatus: 'ready' }
  }], new Date('2026-07-16T06:06:00.000Z'));
  assert.deepEqual(reactivation.appliedIds, []);
  assert.deepEqual(stored.items[0].previewFileIds, [visualC]);
  await persistentRepository.acknowledgeVisualDeletes(
    [visualB],
    new Date('2026-07-16T06:07:00.000Z')
  );
  assert.deepEqual(stored.visualDeleteClaims, []);
});

test('stores every renderer segment when a long source returns more than three screenshots', async () => {
  const item = {
    id: 'longpage1',
    url: 'https://public.example/long-article',
    coverFileId: '',
    coverStatus: 'missing',
    previewFileIds: []
  };
  const cache = { items: [item] };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  let requestBody = null;
  const service = createPreviewService({
    cloud: {
      uploadFile: async ({ cloudPath }) => ({
        fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}`
      })
    },
    repository: {
      get: async () => cache,
      patchItems: async (patches) => {
        cache.items = cache.items.map((entry) => entry.id === patches[0].id
          ? { ...entry, ...patches[0].fields }
          : entry);
        return { items: cache.items, appliedIds: [patches[0].id] };
      }
    },
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: 'm'.repeat(40),
      rendererTimeoutMs: 1000,
      retryMs: 1000,
      maxResponseBytes: 100000,
      maxImageBytes: 1000,
      maxSegments: 12,
      captureVersion: 2,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 2,
          segmentCount: 5,
          screenshots: Array.from({ length: 5 }, () => ({ data: jpeg.toString('base64') }))
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    }
  });

  const result = await service.hydratePreviews(1, false, 'm'.repeat(40));
  assert.equal(result.resolved, 1);
  assert.equal(cache.items[0].previewFileIds.length, 5);
  assert.equal(cache.items[0].previewCaptureVersion, 2);
  assert.equal(requestBody.maxSegments, 12);
});

test('rejects an old renderer contract without replacing existing screenshots', async () => {
  const oldFileId = `${FILE_ID_PREFIX}existing-v1.jpg`;
  const cache = {
    items: [{
      id: 'contract1',
      url: 'https://public.example/article',
      coverFileId: '',
      coverStatus: 'missing',
      previewFileIds: [oldFileId],
      previewCaptureVersion: 1
    }]
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const service = createPreviewService({
    cloud: {
      uploadFile: async () => { throw new Error('old renderer output must not upload'); }
    },
    repository: {
      get: async () => cache,
      patchItems: async (patches) => {
        cache.items = cache.items.map((entry) => ({ ...entry, ...patches[0].fields }));
        return { items: cache.items, appliedIds: ['contract1'] };
      }
    },
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: 'm'.repeat(40),
      rendererTimeoutMs: 1000,
      retryMs: 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 12,
      captureVersion: 2,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async () => {
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 1,
          segmentCount: 1,
          screenshots: [{ data: jpeg.toString('base64') }]
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    },
    logger: { warn() {} }
  });

  const result = await service.hydratePreview('contract1', true, 'm'.repeat(40));
  assert.equal(result.status, 'stale');
  assert.deepEqual(result.previewFileIds, [oldFileId]);
  assert.equal(cache.items[0].previewCaptureVersion, 1);
});

test('journals uploaded screenshots before the database publication transaction', async () => {
  const cache = {
    items: [{
      id: 'journal01',
      url: 'https://public.example/article',
      coverFileId: '',
      coverStatus: 'missing',
      previewFileIds: []
    }]
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const journal = [];
  const deleted = [];
  const service = createPreviewService({
    cloud: {
      uploadFile: async ({ cloudPath }) => ({
        fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}`
      }),
      deleteFile: async ({ fileList }) => { deleted.push(...fileList); }
    },
    repository: {
      get: async () => cache,
      queueVisualDeletes: async (fileIds) => { journal.push(...fileIds); },
      patchItems: async () => { throw new Error('DB_PUBLICATION_FAILED'); }
    },
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: 'm'.repeat(40),
      rendererTimeoutMs: 1000,
      retryMs: 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 12,
      captureVersion: 2,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async () => {
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 2,
          segmentCount: 1,
          screenshots: [{ data: jpeg.toString('base64') }]
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    }
  });

  await assert.rejects(
    () => service.hydratePreviews(1, false, 'm'.repeat(40)),
    /DB_PUBLICATION_FAILED/
  );
  assert.equal(journal.length, 1);
  assert.equal(journal[0].startsWith(FILE_ID_PREFIX), true);
  assert.deepEqual(deleted, []);
});

test('prioritizes an untried preview over an expired failed item', async () => {
  const token = 'm'.repeat(40);
  const freshFailure = {
    id: 'failed001',
    url: 'https://failed.example/article',
    coverFileId: '',
    coverStatus: 'missing',
    previewFileIds: [],
    previewStatus: 'failed',
    previewCheckedAt: new Date('2026-07-16T05:00:00.000Z')
  };
  const untried = {
    id: 'untried01',
    url: 'https://public.example/new-article',
    coverFileId: '',
    coverStatus: 'missing',
    previewFileIds: []
  };
  const cache = { items: [freshFailure, untried] };
  let uploadedPath = '';
  const repository = {
    get: async () => cache,
    patchItems: async (patches) => {
      const patch = patches[0];
      cache.items = cache.items.map((item) => item.id === patch.id
        ? { ...item, ...patch.fields }
        : item);
      return { items: cache.items, appliedIds: [patch.id], pendingVisualDeletes: [] };
    }
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const service = createPreviewService({
    cloud: {
      uploadFile: async ({ cloudPath }) => {
        uploadedPath = cloudPath;
        return { fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}` };
      },
      deleteFile: async () => ({ fileList: [] })
    },
    repository,
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 's'.repeat(40),
      maintenanceToken: token,
      rendererTimeoutMs: 1000,
      retryMs: 30 * 60 * 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 3,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async () => {
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 1,
          segmentCount: 1,
          screenshots: [{ data: jpeg.toString('base64') }]
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    },
    now: () => new Date('2026-07-16T06:00:00.000Z')
  });

  const result = await service.hydratePreviews(1, false, token);
  assert.equal(result.resolved, 1);
  assert.match(uploadedPath, /untried01-/);
  assert.equal(cache.items[0].previewStatus, 'failed');
  assert.equal(cache.items[1].previewStatus, 'ready');
});

test('backs failed previews off exponentially and clears retry state after success', async () => {
  const token = 'm'.repeat(40);
  let clock = new Date('2026-07-16T06:00:00.000Z');
  let rendererCalls = 0;
  const cache = {
    items: [{
      id: 'retry001',
      url: 'https://public.example/retry',
      coverFileId: '',
      coverStatus: 'missing',
      previewFileIds: []
    }]
  };
  const repository = {
    get: async () => cache,
    patchItems: async (patches) => {
      const patch = patches[0];
      cache.items = cache.items.map((item) => item.id === patch.id
        ? { ...item, ...patch.fields }
        : item);
      return { items: cache.items, appliedIds: [patch.id], pendingVisualDeletes: [] };
    }
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const service = createPreviewService({
    cloud: {
      uploadFile: async ({ cloudPath }) => ({
        fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}`
      }),
      deleteFile: async () => ({ fileList: [] })
    },
    repository,
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: token,
      rendererTimeoutMs: 1000,
      retryMs: 5 * 60 * 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 12,
      captureVersion: 2,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async () => {
      rendererCalls += 1;
      if (rendererCalls <= 2) {
        return { ok: false, status: 503, headers: { get: () => null } };
      }
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 2,
          segmentCount: 1,
          screenshots: [{ data: jpeg.toString('base64') }]
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    },
    now: () => new Date(clock),
    logger: { warn() {} }
  });

  assert.equal(previewRetryDelay(1, 5 * 60 * 1000), 5 * 60 * 1000);
  assert.equal(previewRetryDelay(2, 5 * 60 * 1000), 15 * 60 * 1000);

  const first = await service.hydratePreviews(1, false, token);
  assert.equal(first.failed, 1);
  assert.equal(cache.items[0].previewAttempts, 1);
  assert.equal(cache.items[0].previewLastErrorCode, 'PREVIEW_HTTP_503');
  assert.equal(cache.items[0].previewNextAttemptAt.toISOString(), '2026-07-16T06:05:00.000Z');
  assert.equal(previewAttemptIsDue(cache.items[0], clock, 5 * 60 * 1000, 2), false);

  const deferred = await service.hydratePreviews(1, false, token);
  assert.equal(deferred.attempted, 0);
  assert.equal(rendererCalls, 1);

  clock = new Date('2026-07-16T06:05:00.000Z');
  await service.hydratePreviews(1, false, token);
  assert.equal(cache.items[0].previewAttempts, 2);
  assert.equal(cache.items[0].previewNextAttemptAt.toISOString(), '2026-07-16T06:20:00.000Z');
  assert.equal(rendererCalls, 2);

  clock = new Date('2026-07-16T06:20:00.000Z');
  const recovered = await service.hydratePreviews(1, false, token);
  assert.equal(recovered.resolved, 1);
  assert.equal(rendererCalls, 3);
  assert.equal(cache.items[0].previewStatus, 'ready');
  assert.equal(cache.items[0].previewAttempts, 0);
  assert.equal(cache.items[0].previewNextAttemptAt, null);
  assert.equal(cache.items[0].previewLastErrorCode, '');
});

test('retry-only maintenance ignores untried and legacy-ready previews', async () => {
  const token = 'm'.repeat(40);
  const cache = {
    items: [
      {
        id: 'untried01',
        url: 'https://public.example/untried',
        coverFileId: '',
        coverStatus: 'missing',
        previewFileIds: []
      },
      {
        id: 'legacy001',
        url: 'https://public.example/legacy',
        coverFileId: '',
        coverStatus: 'missing',
        previewFileIds: [`${FILE_ID_PREFIX}legacy-v1.jpg`],
        previewCaptureVersion: 1,
        previewStatus: 'ready',
        previewCheckedAt: new Date('2026-07-16T04:00:00.000Z')
      },
      {
        id: 'failed001',
        url: 'https://public.example/failed',
        coverFileId: '',
        coverStatus: 'missing',
        previewFileIds: [],
        previewStatus: 'failed',
        previewAttempts: 2,
        previewCheckedAt: new Date('2026-07-16T05:00:00.000Z'),
        previewNextAttemptAt: new Date('2026-07-16T05:15:00.000Z')
      }
    ]
  };
  let uploadedPath = '';
  const repository = {
    get: async () => cache,
    patchItems: async (patches) => {
      const patch = patches[0];
      cache.items = cache.items.map((item) => item.id === patch.id
        ? { ...item, ...patch.fields }
        : item);
      return { items: cache.items, appliedIds: [patch.id], pendingVisualDeletes: [] };
    }
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const service = createPreviewService({
    cloud: {
      uploadFile: async ({ cloudPath }) => {
        uploadedPath = cloudPath;
        return { fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}` };
      },
      deleteFile: async () => ({ fileList: [] })
    },
    repository,
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: token,
      rendererTimeoutMs: 1000,
      retryMs: 5 * 60 * 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 12,
      captureVersion: 2,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async () => {
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: {
          captureVersion: 2,
          segmentCount: 1,
          screenshots: [{ data: jpeg.toString('base64') }]
        }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    },
    now: () => new Date('2026-07-16T06:00:00.000Z')
  });

  const result = await service.hydratePreviews(1, false, token, { retryOnly: true });
  assert.equal(result.resolved, 1);
  assert.match(uploadedPath, /failed001-/);
  assert.equal(cache.items[0].previewCheckedAt, undefined);
  assert.equal(cache.items[1].previewCaptureVersion, 1);
  assert.equal(cache.items[2].previewStatus, 'ready');
});

test('does not expose preview maintenance without its independent secret', async () => {
  const service = createPreviewService({
    cloud: { getWXContext: () => ({ OPENID: 'user-openid' }) },
    repository: { get: async () => null },
    config: { rendererUrl: '', rendererToken: '', maintenanceToken: 'm'.repeat(40) }
  });
  await assert.rejects(() => service.hydratePreviews(1, false, ''), { code: 'TEMPORARY_FAILURE' });
});

test('requires a separate constant-time token for preview maintenance', async () => {
  const token = 'm'.repeat(40);
  assert.equal(maintenanceAuthorized(token, token), true);
  assert.equal(maintenanceAuthorized('x'.repeat(40), token), false);
  const service = createPreviewService({
    cloud: { getWXContext: () => ({}) },
    repository: { get: async () => ({ items: [] }) },
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: token
    }
  });
  await assert.rejects(() => service.hydratePreviews(1, false, 'wrong'), { code: 'TEMPORARY_FAILURE' });
});

test('lists failed previews only behind the maintenance token', async () => {
  const token = 'm'.repeat(40);
  const service = createPreviewService({
    cloud: { getWXContext: () => ({}) },
    repository: {
      get: async () => ({
        items: [
          { id: 'failed001', title: 'Failed', url: 'https://failed.example', previewStatus: 'failed' },
          { id: 'ready0001', title: 'Ready', url: 'https://ready.example', previewStatus: 'ready' }
        ]
      })
    },
    config: { maintenanceToken: token }
  });
  await assert.rejects(() => service.listPreviewFailures('wrong'), { code: 'TEMPORARY_FAILURE' });
  assert.deepEqual(await service.listPreviewFailures(token), [{
    id: 'failed001',
    title: 'Failed',
    url: 'https://failed.example',
    previewCheckedAt: undefined,
    previewAttempts: 0,
    previewNextAttemptAt: null,
    previewLastErrorCode: ''
  }]);
});

test('reports visual and cleanup coverage without exposing the maintenance endpoint publicly', async () => {
  const token = 'm'.repeat(40);
  const service = createPreviewService({
    cloud: { getWXContext: () => ({}) },
    repository: {
      get: async () => ({
        items: [
          { id: 'cover001', coverFileId: `${FILE_ID_PREFIX}cover001.jpg` },
          { id: 'preview1', previewFileIds: [`${FILE_ID_PREFIX}preview1-1.jpg`] }
        ],
        pendingVisualDeletes: [`${FILE_ID_PREFIX}old-1.jpg`]
      })
    },
    config: { maintenanceToken: token }
  });
  await assert.rejects(() => service.maintenanceStatus('wrong'), { code: 'TEMPORARY_FAILURE' });
  const status = await service.maintenanceStatus(token);
  assert.equal(status.totalItems, 2);
  assert.equal(status.totalWithVisuals, 2);
  assert.equal(status.pendingPublication, 0);
  assert.equal(status.totalWithOriginalCovers, 1);
  assert.equal(status.totalWithSourcePreviews, 1);
  assert.equal(status.pendingVisualDeletes, 1);
  assert.equal(status.claimedVisualDeletes, 0);
});
