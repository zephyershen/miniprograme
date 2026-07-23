const { installGuardedContextRoutes } = require('./browser-network-policy.js');

const LIST_THUMBNAIL_VERSION = 1;
const LIST_THUMBNAIL_WIDTH = 360;
const LIST_THUMBNAIL_HEIGHT = 253;
const LIST_THUMBNAIL_QUALITY = 64;
const MAX_THUMBNAIL_BYTES = 180 * 1024;

function thumbnailDocument() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#e1ded7}
    img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
  </style></head><body><img id="source" alt=""></body></html>`;
}

async function renderListThumbnail(browser, sourceUrl, guard, signal) {
  const context = await browser.newContext({
    viewport: { width: LIST_THUMBNAIL_WIDTH, height: LIST_THUMBNAIL_HEIGHT },
    deviceScaleFactor: 1,
    serviceWorkers: 'block'
  });
  const abortRender = () => context.close().catch(() => {});
  try {
    await installGuardedContextRoutes(context, guard);
    if (signal) {
      if (signal.aborted) throw new Error('THUMBNAIL_ABORTED');
      signal.addEventListener('abort', abortRender, { once: true });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.setContent(thumbnailDocument(), { waitUntil: 'domcontentloaded', timeout: 5000 });
    await page.evaluate((url) => { document.querySelector('#source').src = url; }, sourceUrl);
    await page.waitForFunction(() => {
      const image = document.querySelector('#source');
      return image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    });
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: LIST_THUMBNAIL_QUALITY,
      animations: 'disabled',
      caret: 'hide'
    });
    if (!buffer.length || buffer.length > MAX_THUMBNAIL_BYTES
      || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      throw new Error('THUMBNAIL_OUTPUT_INVALID');
    }
    return {
      version: LIST_THUMBNAIL_VERSION,
      mimeType: 'image/jpeg',
      width: LIST_THUMBNAIL_WIDTH,
      height: LIST_THUMBNAIL_HEIGHT,
      data: buffer.toString('base64')
    };
  } finally {
    if (signal) signal.removeEventListener('abort', abortRender);
    await context.close().catch(() => {});
  }
}

module.exports = {
  LIST_THUMBNAIL_VERSION,
  LIST_THUMBNAIL_WIDTH,
  LIST_THUMBNAIL_HEIGHT,
  LIST_THUMBNAIL_QUALITY,
  MAX_THUMBNAIL_BYTES,
  thumbnailDocument,
  renderListThumbnail
};
