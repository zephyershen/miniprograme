const {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  segmentLimit
} = require('./capture-plan.js');

const MAX_IMAGE_BYTES = 1.25 * 1024 * 1024;

async function pageMetrics(page) {
  return page.evaluate(() => ({
    height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    title: document.title || ''
  }));
}

async function capturePageSegments(page, requestedSegments = DEFAULT_MAX_SEGMENTS) {
  const limit = segmentLimit(requestedSegments);
  const screenshots = [];
  const scrollPositions = [];
  let metrics = await pageMetrics(page);
  let reachedBottom = false;

  for (let index = 0; index < limit; index += 1) {
    const pageHeightBeforeScroll = Math.max(VIEWPORT.height, Number(metrics.height) || VIEWPORT.height);
    const scrollY = Math.min(index * VIEWPORT.height, Math.max(0, pageHeightBeforeScroll - VIEWPORT.height));
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(300);
    metrics = await pageMetrics(page);
    const pageHeight = Math.max(VIEWPORT.height, Number(metrics.height) || VIEWPORT.height);
    const buffer = await page.screenshot({ type: 'jpeg', quality: 68, animations: 'disabled', caret: 'hide' });
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('SCREENSHOT_TOO_LARGE');
    screenshots.push({
      mimeType: 'image/jpeg',
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      data: buffer.toString('base64')
    });
    scrollPositions.push(scrollY);
    reachedBottom = scrollY + VIEWPORT.height >= pageHeight;
    if (reachedBottom) break;
  }

  return {
    pageHeight: Math.max(VIEWPORT.height, Number(metrics.height) || VIEWPORT.height),
    segmentCount: screenshots.length,
    truncated: !reachedBottom,
    scrollPositions,
    screenshots
  };
}

module.exports = { MAX_IMAGE_BYTES, pageMetrics, capturePageSegments };
