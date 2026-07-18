const { chromium } = require('playwright');
const { createPublicUrlGuard } = require('./network-security.js');
const { assertRenderableResponse } = require('./page-policy.js');
const { browserLaunchOptions } = require('./proxy.js');
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
const {
  LIST_THUMBNAIL_VERSION,
  renderListThumbnail
} = require('./list-thumbnail.js');
const NAVIGATION_TIMEOUT_MS = 16000;

function createCaptureService({
  launch = (options) => chromium.launch(options),
  guard = createPublicUrlGuard(),
  proxyUrl = process.env.PLAYWRIGHT_PROXY_URL || '',
  allowDirectEgress = process.env.ALLOW_DIRECT_EGRESS === 'true'
} = {}) {
  let browserPromise = null;
  const launchOptions = browserLaunchOptions(proxyUrl, { allowDirectEgress });

  function getBrowser() {
    if (!browserPromise) {
      const pending = launch(launchOptions)
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
    return browserPromise;
  }

  async function capture(url, requestedSegments = DEFAULT_MAX_SEGMENTS, signal, requestedProfile = 'page') {
    const targetUrl = await guard.assertPublicUrl(url);
    const profile = normalizeCaptureProfile(requestedProfile);
    const browser = await getBrowser();
    let context = null;
    const abortCapture = () => context && context.close().catch(() => {});
    try {
      context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        serviceWorkers: 'block',
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
      });
      if (signal) {
        if (signal.aborted) await abortCapture();
        else signal.addEventListener('abort', abortCapture, { once: true });
      }
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      page.setDefaultTimeout(5000);
      await page.route('**/*', async (route) => {
        const allowed = await guard.allowBrowserRequest(route.request().url());
        if (allowed) await route.continue();
        else await route.abort('blockedbyclient');
      });
      const navigationResponse = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      assertRenderableResponse(navigationResponse);
      if (profile === FOCUS_PROFILE && statusIdFromUrl(targetUrl)) {
        await page.waitForSelector('article', { timeout: 8000 }).catch(() => {});
      }
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
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

      const initialMetrics = await pageMetrics(page);
      let focus = null;
      let media = { total: 0, ready: 0, pending: 0 };
      let capture = null;
      if (profile === FOCUS_PROFILE) {
        focus = await selectFocusCandidate(page, targetUrl).catch(() => null);
        if (focus) {
          const stabilized = await stabilizeFocusedContent(page);
          media = stabilized.media;
          capture = await captureFocusedSegments(page, stabilized.box, requestedSegments);
        }
      }
      if (!capture) capture = await capturePageSegments(page, requestedSegments);

      return {
        finalUrl: page.url(),
        title: String(initialMetrics.title).slice(0, 240),
        captureVersion: CAPTURE_VERSION,
        pageHeight: capture.pageHeight,
        segmentCount: capture.segmentCount,
        truncated: capture.truncated,
        profile,
        focus: focus ? { kind: focus.kind, confidence: focus.confidence, score: focus.score } : null,
        media,
        screenshots: capture.screenshots
      };
    } finally {
      if (signal) signal.removeEventListener('abort', abortCapture);
      if (context) await context.close().catch(() => {});
    }
  }

  async function thumbnail(payload = {}, signal) {
    if (Number(payload.version || 0) !== LIST_THUMBNAIL_VERSION) {
      throw new Error('THUMBNAIL_VERSION_UNSUPPORTED');
    }
    const sourceUrl = await guard.assertPublicUrl(payload.url);
    return renderListThumbnail(await getBrowser(), sourceUrl, guard, signal);
  }

  async function close() {
    if (!browserPromise) return;
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) await browser.close();
  }

  return { capture, thumbnail, close };
}

module.exports = {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  HARD_MAX_SEGMENTS,
  CAPTURE_VERSION,
  createCapturePlan,
  normalizeCaptureProfile,
  createCaptureService
};
