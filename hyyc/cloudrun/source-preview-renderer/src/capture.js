const { chromium } = require('playwright');
const { createPublicUrlGuard } = require('./network-security.js');
const { assertRenderableResponse } = require('./page-policy.js');
const { browserLaunchOptions } = require('./proxy.js');

const VIEWPORT = Object.freeze({ width: 1080, height: 1350 });
const DEFAULT_MAX_SEGMENTS = 3;
const NAVIGATION_TIMEOUT_MS = 16000;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

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

  async function capture(url, requestedSegments = DEFAULT_MAX_SEGMENTS, signal) {
    const targetUrl = await guard.assertPublicUrl(url);
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

      const metrics = await page.evaluate(() => ({
        height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
        title: document.title || ''
      }));
      const maxSegments = Math.max(1, Math.min(DEFAULT_MAX_SEGMENTS, Number(requestedSegments) || DEFAULT_MAX_SEGMENTS));
      const segmentCount = Math.max(1, Math.min(maxSegments, Math.ceil(metrics.height / VIEWPORT.height)));
      const maxScroll = Math.max(0, metrics.height - VIEWPORT.height);
      const screenshots = [];

      for (let index = 0; index < segmentCount; index += 1) {
        const scrollY = segmentCount === 1 ? 0 : Math.round(maxScroll * index / Math.max(1, segmentCount - 1));
        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await page.waitForTimeout(300);
        const buffer = await page.screenshot({ type: 'jpeg', quality: 72, animations: 'disabled', caret: 'hide' });
        if (buffer.length > MAX_IMAGE_BYTES) throw new Error('SCREENSHOT_TOO_LARGE');
        screenshots.push({
          mimeType: 'image/jpeg',
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          data: buffer.toString('base64')
        });
      }

      return {
        finalUrl: page.url(),
        title: String(metrics.title).slice(0, 240),
        screenshots
      };
    } finally {
      if (signal) signal.removeEventListener('abort', abortCapture);
      if (context) await context.close().catch(() => {});
    }
  }

  async function close() {
    if (!browserPromise) return;
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) await browser.close();
  }

  return { capture, close };
}

module.exports = { VIEWPORT, createCaptureService };
