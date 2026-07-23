const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WINDOW_OPTIONS,
  normalizeTopicKeys,
  formatCoverageLabel,
  normalizeBriefing,
  filterBriefing
} = require('../features/briefing/model');

test('presents digest windows as calendar reports with their actual inclusive dates', () => {
  assert.deepEqual(WINDOW_OPTIONS.map(({ key, label, description }) => ({
    key, label, description
  })), [
    { key: '24h', label: '日报', description: '前一自然日' },
    { key: '7d', label: '周报', description: '上一自然周' },
    { key: '30d', label: '月报', description: '上一自然月' }
  ]);

  assert.equal(formatCoverageLabel(
    '2026-07-18T16:00:00.000Z',
    '2026-07-19T16:00:00.000Z'
  ), '覆盖 07.19');
  assert.equal(formatCoverageLabel(
    '2026-06-30T16:00:00.000Z',
    '2026-07-31T16:00:00.000Z'
  ), '覆盖 07.01—07.31');

  const briefing = normalizeBriefing({
    windowStart: '2026-07-12T16:00:00.000Z',
    windowEnd: '2026-07-19T16:00:00.000Z'
  });
  assert.equal(briefing.coverageLabel, '覆盖 07.13—07.19');
});

test('normalizes real free-form digest tags into stable UI topics without a migration', () => {
  const raw = {
    mustKnow: [
      {
        title: 'Google 更新 Gemini 推理能力',
        why: '安全治理与 AGI 路线同时推进',
        tags: ['AGI', 'Google', '安全治理'],
        sourceItemIds: ['google-gemini']
      },
      {
        title: 'Qwen 发布新的开源权重',
        tags: ['qwen', 'open-source'],
        sourceItemIds: ['qwen-open-source']
      },
      {
        title: 'MCP 编码工作流进入 GitHub',
        tags: ['工程效率', '开发者生态'],
        sourceItemIds: ['mcp-github']
      }
    ],
    trends: [{ title: '旧合同中的影响判断', tags: ['成本曲线'] }],
    radar: [{
      name: '月之暗面',
      copy: 'Kimi 调整模型价格',
      tags: ['pricing'],
      sourceItemIds: ['kimi-price']
    }]
  };

  const briefing = normalizeBriefing(raw);
  assert.deepEqual(briefing.mustKnow[0].topicKeys, ['company', 'model', 'trend']);
  assert.deepEqual(briefing.mustKnow[1].topicKeys, ['company', 'model', 'trend']);
  assert.deepEqual(briefing.mustKnow[2].topicKeys, ['tools', 'trend']);
  assert.equal(briefing.trends, undefined);
  assert.deepEqual(briefing.radar[0].topicKeys, ['company', 'model']);
  assert.equal(filterBriefing(briefing, 'company').mustKnow.length, 2);
  assert.equal(filterBriefing(briefing, 'model').radar[0].itemId, 'kimi-price');
  assert.equal(filterBriefing(briefing, 'tools').mustKnow[0].itemId, 'mcp-github');
  assert.ok(filterBriefing(briefing, 'trend').mustKnow.length > 0);

  assert.deepEqual(normalizeTopicKeys({ tags: ['company:openai'] }), ['company']);
});

test('builds a topic-specific empty state instead of a coverage warning', () => {
  const briefing = normalizeBriefing({
    mustKnow: [{ title: 'OpenAI 发布公司动态', tags: ['company'] }]
  });
  const filtered = filterBriefing(briefing, 'tools');
  assert.equal(filtered.topicEmpty, true);
  assert.equal(filtered.topicEmptyTitle, '本期暂无开发工具动态');
  assert.match(filtered.topicEmptyCopy, /切换到“全部”/);

  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{briefing\.topicEmpty\}\}"/);
  assert.match(markup, /wx:if="\{\{briefing\.mustKnow\.length\}\}"/);
  assert.doesNotMatch(markup, /数据覆盖不完整|结论仅代表已收录范围/);
});

test('derives the must-know heading from the visible item count after every filter', () => {
  const briefing = normalizeBriefing({
    mustKnow: [
      { title: '公司动态一', tags: ['company'] },
      { title: '公司动态二', tags: ['company'] },
      { title: '模型更新一', tags: ['model'] },
      { title: '工具更新一', tags: ['tools'] },
      { title: '工具更新二', tags: ['tools'] }
    ],
    mustKnowTitle: '先看这三件事'
  });

  assert.equal(briefing.mustKnowCount, 5);
  assert.equal(briefing.mustKnowTitle, '先看这5件事');

  const tools = filterBriefing(briefing, 'tools');
  assert.equal(tools.mustKnowCount, 2);
  assert.equal(tools.mustKnowTitle, '先看这2件事');

  const empty = filterBriefing(briefing, 'trend');
  assert.equal(empty.mustKnowCount, 0);
  assert.equal(empty.mustKnowTitle, '本期暂无核心事项');

  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxml'), 'utf8');
  assert.match(markup, /\{\{briefing\.mustKnowTitle\}\}/);
  assert.doesNotMatch(markup, /先看这(?:三|3)件事/);
});

test('makes radar sources navigable and leaves rows without an item id visibly disabled', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxss'), 'utf8');
  assert.match(markup, /class="radar-row \{\{item\.itemId && !locked \? 'radar-row-active' : 'radar-row-disabled'\}\}"/);
  assert.match(markup, /data-id="\{\{item\.itemId\}\}"/);
  assert.match(markup, /bindtap="openReference"/);
  assert.match(markup, /暂无可查看来源/);
  assert.match(styles, /\.radar-row-disabled[^}]*pointer-events:\s*none/);

  const previousPage = global.Page;
  const previousWx = global.wx;
  let definition;
  const navigations = [];
  global.Page = (page) => { definition = page; };
  global.wx = { navigateTo: (options) => navigations.push(options) };
  try {
    const entrypoint = require.resolve('../pages/briefing/index');
    delete require.cache[entrypoint];
    require(entrypoint);
    const context = { data: { briefing: { id: 'digest 01' }, locked: false } };
    definition.openReference.call(context, {
      currentTarget: { dataset: { id: 'item/01' } }
    });
    definition.openReference.call(context, {
      currentTarget: { dataset: { id: '' } }
    });
    definition.openReference.call({ data: { briefing: { id: 'digest 01' }, locked: true } }, {
      currentTarget: { dataset: { id: 'item/02' } }
    });
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(navigations, [{
    url: '/pages/feed-detail/index?id=item%2F01&digestId=digest%2001'
  }]);
});

test('uses clear everyday language for briefing headings and its fixed sample', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxml'), 'utf8');
  assert.match(markup, /这一期，值得你知道的事/);
  assert.match(markup, /帮你快速看懂：发生了什么、谁在推进、哪些原文值得继续看。/);
  assert.doesNotMatch(markup, /跟你有什么关系|briefing\.trends/);
  assert.match(markup, /谁在做什么/);
  assert.match(markup, /想了解更多/);
  assert.match(markup, /原始来源/);
  assert.doesNotMatch(markup, /为什么重要|公司与模型|值得继续读|来源索引/);

  const { BRIEFING_SAMPLE } = require('../features/briefing/sample');
  assert.equal(BRIEFING_SAMPLE.title, '这一期，值得你知道的事');
  assert.match(BRIEFING_SAMPLE.conclusion, /原始来源/);
  assert.doesNotMatch(JSON.stringify(BRIEFING_SAMPLE), /跟你有什么关系|要不要行动|影响谁/);
  assert.match(BRIEFING_SAMPLE.reading[0].title, /原始来源/);
});
