const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFallbackDigest } = require('../cloudfunctions/digestIngest/lib/fallback');

test('builds a transparent bounded fallback when CloudBase AI is unavailable', () => {
  const digest = buildFallbackDigest({
    title: 'A practical Node.js introduction',
    language: 'en',
    text: 'Node.js is an open-source runtime that executes JavaScript outside a browser. It lets developers use one language across client and server applications. Its event loop is designed for efficient input and output workloads.'
  });

  assert.equal(digest.relevanceLevel, 'low');
  assert.match(digest.summaryZh, /^AI 暂不可用，临时摘录：/);
  assert.match(digest.relevanceReasonZh, /尚未完成/);
  assert.ok(digest.keySentences.length >= 1 && digest.keySentences.length <= 3);
  assert.ok(Array.from(digest.summaryZh).length <= 120);
  assert.ok(digest.keySentences.every((sentence) => Array.from(sentence.source).length <= 240));
  assert.ok(digest.keySentences.every((sentence) => sentence.translationZh === ''));
});
