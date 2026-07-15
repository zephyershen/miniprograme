const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReadingGuide, buildRelatedItems, getOriginAction } = require('../utils/editorial-detail');

test('turns a summary into complete scan-friendly units without adding ellipses', () => {
  const guide = buildReadingGuide('产品发布了新模型，支持离线运行。模型体积缩小到 4GB。它支持视觉任务和工具调用。团队同时开放了模型权重。');
  assert.equal(guide.brief, '产品发布了新模型，支持离线运行。');
  assert.deepEqual(guide.keyPoints.map((item) => item.indexLabel), ['01', '02', '03']);
  assert.equal(guide.keyPoints[0].text, '模型体积缩小到 4GB。');
  assert.equal([guide.brief, ...guide.keyPoints.map((item) => item.text)].join('').includes('…'), false);
  assert.equal(guide.keyPoints[2].text, '团队同时开放了模型权重。');
});

test('splits an overlong sentence at clauses but keeps every clause intact', () => {
  const summary = '这是第一段完整信息，第二段继续说明技术变化，第三段交代用户影响，第四段补充安全边界。';
  const guide = buildReadingGuide(summary.repeat(2));
  const combined = [guide.brief, ...guide.keyPoints.map((item) => item.text)].join('');
  assert.equal(combined.replace(/\s/g, ''), summary.repeat(2).replace(/\s/g, ''));
  assert.equal(combined.includes('…'), false);
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
