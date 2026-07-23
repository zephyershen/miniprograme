const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PAGE_QUALITY_POLICY_VERSION,
  assessPageSnapshot,
  assertAcceptedPageQuality,
  runWithSingleQualityReload
} = require('../cloudrun/source-preview-renderer/src/page-quality');
const {
  CAPTURE_VERSION,
  captureFocusedOrPage,
  createCaptureService
} = require('../cloudrun/source-preview-renderer/src/capture');

const X_STATUS_URL = 'https://x.com/example/status/2079343753719128505';

function snapshot(overrides = {}) {
  return {
    title: '',
    text: '',
    actionText: '',
    targetMatched: false,
    primaryContentCount: 0,
    meaningfulImageCount: 0,
    ...overrides
  };
}

test('rejects the HTTP 200 X error shell shown by the failed consultation screenshot', () => {
  const quality = assessPageSnapshot(snapshot({
    text: 'Something went wrong Try reloading. If the problem persists, please try again later.',
    actionText: 'Refresh Try again',
    targetMatched: true,
    primaryContentCount: 1
  }), X_STATUS_URL);

  assert.equal(quality.verdict, 'retry');
  assert.equal(quality.reasonCode, 'ERROR_SHELL');
  assert.equal(quality.targetMatched, true);
});

test('rejects login walls, browser challenges and blank documents', () => {
  assert.equal(assessPageSnapshot(snapshot({
    text: 'Log in to continue. New here? Sign up or create account.',
    primaryContentCount: 1
  }), 'https://example.com/article').reasonCode, 'LOGIN_WALL');
  assert.equal(assessPageSnapshot(snapshot({
    title: 'Just a moment...',
    text: 'Checking your browser before accessing the site. Verify you are human.',
    primaryContentCount: 1
  }), 'https://example.com/article').reasonCode, 'CHALLENGE_PAGE');
  assert.equal(assessPageSnapshot(snapshot(), 'https://example.com/article').reasonCode, 'BLANK_PAGE');
});

test('rejects browser-generated load failures even when they return a document', () => {
  const quality = assessPageSnapshot(snapshot({
    text: "This page couldn’t load. Reload to try again, or go back.",
    actionText: 'Reload Back'
  }), 'https://example.com/article');
  assert.equal(quality.verdict, 'retry');
  assert.equal(quality.reasonCode, 'ERROR_SHELL');
});

test('requires an exact target status even when another article is present', () => {
  const quality = assessPageSnapshot(snapshot({
    text: 'A different rendered status with enough text to look like meaningful page content.',
    primaryContentCount: 1,
    meaningfulImageCount: 1,
    targetMatched: false
  }), X_STATUS_URL);

  assert.equal(quality.verdict, 'retry');
  assert.equal(quality.reasonCode, 'TARGET_STATUS_NOT_FOUND');
});

test('fast-tracks only an exactly matched X status and marks generic documents for review', () => {
  const target = assessPageSnapshot(snapshot({
    text: 'The exact target status',
    primaryContentCount: 1,
    targetMatched: true
  }), X_STATUS_URL);
  assert.deepEqual(target, {
    policyVersion: PAGE_QUALITY_POLICY_VERSION,
    verdict: 'accept',
    targetMatched: true,
    reviewRequired: false,
    reasonCode: 'TARGET_STATUS_MATCHED'
  });

  const generic = assessPageSnapshot(snapshot({
    text: 'A complete article body with a semantic main content region.',
    primaryContentCount: 1
  }), 'https://example.com/article');
  assert.equal(generic.verdict, 'accept');
  assert.equal(generic.targetMatched, false);
  assert.equal(generic.reviewRequired, true);
  assert.equal(generic.reasonCode, 'PRIMARY_CONTENT_READY');
});

test('allows one bounded reload after a quality failure and then succeeds', async () => {
  const attempts = [];
  const result = await runWithSingleQualityReload(async ({ attempt, reload }) => {
    attempts.push({ attempt, reload });
    const quality = attempt === 0
      ? assessPageSnapshot(snapshot(), 'https://example.com/article')
      : assessPageSnapshot(snapshot({ primaryContentCount: 1 }), 'https://example.com/article');
    return assertAcceptedPageQuality(quality);
  });

  assert.deepEqual(attempts, [
    { attempt: 0, reload: false },
    { attempt: 1, reload: true }
  ]);
  assert.equal(result.verdict, 'accept');
});

test('never reloads more than once and does not retry unrelated failures', async () => {
  let qualityAttempts = 0;
  await assert.rejects(() => runWithSingleQualityReload(async () => {
    qualityAttempts += 1;
    return assertAcceptedPageQuality(assessPageSnapshot(snapshot(), 'https://example.com/article'));
  }), (error) => error.code === 'PAGE_QUALITY_REJECTED');
  assert.equal(qualityAttempts, 2);

  let unrelatedAttempts = 0;
  await assert.rejects(() => runWithSingleQualityReload(async () => {
    unrelatedAttempts += 1;
    throw new Error('BROWSER_CLOSED');
  }), /BROWSER_CLOSED/);
  assert.equal(unrelatedAttempts, 1);
});

test('retries transient navigation and upstream 5xx failures but not 4xx, SSRF or aborts', async () => {
  for (const transient of [
    new Error('UPSTREAM_HTTP_503'),
    new Error('page.goto: net::ERR_CONNECTION_RESET'),
    new Error('Navigation timeout of 16000 ms exceeded')
  ]) {
    let attempts = 0;
    const result = await runWithSingleQualityReload(async () => {
      attempts += 1;
      if (attempts === 1) throw transient;
      return 'recovered';
    });
    assert.equal(result, 'recovered');
    assert.equal(attempts, 2);
  }

  const abort = new Error('The operation was aborted');
  abort.name = 'AbortError';
  for (const permanent of [new Error('UPSTREAM_HTTP_403'), new Error('PRIVATE_HOST'), abort]) {
    let attempts = 0;
    await assert.rejects(() => runWithSingleQualityReload(async () => {
      attempts += 1;
      throw permanent;
    }));
    assert.equal(attempts, 1);
  }
});

test('forbids whole-page fallback when an exact target crop is unavailable', async () => {
  let pageCaptureCalls = 0;
  await assert.rejects(() => captureFocusedOrPage(
    {},
    null,
    12,
    async () => null,
    async () => {
      pageCaptureCalls += 1;
      return { screenshots: [{}] };
    },
    { allowPageFallback: false }
  ), (error) => error.code === 'PAGE_QUALITY_REJECTED'
    && error.reasonCode === 'TARGET_CAPTURE_UNAVAILABLE');
  assert.equal(pageCaptureCalls, 0);
});

test('publishes the renderer quality proof under capture contract version 3', () => {
  assert.equal(PAGE_QUALITY_POLICY_VERSION, 1);
  assert.equal(CAPTURE_VERSION, 3);
});

test('reloads an HTTP 200 error shell once and returns proof for the accepted screenshot bytes', async () => {
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  let qualityReads = 0;
  let reloads = 0;
  let contextClosed = false;
  let browserClosed = false;
  const setupOrder = [];
  const response = { status: () => 200 };
  const page = {
    setDefaultNavigationTimeout() {},
    setDefaultTimeout() {},
    route: async () => {},
    goto: async () => response,
    reload: async () => {
      reloads += 1;
      return response;
    },
    waitForSelector: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    url: () => 'https://example.com/article',
    screenshot: async () => {
      assert.equal(contextClosed, false);
      return jpeg;
    },
    evaluate: async (operation, value) => {
      const source = String(operation);
      if (source.includes('primarySelectors')) {
        qualityReads += 1;
        return qualityReads === 1
          ? snapshot({
            text: 'Something went wrong. Try reloading.',
            actionText: 'Refresh Try again'
          })
          : snapshot({
            title: 'Useful article',
            text: 'A complete article body rendered inside the main content region.',
            primaryContentCount: 1
          });
      }
      if (source.includes('document.documentElement.scrollHeight')) {
        return { height: 1350, title: 'Useful article' };
      }
      if (typeof value === 'number') return undefined;
      return undefined;
    }
  };
  const context = {
    route: async () => { setupOrder.push('http-route'); },
    routeWebSocket: async () => { setupOrder.push('websocket-route'); },
    newPage: async () => {
      setupOrder.push('page');
      return page;
    },
    close: async () => { contextClosed = true; }
  };
  const browser = {
    once() {},
    newContext: async () => context,
    close: async () => { browserClosed = true; }
  };
  const service = createCaptureService({
    launch: async () => browser,
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

  const result = await service.capture('https://example.com/article', 1, undefined, 'page');
  assert.equal(reloads, 1);
  assert.equal(contextClosed, true);
  assert.deepEqual(setupOrder, ['http-route', 'websocket-route', 'page']);
  assert.equal(result.captureVersion, 3);
  assert.deepEqual(result.quality, {
    policyVersion: 1,
    verdict: 'accept',
    targetMatched: false,
    reviewRequired: true,
    reasonCode: 'PRIMARY_CONTENT_READY'
  });
  assert.equal(result.screenshots.length, 1);

  await service.close();
  assert.equal(browserClosed, true);
});
