const { createPublicUrlGuard } = require('./network-security.js');
const { assertRenderableResponse } = require('./page-policy.js');
const { browserLaunchOptions } = require('./proxy.js');
const { launchBrowser } = require('./browser-runtime.js');
const { createFixedIpProxy } = require('./fixed-ip-proxy.js');
const { installGuardedContextRoutes } = require('./browser-network-policy.js');
const {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  HARD_MAX_SEGMENTS,
  CAPTURE_VERSION,
  createCapturePlan
} = require('./capture-plan.js');
const { pageMetrics, capturePageSegments } = require('./capture-segments.js');
const {
  FOCUS_PROFILE,
  normalizeCaptureProfile,
  statusIdFromUrl,
  selectFocusCandidate
} = require('./focus-policy.js');
const { stabilizeFocusedContent } = require('./media-stability.js');
const { captureFocusedSegments } = require('./capture-focused.js');
const { captureOpenGraphImage } = require('./open-graph-capture.js');
const {
  inspectPageQuality,
  assertAcceptedPageQuality,
  createPageQualityError,
  runWithSingleQualityReload
} = require('./page-quality.js');
const {
  LIST_THUMBNAIL_VERSION,
  renderListThumbnail
} = require('./list-thumbnail.js');
const NAVIGATION_TIMEOUT_MS = 16000;
const TARGET_ARTICLE_TIMEOUT_MS = 8000;
const NETWORK_IDLE_TIMEOUT_MS = 2500;

function isRecoverableFocusCaptureError(error) {
  const message = String(error && error.message || error || '');
  if (/abort|target closed|context closed|browser.*closed/i.test(message)) return false;
  return /clipped area is either empty or outside|invalid.*clip|page\.captureScreenshot|SCREENSHOT_TOO_LARGE/i
    .test(message);
}

function isBrowserLifecycleError(error) {
  return /target page, context or browser has been closed|target closed|context.*closed|browser.*closed/i
    .test(String(error && error.message || error || ''));
}

async function captureFocusedOrPage(
  page,
  box,
  requestedSegments,
  focusedCapture = captureFocusedSegments,
  pageCapture = capturePageSegments,
  { allowPageFallback = true } = {}
) {
  if (box) {
    try {
      const focused = await focusedCapture(page, box, requestedSegments);
      if (focused) return focused;
    } catch (error) {
      if (!isRecoverableFocusCaptureError(error)) throw error;
      if (!allowPageFallback) throw createPageQualityError('TARGET_CAPTURE_UNAVAILABLE');
    }
  }
  if (!allowPageFallback) throw createPageQualityError('TARGET_CAPTURE_UNAVAILABLE');
  return pageCapture(page, requestedSegments);
}

async function waitForPageReadiness(page, targetUrl) {
  if (statusIdFromUrl(targetUrl)) {
    await page.waitForSelector('article', { timeout: TARGET_ARTICLE_TIMEOUT_MS }).catch(() => {});
  }
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
}

async function removePageObstructions(page) {
  await page.evaluate(() => {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.cookie-banner',
      '.cookie-consent',
      '#cookie-banner',
      '#cookie-consent'
    ];
    for (const node of document.querySelectorAll(selectors.join(','))) node.remove();
    for (const node of document.querySelectorAll('body *')) {
      const style = window.getComputedStyle(node);
      if (style.position !== 'fixed') continue;
      const rect = node.getBoundingClientRect();
      const coversMostViewport = rect.width * rect.height > window.innerWidth * window.innerHeight * 0.35;
      if (coversMostViewport && Number(style.zIndex || 0) >= 10) node.remove();
    }
  }).catch(() => {});
}

async function captureDocumentAttempt(page, targetUrl, requestedSegments, profile, reload = false) {
  const currentUrl = typeof page.url === 'function' ? String(page.url() || '') : '';
  const canReload = reload && /^https:\/\//i.test(currentUrl);
  const navigationResponse = canReload
    ? await page.reload({ waitUntil: 'domcontentloaded' })
    : await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  assertRenderableResponse(navigationResponse);
  await waitForPageReadiness(page, targetUrl);
  assertAcceptedPageQuality(await inspectPageQuality(page, targetUrl));
  await removePageObstructions(page);

  const initialMetrics = await pageMetrics(page);
  const targetStatusId = statusIdFromUrl(targetUrl);
  const requiresExactTarget = Boolean(targetStatusId);
  const shouldFocus = profile === FOCUS_PROFILE || requiresExactTarget;
  let focus = null;
  let media = { total: 0, ready: 0, pending: 0 };
  let capture = null;

  if (shouldFocus) {
    focus = await selectFocusCandidate(page, targetUrl).catch((error) => {
      if (requiresExactTarget) throw createPageQualityError('TARGET_STATUS_NOT_FOUND');
      return null;
    });
    if (requiresExactTarget && (!focus || focus.targetMatched !== true)) {
      throw createPageQualityError('TARGET_STATUS_NOT_FOUND');
    }
    if (focus) {
      const stabilized = await stabilizeFocusedContent(page);
      media = stabilized.media;
      const preCaptureQuality = assertAcceptedPageQuality(await inspectPageQuality(page, targetUrl));
      if (requiresExactTarget && preCaptureQuality.targetMatched !== true) {
        throw createPageQualityError('TARGET_STATUS_NOT_FOUND');
      }
      // Generic pages retain the resilient whole-page fallback. An X status
      // must never turn a missing or stale target crop into an unrelated page.
      capture = await captureFocusedOrPage(
        page,
        stabilized.box,
        requestedSegments,
        captureFocusedSegments,
        capturePageSegments,
        { allowPageFallback: !requiresExactTarget }
      );
    }
  }

  if (!capture) {
    if (requiresExactTarget) throw createPageQualityError('TARGET_CAPTURE_UNAVAILABLE');
    assertAcceptedPageQuality(await inspectPageQuality(page, targetUrl));
    capture = await capturePageSegments(page, requestedSegments);
  }

  // Discard screenshots if a dynamic application replaced the accepted
  // document with an error shell while the segments were being captured.
  const quality = assertAcceptedPageQuality(await inspectPageQuality(page, targetUrl));
  return {
    finalUrl: page.url(),
    title: String(initialMetrics.title).slice(0, 240),
    captureVersion: CAPTURE_VERSION,
    pageHeight: capture.pageHeight,
    segmentCount: capture.segmentCount,
    truncated: capture.truncated,
    profile,
    focus: focus ? {
      kind: focus.kind,
      confidence: focus.confidence,
      score: focus.score,
      targetMatched: focus.targetMatched === true
    } : null,
    media,
    quality,
    screenshots: capture.screenshots
  };
}

function createCaptureService({
  launch = launchBrowser,
  guard = createPublicUrlGuard(),
  trustedProxyUrl = '',
  externalProxyUrl = process.env.PLAYWRIGHT_PROXY_URL || '',
  allowDirectEgress = process.env.ALLOW_DIRECT_EGRESS === 'true',
  fixedIpProxyFactory = createFixedIpProxy
} = {}) {
  let browserPromise = null;
  let guardedProxy = null;
  let launchOptionsPromise = null;
  let staticLaunchOptions = null;

  if (externalProxyUrl) {
    // A generic HTTP/SOCKS proxy may resolve attacker-controlled hostnames
    // again after validation. Only transports created by this process can be
    // trusted to pin the destination IP.
    throw new Error('EXTERNAL_BROWSER_PROXY_UNSUPPORTED');
  }
  if (trustedProxyUrl) {
    staticLaunchOptions = browserLaunchOptions(trustedProxyUrl);
  } else if (allowDirectEgress) {
    guardedProxy = fixedIpProxyFactory({
      resolvePublicHost: guard && guard.resolvePublicHost
    });
  } else {
    // Fail at service construction instead of during the first production
    // request when neither a local proxy nor the in-process guarded transport
    // has been enabled.
    staticLaunchOptions = browserLaunchOptions('');
  }

  async function resolveLaunchOptions() {
    if (staticLaunchOptions) return staticLaunchOptions;
    if (!launchOptionsPromise) {
      launchOptionsPromise = guardedProxy.listen()
        .then((localProxyUrl) => browserLaunchOptions(localProxyUrl))
        .catch((error) => {
          launchOptionsPromise = null;
          throw error;
        });
    }
    return launchOptionsPromise;
  }

  async function getBrowser() {
    if (browserPromise) {
      const cached = await browserPromise.catch(() => null);
      if (cached && (typeof cached.isConnected !== 'function' || cached.isConnected())) {
        return cached;
      }
      browserPromise = null;
    }
    if (!browserPromise) {
      const pending = resolveLaunchOptions()
        .then((launchOptions) => launch(launchOptions))
        .then((browser) => {
          browser.once('disconnected', () => {
            if (browserPromise === pending) browserPromise = null;
          });
          return browser;
        })
        .catch((error) => {
          if (browserPromise === pending) browserPromise = null;
          throw error;
        });
      browserPromise = pending;
    }
    return await browserPromise;
  }

  async function invalidateBrowser(expectedBrowser) {
    if (browserPromise) {
      const cached = await browserPromise.catch(() => null);
      if (!expectedBrowser || cached === expectedBrowser) browserPromise = null;
    }
    if (expectedBrowser && typeof expectedBrowser.close === 'function') {
      await expectedBrowser.close().catch(() => {});
    }
  }

  async function captureWithBrowser(
    browser,
    targetUrl,
    requestedSegments,
    signal,
    profile,
    { allowQualityReload = true } = {}
  ) {
    let context = null;
    const abortCapture = () => context && context.close().catch(() => {});
    try {
      context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        serviceWorkers: 'block',
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'
      });
      await installGuardedContextRoutes(context, guard);
      if (signal) {
        if (signal.aborted) await abortCapture();
        else signal.addEventListener('abort', abortCapture, { once: true });
      }
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      page.setDefaultTimeout(5000);
      const attemptCapture = ({ reload = false } = {}) => (
        captureDocumentAttempt(page, targetUrl, requestedSegments, profile, reload)
      );
      return allowQualityReload
        ? await runWithSingleQualityReload(attemptCapture)
        : await attemptCapture();
    } finally {
      if (signal) signal.removeEventListener('abort', abortCapture);
      if (context) await context.close().catch(() => {});
    }
  }

  async function capture(
    url,
    requestedSegments = DEFAULT_MAX_SEGMENTS,
    signal,
    requestedProfile = 'page',
    options = {}
  ) {
    const targetUrl = await guard.assertPublicUrl(url);
    const profile = normalizeCaptureProfile(requestedProfile);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const browser = await getBrowser();
      try {
        return await captureWithBrowser(
          browser,
          targetUrl,
          requestedSegments,
          signal,
          profile,
          options
        );
      } catch (error) {
        if (attempt > 0 || !isBrowserLifecycleError(error) || (signal && signal.aborted)) throw error;
        await invalidateBrowser(browser);
      }
    }
    throw new Error('BROWSER_RESTART_FAILED');
  }

  async function captureOpenGraph(url, signal) {
    const targetUrl = await guard.assertPublicUrl(url);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const browser = await getBrowser();
      let context = null;
      const abortCapture = () => context && context.close().catch(() => {});
      try {
        context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          locale: 'zh-CN',
          serviceWorkers: 'block',
          userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'
        });
        await installGuardedContextRoutes(context, guard);
        if (signal) {
          if (signal.aborted) await abortCapture();
          else signal.addEventListener('abort', abortCapture, { once: true });
        }
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
        page.setDefaultTimeout(5000);
        return await captureOpenGraphImage(page, targetUrl, guard);
      } catch (error) {
        if (attempt > 0 || !isBrowserLifecycleError(error) || (signal && signal.aborted)) throw error;
        await invalidateBrowser(browser);
      } finally {
        if (signal) signal.removeEventListener('abort', abortCapture);
        if (context) await context.close().catch(() => {});
      }
    }
    throw new Error('BROWSER_RESTART_FAILED');
  }

  async function thumbnail(payload = {}, signal) {
    if (Number(payload.version || 0) !== LIST_THUMBNAIL_VERSION) {
      throw new Error('THUMBNAIL_VERSION_UNSUPPORTED');
    }
    const sourceUrl = await guard.assertPublicUrl(payload.url);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const browser = await getBrowser();
      try {
        return await renderListThumbnail(browser, sourceUrl, guard, signal);
      } catch (error) {
        if (attempt > 0 || !isBrowserLifecycleError(error) || (signal && signal.aborted)) throw error;
        await invalidateBrowser(browser);
      }
    }
    throw new Error('BROWSER_RESTART_FAILED');
  }

  async function close() {
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      browserPromise = null;
      if (browser) await browser.close();
    }
    if (guardedProxy) await guardedProxy.close();
    launchOptionsPromise = null;
  }

  return { capture, captureOpenGraph, thumbnail, close };
}

module.exports = {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  HARD_MAX_SEGMENTS,
  CAPTURE_VERSION,
  createCapturePlan,
  normalizeCaptureProfile,
  isBrowserLifecycleError,
  isRecoverableFocusCaptureError,
  captureFocusedOrPage,
  waitForPageReadiness,
  removePageObstructions,
  captureDocumentAttempt,
  createCaptureService
};
