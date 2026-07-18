const {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  segmentLimit
} = require('./capture-plan.js');
const { MAX_IMAGE_BYTES } = require('./capture-segments.js');

const FOCUS_PADDING = 28;

function createFocusCapturePlan(box, documentSize, requestedSegments = DEFAULT_MAX_SEGMENTS) {
  if (!box || Number(box.width) < 1 || Number(box.height) < 1) return null;
  const documentWidth = Math.max(1, Math.ceil(Number(documentSize && documentSize.width) || VIEWPORT.width));
  const documentHeight = Math.max(1, Math.ceil(Number(documentSize && documentSize.height) || VIEWPORT.height));
  const x = Math.max(0, Math.floor(Number(box.x) - FOCUS_PADDING));
  const y = Math.max(0, Math.floor(Number(box.y) - FOCUS_PADDING));
  const right = Math.min(documentWidth, Math.ceil(Number(box.x) + Number(box.width) + FOCUS_PADDING));
  const bottom = Math.min(documentHeight, Math.ceil(Number(box.y) + Number(box.height) + FOCUS_PADDING));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
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
  createFocusCapturePlan,
  documentMetrics,
  captureFocusedSegments
};
