const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { AppError } = require('./errors');

const MIN_ARTICLE_LENGTH = 400;
const MAX_ARTICLE_CHARS = 12000;

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateArticle(text, maxChars = MAX_ARTICLE_CHARS) {
  const characters = Array.from(cleanText(text));
  if (characters.length <= maxChars) return characters.join('');
  const headLength = Math.floor(maxChars * 0.75);
  const tailLength = maxChars - headLength;
  return `${characters.slice(0, headLength).join('')}\n\n[正文中段已截断]\n\n${characters.slice(-tailLength).join('')}`;
}

function detectLanguage(text) {
  const sample = Array.from(text.slice(0, 5000));
  if (!sample.length) return null;
  const cjk = sample.filter((char) => /[\u3400-\u9fff]/.test(char)).length;
  const latin = sample.filter((char) => /[A-Za-z]/.test(char)).length;
  if (cjk / sample.length >= 0.05) return 'zh';
  if (latin / sample.length >= 0.2) return 'en';
  return null;
}

function extractArticle(html, url) {
  let dom;
  try {
    dom = new JSDOM(html, { url });
  } catch (error) {
    throw new AppError('UNSUPPORTED_PAGE', '页面结构无法解析');
  }

  const document = dom.window.document;
  document.querySelectorAll('script, style, noscript, template, iframe, form').forEach((node) => node.remove());
  const parsed = new Readability(document, { charThreshold: MIN_ARTICLE_LENGTH }).parse();
  const fallback = document.querySelector('article');
  const text = cleanText(parsed && parsed.textContent ? parsed.textContent : fallback && fallback.textContent);
  const title = cleanText((parsed && parsed.title) || document.title).slice(0, 200);

  dom.window.close();

  if (!title || text.length < MIN_ARTICLE_LENGTH) {
    throw new AppError('UNSUPPORTED_PAGE', '没有提取到足够的文章正文，可能需要登录或依赖动态加载');
  }

  const language = detectLanguage(text);
  if (!language) throw new AppError('UNSUPPORTED_LANGUAGE', '首版只支持中文或英文文章');

  return {
    title,
    language,
    text: truncateArticle(text)
  };
}

module.exports = {
  MIN_ARTICLE_LENGTH,
  MAX_ARTICLE_CHARS,
  cleanText,
  truncateArticle,
  detectLanguage,
  extractArticle
};
