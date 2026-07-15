const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReadingGuide, buildRelatedItems, getOriginAction } = require('../utils/editorial-detail');

test('turns a long summary into a short lead and three scan-friendly facts', () => {
  const guide = buildReadingGuide('产品发布了新模型，支持离线运行。模型体积缩小到 4GB。它支持视觉任务和工具调用。团队同时开放了模型权重。');
  assert.equal(guide.brief, '产品发布了新模型，支持离线运行。');
  assert.deepEqual(guide.keyPoints.map((item) => item.indexLabel), ['01', '02', '03']);
  assert.equal(guide.keyPoints[0].text, '模型体积缩小到 4GB。');
});

test('uses real covered items from the same category before broader channel updates', () => {
  const current = { id: '1', category: 'paper', channelKey: 'ai' };
  const items = [
    current,
    { id: '2', category: 'industry', channelKey: 'tech', coverFileId: 'cloud://2' },
    { id: '3', category: 'ai-products', channelKey: 'ai', coverFileId: 'cloud://3' },
    { id: '4', category: 'paper', channelKey: 'ai', coverFileId: 'cloud://4' },
    { id: '5', category: 'paper', channelKey: 'ai', coverFileId: '' }
  ];
  assert.deepEqual(buildRelatedItems(items, current).map((item) => item.id), ['4', '3', '2']);
});

test('opens only verified webview hosts and falls back to copying every other source', () => {
  assert.equal(getOriginAction('https://news.example.com/a', ['news.example.com']).canOpen, true);
  const fallback = getOriginAction('https://techcrunch.com/a', []);
  assert.equal(fallback.canOpen, false);
  assert.equal(fallback.label, '复制原文链接');
});
