const VIEWPORT = Object.freeze({ width: 1080, height: 1350 });
const DEFAULT_MAX_SEGMENTS = 12;
const HARD_MAX_SEGMENTS = 12;
const CAPTURE_VERSION = 2;

function segmentLimit(requestedSegments = DEFAULT_MAX_SEGMENTS) {
  return Math.max(
    1,
    Math.min(HARD_MAX_SEGMENTS, Number(requestedSegments) || DEFAULT_MAX_SEGMENTS)
  );
}

function createCapturePlan(pageHeight, requestedSegments = DEFAULT_MAX_SEGMENTS) {
  const height = Math.max(VIEWPORT.height, Math.ceil(Number(pageHeight) || VIEWPORT.height));
  const maxSegments = segmentLimit(requestedSegments);
  const requiredSegments = Math.max(1, Math.ceil(height / VIEWPORT.height));
  const segmentCount = Math.min(maxSegments, requiredSegments);
  const maxScroll = Math.max(0, height - VIEWPORT.height);
  const truncated = requiredSegments > segmentCount;
  const scrollPositions = Array.from({ length: segmentCount }, (_, index) => {
    if (!truncated && index === segmentCount - 1) return maxScroll;
    return Math.min(index * VIEWPORT.height, maxScroll);
  });
  return { pageHeight: height, requiredSegments, segmentCount, truncated, scrollPositions };
}

module.exports = {
  VIEWPORT,
  DEFAULT_MAX_SEGMENTS,
  HARD_MAX_SEGMENTS,
  CAPTURE_VERSION,
  segmentLimit,
  createCapturePlan
};
