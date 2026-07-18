const { VIEWPORT, HARD_MAX_SEGMENTS } = require('./capture-plan.js');
const { FOCUS_ATTRIBUTE } = require('./focus-policy.js');

async function focusBox(page) {
  return page.evaluate((attribute) => {
    const node = document.querySelector(`[${attribute}="selected"]`);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }, FOCUS_ATTRIBUTE);
}

async function primeLazyMedia(page, box) {
  if (!box) return;
  const top = Math.max(0, Math.floor(box.y - VIEWPORT.height * 0.2));
  const bottom = Math.max(top, Math.ceil(box.y + box.height - VIEWPORT.height));
  const step = Math.max(320, Math.floor(VIEWPORT.height * 0.72));
  const positions = [];
  for (let y = top; y < bottom && positions.length < HARD_MAX_SEGMENTS; y += step) positions.push(y);
  positions.push(bottom);
  for (const y of [...new Set(positions)]) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(180);
  }
}

async function waitForFocusedMedia(page, timeoutMs = 8000) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
  }).catch(() => {});
  await page.waitForFunction((attribute) => {
    const node = document.querySelector(`[${attribute}="selected"]`);
    if (!node) return true;
    const images = [...node.querySelectorAll('img')].filter((image) => {
      const rect = image.getBoundingClientRect();
      const style = window.getComputedStyle(image);
      return style.display !== 'none' && style.visibility !== 'hidden'
        && rect.width >= 18 && rect.height >= 18;
    });
    return images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }, FOCUS_ATTRIBUTE, { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 2200 }).catch(() => {});
  return page.evaluate((attribute) => {
    const node = document.querySelector(`[${attribute}="selected"]`);
    if (!node) return { total: 0, ready: 0, pending: 0 };
    const images = [...node.querySelectorAll('img')].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width >= 18 && rect.height >= 18;
    });
    const ready = images.filter((image) => image.complete && image.naturalWidth > 0).length;
    return { total: images.length, ready, pending: Math.max(0, images.length - ready) };
  }, FOCUS_ATTRIBUTE).catch(() => ({ total: 0, ready: 0, pending: 0 }));
}

async function stabilizeFocusedContent(page) {
  let box = await focusBox(page);
  if (!box) return { box: null, media: { total: 0, ready: 0, pending: 0 } };
  await primeLazyMedia(page, box);
  const media = await waitForFocusedMedia(page);
  box = await focusBox(page);
  if (box) {
    await page.evaluate((scrollY) => window.scrollTo(0, Math.max(0, scrollY - 24)), box.y);
    await page.waitForTimeout(120);
  }
  return { box, media };
}

module.exports = {
  focusBox,
  primeLazyMedia,
  waitForFocusedMedia,
  stabilizeFocusedContent
};
