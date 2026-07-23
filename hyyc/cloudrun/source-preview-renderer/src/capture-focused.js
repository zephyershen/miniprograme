const {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  segmentLimit
} = require('./capture-plan.js');
const { MAX_IMAGE_BYTES } = require('./capture-segments.js');

const FOCUS_PADDING = 28;
const MIN_FOCUS_WIDTH = 120;
const MIN_FOCUS_HEIGHT = 80;

function createFocusCapturePlan(box, documentSize, requestedSegments = DEFAULT_MAX_SEGMENTS) {
  if (!box) return null;
  const values = [box.x, box.y, box.width, box.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [boxX, boxY, boxWidth, boxHeight] = values;
  if (boxWidth < 1 || boxHeight < 1) return null;

  const rawDocumentWidth = Number(documentSize && documentSize.width);
  const rawDocumentHeight = Number(documentSize && documentSize.height);
  const documentWidth = Math.max(
    1,
    Math.ceil(Number.isFinite(rawDocumentWidth) ? rawDocumentWidth : VIEWPORT.width)
  );
  const documentHeight = Math.max(
    1,
    Math.ceil(Number.isFinite(rawDocumentHeight) ? rawDocumentHeight : VIEWPORT.height)
  );
  // The selected node can move or disappear while lazy media is loading. Use
  // the real intersection with the latest document instead of coercing a
  // fully stale box into a misleading 1x1 screenshot.
  const x = Math.max(0, Math.floor(boxX - FOCUS_PADDING));
  const y = Math.max(0, Math.floor(boxY - FOCUS_PADDING));
  const right = Math.min(documentWidth, Math.ceil(boxX + boxWidth + FOCUS_PADDING));
  const bottom = Math.min(documentHeight, Math.ceil(boxY + boxHeight + FOCUS_PADDING));
  if (right <= x || bottom <= y) return null;
  const width = right - x;
  const height = bottom - y;
  if (width < MIN_FOCUS_WIDTH || height < MIN_FOCUS_HEIGHT) return null;
  const requiredSegments = Math.max(1, Math.ceil(height / VIEWPORT.height));
  const segmentCount = Math.min(segmentLimit(requestedSegments), requiredSegments);
  const clips = [];
  for (let index = 0; index < segmentCount; index += 1) {
    let clipY = y + index * VIEWPORT.height;
    let clipHeight = Math.min(VIEWPORT.height, bottom - clipY);
    if (index > 0 && clipHeight < VIEWPORT.height * 0.45) {
      clipY = Math.max(y, bottom - VIEWPORT.height);
      clipHeight = Math.min(VIEWPORT.height, bottom - clipY);
    }
    const clip = { x, y: clipY, width, height: Math.max(1, clipHeight) };
    const previous = clips[clips.length - 1];
    if (!previous || previous.y !== clip.y || previous.height !== clip.height) clips.push(clip);
  }
  return {
    x,
    y,
    width,
    height,
    requiredSegments,
    segmentCount: clips.length,
    truncated: requiredSegments > clips.length,
    clips
  };
}

async function documentMetrics(page) {
  return page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    title: document.title || ''
  }));
}

async function captureFocusedSegments(page, box, requestedSegments = DEFAULT_MAX_SEGMENTS) {
  const metrics = await documentMetrics(page);
  const plan = createFocusCapturePlan(box, metrics, requestedSegments);
  if (!plan) return null;
  const screenshots = [];
  for (const clip of plan.clips) {
    await page.evaluate((scrollY) => window.scrollTo(0, Math.max(0, scrollY - 20)), clip.y);
    await page.waitForTimeout(100);
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 74,
      clip,
      animations: 'disabled',
      caret: 'hide'
    });
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('SCREENSHOT_TOO_LARGE');
    screenshots.push({
      mimeType: 'image/jpeg',
      width: clip.width,
      height: clip.height,
      data: buffer.toString('base64')
    });
  }
  return {
    pageHeight: plan.height,
    segmentCount: screenshots.length,
    truncated: plan.truncated,
    screenshots
  };
}

module.exports = {
  FOCUS_PADDING,
  MIN_FOCUS_WIDTH,
  MIN_FOCUS_HEIGHT,
  createFocusCapturePlan,
  documentMetrics,
  captureFocusedSegments
};
