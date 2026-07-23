const { statusIdFromUrl } = require('./focus-policy.js');

const PAGE_QUALITY_POLICY_VERSION = 1;
const MIN_DOCUMENT_TEXT_LENGTH = 120;

function normalizeVisibleText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function assessPageSnapshot(snapshot = {}, targetUrl = '') {
  const text = normalizeVisibleText(snapshot.text);
  const title = normalizeVisibleText(snapshot.title);
  const combined = `${title} ${text}`.trim();
  const combinedLower = combined.toLowerCase();
  const targetStatusId = statusIdFromUrl(targetUrl);
  const targetMatched = Boolean(targetStatusId && snapshot.targetMatched === true);
  const primaryContentCount = Math.max(0, Number(snapshot.primaryContentCount) || 0);
  const meaningfulImageCount = Math.max(0, Number(snapshot.meaningfulImageCount) || 0);
  const actionText = normalizeVisibleText(snapshot.actionText).toLowerCase();
  const hasPrimaryContent = targetMatched || primaryContentCount > 0;

  const xErrorShell = /something went wrong/i.test(combined)
    && (/try reloading/i.test(combined)
      || /\brefresh\b/i.test(actionText)
      || /\btry again\b/i.test(actionText));
  const genericErrorShell = !targetMatched && containsAny(combinedLower, [
    /\bthis page (?:isn['’]?t|is not) (?:working|available)\b/,
    /\bthis page (?:couldn['’]?t|could not|can['’]?t|cannot) load\b/,
    /\binternal server error\b/,
    /\bservice unavailable\b/,
    /\bbad gateway\b/,
    /\bgateway time-?out\b/,
    /\bpage not found\b/,
    /页面(?:暂时)?无法(?:打开|访问)/,
    /页面不存在/,
    /服务暂时不可用/
  ]) && (!hasPrimaryContent || text.length < 480);
  if (xErrorShell || genericErrorShell) {
    return rejectedQuality('ERROR_SHELL', targetStatusId, targetMatched);
  }

  const challengePage = !targetMatched && containsAny(combinedLower, [
    /\bchecking your browser\b/,
    /\bverifying you are human\b/,
    /\bverify you are human\b/,
    /\bjust a moment\b/,
    /\bcaptcha\b/,
    /\bsecurity check\b/,
    /\benable javascript and cookies\b/,
    /人机验证/,
    /访问验证/,
    /安全验证/,
    /请完成验证/
  ]);
  if (challengePage) return rejectedQuality('CHALLENGE_PAGE', targetStatusId, targetMatched);

  const explicitLoginWall = containsAny(combinedLower, [
    /\b(?:log|sign) in to continue\b/,
    /\byou must be logged in\b/,
    /\bplease (?:log|sign) in\b/,
    /请先登录/,
    /登录后(?:查看|继续|访问|阅读)/
  ]);
  const loginAndSignup = (/\blog in\b/.test(combinedLower)
    && (/\bsign up\b/.test(combinedLower) || /\bcreate account\b/.test(combinedLower)))
    || (combined.includes('登录') && (combined.includes('注册') || combined.includes('创建账号')));
  const loginWall = !targetMatched && (explicitLoginWall || (!hasPrimaryContent && loginAndSignup));
  if (loginWall) return rejectedQuality('LOGIN_WALL', targetStatusId, targetMatched);

  if (targetStatusId) {
    if (!targetMatched) return rejectedQuality('TARGET_STATUS_NOT_FOUND', targetStatusId, false);
    return acceptedQuality('TARGET_STATUS_MATCHED', true, false);
  }

  if (hasPrimaryContent) return acceptedQuality('PRIMARY_CONTENT_READY', false, true);
  if (text.length >= MIN_DOCUMENT_TEXT_LENGTH || meaningfulImageCount > 0) {
    return acceptedQuality('DOCUMENT_CONTENT_READY', false, true);
  }
  if (!text.length && meaningfulImageCount === 0) {
    return rejectedQuality('BLANK_PAGE', '', false);
  }
  return rejectedQuality('CONTENT_TOO_SPARSE', '', false);
}

function acceptedQuality(reasonCode, targetMatched, reviewRequired) {
  return {
    policyVersion: PAGE_QUALITY_POLICY_VERSION,
    verdict: 'accept',
    targetMatched: targetMatched === true,
    reviewRequired: reviewRequired === true,
    reasonCode
  };
}

function rejectedQuality(reasonCode, targetStatusId, targetMatched) {
  return {
    policyVersion: PAGE_QUALITY_POLICY_VERSION,
    verdict: 'retry',
    targetMatched: targetMatched === true,
    reviewRequired: false,
    reasonCode,
    targetStatusId: targetStatusId || ''
  };
}

function createPageQualityError(qualityOrReason) {
  const quality = typeof qualityOrReason === 'string'
    ? rejectedQuality(qualityOrReason, '', false)
    : qualityOrReason;
  const reasonCode = quality && quality.reasonCode || 'PAGE_REJECTED';
  const error = new Error(`PAGE_QUALITY_${reasonCode}`);
  error.code = 'PAGE_QUALITY_REJECTED';
  error.reasonCode = reasonCode;
  error.quality = quality;
  return error;
}

function assertAcceptedPageQuality(quality) {
  if (!quality || quality.verdict !== 'accept') throw createPageQualityError(quality);
  return quality;
}

function isPageQualityError(error) {
  return Boolean(error && error.code === 'PAGE_QUALITY_REJECTED');
}

function isRecoverablePageAttemptError(error) {
  if (isPageQualityError(error)) return true;
  const message = String(error && error.message || error || '');
  if (error && error.name === 'AbortError') return false;
  if (/abort|target closed|context closed|browser.*closed/i.test(message)) return false;
  if (/^UPSTREAM_HTTP_5\d\d$/.test(message) || message === 'NO_DOCUMENT_RESPONSE') return true;
  return /net::ERR_[A-Z_]+|navigation.*(?:timeout|failed)|page\.(?:goto|reload).*timeout/i.test(message);
}

async function inspectPageQuality(page, targetUrl) {
  const targetStatusId = statusIdFromUrl(targetUrl);
  const snapshot = await page.evaluate((expectedStatusId) => {
    const visible = (node, minimumWidth = 1, minimumHeight = 1) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width >= minimumWidth && rect.height >= minimumHeight;
    };
    const textOf = (node) => String(node && node.innerText || '').replace(/\s+/g, ' ').trim();
    const articles = [...document.querySelectorAll('article')].filter((node) => visible(node, 180, 80));
    const targetMatched = Boolean(expectedStatusId && articles.some((article) => (
      [...article.querySelectorAll('a[href]')].some((link) => (
        String(link.getAttribute('href') || '')
          .split(/[?#]/, 1)[0]
          .replace(/\/+$/, '')
          .endsWith(`/status/${expectedStatusId}`)
      ))
    )));
    const primarySelectors = [
      'article',
      'main',
      '[role="main"]',
      '[itemprop="articleBody"]',
      '.article-content',
      '.article__content',
      '.post-content',
      '.entry-content',
      '.story-body',
      '#article',
      '#content',
      '#main-content'
    ];
    const primary = [...new Set(primarySelectors.flatMap((selector) => (
      [...document.querySelectorAll(selector)]
    )))].filter((node) => {
      if (!visible(node, 260, 120)) return false;
      const meaningfulMedia = [...node.querySelectorAll('img,video')]
        .some((media) => visible(media, 120, 80));
      return textOf(node).length >= 120 || meaningfulMedia;
    });
    const meaningfulImageCount = [...document.querySelectorAll('img,video')]
      .filter((node) => visible(node, 120, 80)).length;
    const actions = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')]
      .filter((node) => visible(node))
      .map((node) => textOf(node) || String(node.value || node.getAttribute('aria-label') || ''))
      .join(' ');
    return {
      title: document.title || '',
      text: textOf(document.body),
      actionText: actions,
      targetMatched,
      primaryContentCount: primary.length,
      meaningfulImageCount
    };
  }, targetStatusId);
  return assessPageSnapshot(snapshot, targetUrl);
}

async function runWithSingleQualityReload(runAttempt) {
  try {
    return await runAttempt({ attempt: 0, reload: false });
  } catch (error) {
    if (!isRecoverablePageAttemptError(error)) throw error;
    return runAttempt({ attempt: 1, reload: true });
  }
}

module.exports = {
  PAGE_QUALITY_POLICY_VERSION,
  MIN_DOCUMENT_TEXT_LENGTH,
  normalizeVisibleText,
  assessPageSnapshot,
  createPageQualityError,
  assertAcceptedPageQuality,
  isPageQualityError,
  isRecoverablePageAttemptError,
  inspectPageQuality,
  runWithSingleQualityReload
};
