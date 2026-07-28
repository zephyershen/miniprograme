const BRIEFING_WINDOW_KEYS = Object.freeze(['24h', '7d', '30d']);
const BRIEFING_INTENT_KEY = 'briefingWindowIntent';
const BRIEFING_INTENT_TTL_MS = 30 * 1000;

function normalizedWindowKey(value) {
  return BRIEFING_WINDOW_KEYS.includes(value) ? value : '24h';
}

function rememberBriefingWindow(app, windowKey, currentTime = Date.now()) {
  if (!app || typeof app !== 'object') return false;
  if (!app.globalData || typeof app.globalData !== 'object') app.globalData = {};
  app.globalData[BRIEFING_INTENT_KEY] = {
    windowKey: normalizedWindowKey(windowKey),
    createdAt: Number(currentTime)
  };
  return true;
}

function clearBriefingWindow(app) {
  if (!app || !app.globalData || typeof app.globalData !== 'object') return;
  delete app.globalData[BRIEFING_INTENT_KEY];
}

function consumeBriefingWindow(app, currentTime = Date.now()) {
  if (!app || !app.globalData || typeof app.globalData !== 'object') return '';
  const intent = app.globalData[BRIEFING_INTENT_KEY];
  clearBriefingWindow(app);
  if (!intent || typeof intent !== 'object') return '';
  const createdAt = Number(intent.createdAt);
  const age = Number(currentTime) - createdAt;
  if (!Number.isFinite(createdAt) || !Number.isFinite(age)
    || age < 0 || age > BRIEFING_INTENT_TTL_MS) return '';
  return normalizedWindowKey(intent.windowKey);
}

module.exports = {
  BRIEFING_WINDOW_KEYS,
  BRIEFING_INTENT_TTL_MS,
  normalizedWindowKey,
  rememberBriefingWindow,
  clearBriefingWindow,
  consumeBriefingWindow
};
