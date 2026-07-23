const { assertRenderableResponse } = require('./page-policy.js');
const { CAPTURE_VERSION } = require('./capture-plan.js');
const { MAX_IMAGE_BYTES } = require('./capture-segments.js');
const { PAGE_QUALITY_POLICY_VERSION } = require('./page-quality.js');

const OPEN_GRAPH_WAIT_MS = 8000;

function normalizeOpenGraphImageUrl(value, pageUrl) {
  try {
    const resolved = new URL(String(value || '').trim(), pageUrl);
    if (resolved.protocol !== 'https:' || resolved.username || resolved.password) return '';
    return resolved.toString();
  } catch (error) {
    return '';
  }
}

async function captureOpenGraphImage(page, targetUrl, guard) {
  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  assertRenderableResponse(response);
  const metadata = await page.evaluate(() => {
    const selectors = [
      'meta[property="og:image:secure_url"]',
      'meta[property="og:image"]',
      'meta[name="twitter:image"]'
    ];
    const image = selectors
      .map((selector) => document.querySelector(selector)?.getAttribute('content') || '')
      .find(Boolean) || '';
    return { image, title: document.title || '' };
  });
  const imageUrl = normalizeOpenGraphImageUrl(metadata.image, targetUrl);
  if (!imageUrl) throw new Error('OPEN_GRAPH_IMAGE_UNAVAILABLE');
  await guard.assertPublicUrl(imageUrl);
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:#fff}#source-image{display:block;width:900px;height:auto}
  </style></head><body><img id="source-image" alt=""></body></html>`);
  await page.locator('#source-image').evaluate((node, source) => {
    node.src = source;
  }, imageUrl);
  await page.waitForFunction(() => {
    const image = document.querySelector('#source-image');
    return Boolean(image && image.complete && image.naturalWidth >= 160 && image.naturalHeight >= 90);
  }, null, { timeout: OPEN_GRAPH_WAIT_MS });
  const image = page.locator('#source-image');
  const box = await image.boundingBox();
  if (!box || box.width < 160 || box.height < 90) throw new Error('OPEN_GRAPH_IMAGE_UNAVAILABLE');
  const buffer = await image.screenshot({
    type: 'jpeg',
    quality: 80,
    animations: 'disabled',
    caret: 'hide'
  });
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('SCREENSHOT_TOO_LARGE');
  return {
    finalUrl: targetUrl,
    title: String(metadata.title || '').slice(0, 240),
    captureVersion: CAPTURE_VERSION,
    pageHeight: Math.ceil(box.height),
    segmentCount: 1,
    truncated: false,
    profile: 'focus-v1',
    focus: { kind: 'open-graph', confidence: 'high', score: 0, targetMatched: false },
    media: { total: 1, ready: 1, pending: 0 },
    quality: {
      policyVersion: PAGE_QUALITY_POLICY_VERSION,
      verdict: 'accept',
      targetMatched: false,
      reviewRequired: true,
      reasonCode: 'OPEN_GRAPH_IMAGE_READY'
    },
    screenshots: [{
      mimeType: 'image/jpeg',
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
      data: buffer.toString('base64')
    }]
  };
}

module.exports = {
  OPEN_GRAPH_WAIT_MS,
  normalizeOpenGraphImageUrl,
  captureOpenGraphImage
};
