const FOCUS_PROFILE = 'focus-v1';
const FOCUS_ATTRIBUTE = 'data-source-preview-focus';

function normalizeCaptureProfile(value) {
  return value === FOCUS_PROFILE ? FOCUS_PROFILE : 'page';
}

function statusIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === 'platform.twitter.com'
      && url.pathname.toLowerCase() === '/embed/tweet.html') {
      const embeddedId = url.searchParams.get('id') || '';
      return /^\d+$/.test(embeddedId) ? embeddedId : '';
    }
    if (!/(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname)) return '';
    const match = url.pathname.match(/\/status\/(\d+)/i);
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

function candidateScore(candidate) {
  if (!candidate) return Number.NEGATIVE_INFINITY;
  const textLength = Math.max(0, Number(candidate.textLength) || 0);
  const linkTextLength = Math.max(0, Number(candidate.linkTextLength) || 0);
  const linkDensity = textLength ? Math.min(1, linkTextLength / textLength) : 1;
  const area = Math.max(0, Number(candidate.width) || 0) * Math.max(0, Number(candidate.height) || 0);
  const areaScore = Math.min(850, area / 1400);
  return Math.min(2200, textLength) * 0.72
    + Math.min(6, Math.max(0, Number(candidate.headingCount) || 0)) * 120
    + Math.min(8, Math.max(0, Number(candidate.imageCount) || 0)) * 105
    + Math.min(5, Math.max(0, Number(candidate.meaningfulImageCount) || 0)) * 130
    + areaScore
    + Math.max(0, Number(candidate.semanticWeight) || 0)
    + (candidate.targetStatus ? 10000 : 0)
    - linkDensity * 950
    - Math.max(0, Number(candidate.navigationPenalty) || 0);
}

function chooseFocusCandidate(candidates, targetUrl) {
  const statusId = statusIdFromUrl(targetUrl);
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ ...candidate, score: candidateScore(candidate) }))
    .sort((left, right) => right.score - left.score);
  const chosen = ranked[0];
  if (!chosen) return null;
  if (statusId && chosen.kind === 'x-status') {
    return { ...chosen, confidence: chosen.targetStatus ? 'high' : 'medium' };
  }
  if (chosen.textLength < 120 || chosen.score < 620) return null;
  return { ...chosen, confidence: chosen.score >= 1500 ? 'high' : 'medium' };
}

async function collectFocusCandidates(page, targetUrl) {
  const targetStatusId = statusIdFromUrl(targetUrl);
  return page.evaluate(({ targetStatusId, attribute }) => {
    const seen = new Set();
    const nodes = [];
    const add = (node, kind, semanticWeight) => {
      if (!node || seen.has(node)) return;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden'
        || rect.width < 260 || rect.height < 120) return;
      seen.add(node);
      nodes.push({ node, kind, semanticWeight });
    };

    if (targetStatusId) {
      for (const article of document.querySelectorAll('article')) add(article, 'x-status', 900);
    }
    const selectors = [
      ['article', 'article', 430],
      ['main', 'main', 230],
      ['[role="main"]', 'main', 210],
      ['[itemprop="articleBody"]', 'article-body', 520],
      ['.article-content,.article__content,.post-content,.entry-content,.story-body', 'article-body', 480],
      ['#article,#content,#main-content', 'content', 300]
    ];
    for (const [selector, kind, weight] of selectors) {
      for (const node of document.querySelectorAll(selector)) add(node, kind, weight);
    }

    return nodes.map(({ node, kind, semanticWeight }, index) => {
      const id = `candidate-${index + 1}`;
      node.setAttribute(attribute, id);
      const rect = node.getBoundingClientRect();
      const text = String(node.innerText || '').replace(/\s+/g, ' ').trim();
      const links = [...node.querySelectorAll('a')];
      const linkTextLength = links.reduce((total, link) => (
        total + String(link.innerText || '').replace(/\s+/g, ' ').trim().length
      ), 0);
      const images = [...node.querySelectorAll('img')];
      const meaningfulImageCount = images.filter((image) => {
        const imageRect = image.getBoundingClientRect();
        return imageRect.width >= 24 && imageRect.height >= 24;
      }).length;
      const targetStatus = Boolean(targetStatusId && links.some((link) => (
        String(link.getAttribute('href') || '')
          .split(/[?#]/, 1)[0]
          .replace(/\/+$/, '')
          .endsWith(`/status/${targetStatusId}`)
      )));
      const navigationPenalty = node.matches('nav,header,footer,[role="navigation"]') ? 1800 : 0;
      return {
        id,
        kind,
        semanticWeight,
        targetStatus,
        textLength: text.length,
        linkTextLength,
        headingCount: node.querySelectorAll('h1,h2,h3').length,
        imageCount: images.length,
        meaningfulImageCount,
        navigationPenalty,
        width: rect.width,
        height: rect.height
      };
    });
  }, { targetStatusId, attribute: FOCUS_ATTRIBUTE });
}

async function selectFocusCandidate(page, targetUrl) {
  const candidates = await collectFocusCandidates(page, targetUrl);
  const chosen = chooseFocusCandidate(candidates, targetUrl);
  if (!chosen) return null;
  await page.evaluate(({ attribute, id }) => {
    for (const node of document.querySelectorAll(`[${attribute}]`)) {
      if (node.getAttribute(attribute) !== id) node.removeAttribute(attribute);
    }
    const selected = document.querySelector(`[${attribute}="${id}"]`);
    if (selected) selected.setAttribute(attribute, 'selected');
  }, { attribute: FOCUS_ATTRIBUTE, id: chosen.id });
  return {
    kind: chosen.kind,
    confidence: chosen.confidence,
    score: Math.round(chosen.score),
    targetMatched: chosen.targetStatus === true
  };
}

module.exports = {
  FOCUS_PROFILE,
  FOCUS_ATTRIBUTE,
  normalizeCaptureProfile,
  statusIdFromUrl,
  candidateScore,
  chooseFocusCandidate,
  collectFocusCandidates,
  selectFocusCandidate
};
