const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractArticle,
  truncateArticle,
  detectLanguage
} = require('../cloudfunctions/digestIngest/lib/extract');

function articleHtml(title, paragraphs) {
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${paragraphs.map((text) => `<p>${text}</p>`).join('')}</article></body></html>`;
}

test('extracts a Chinese article without returning HTML', () => {
  const paragraph = '人工智能工具正在快速变化，但真正重要的是判断它是否能解决当前问题，而不是收藏所有更新。';
  const result = extractArticle(articleHtml('如何处理 AI 信息焦虑', Array(18).fill(paragraph)), 'https://example.com/zh');
  assert.equal(result.language, 'zh');
  assert.equal(result.title, '如何处理 AI 信息焦虑');
  assert.match(result.text, /真正重要的是判断/);
  assert.doesNotMatch(result.text, /<p>/);
});

test('extracts an English article and detects its language', () => {
  const paragraph = 'The useful question is not whether a new model is impressive, but whether it changes a real decision in your daily routine.';
  const result = extractArticle(articleHtml('A practical guide to AI updates', Array(12).fill(paragraph)), 'https://example.com/en');
  assert.equal(result.language, 'en');
  assert.match(result.text, /real decision/);
});

test('rejects pages without enough article content', () => {
  assert.throws(
    () => extractArticle('<html><head><title>Login</title></head><body>Please sign in</body></html>', 'https://example.com/login'),
    { code: 'UNSUPPORTED_PAGE' }
  );
});

test('truncates long content while preserving the beginning and end', () => {
  const value = `${'A'.repeat(10000)}${'Z'.repeat(10000)}`;
  const result = truncateArticle(value, 1000);
  assert.ok(result.startsWith('A'));
  assert.ok(result.endsWith('Z'));
  assert.match(result, /正文中段已截断/);
});

test('detects only Chinese and English text', () => {
  assert.equal(detectLanguage('这是一个用于测试语言判断的中文段落。'.repeat(20)), 'zh');
  assert.equal(detectLanguage('This is an English paragraph used for language detection. '.repeat(20)), 'en');
  assert.equal(detectLanguage('12345 !@#$% '.repeat(20)), null);
});
