const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadDetailPage() {
  let definition;
  const previousPage = global.Page;
  global.Page = (value) => {
    definition = value;
  };
  try {
    const modulePath = require.resolve('../pages/feed-detail/index');
    delete require.cache[modulePath];
    require(modulePath);
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      this.data = { ...this.data, ...patch };
    }
  };
}

test('resets and toggles long source URL expansion when a detail item is shown', () => {
  const page = loadDetailPage();
  page.showItem({
    id: 'source-1',
    title: '测试资讯',
    source: 'Example',
    url: `https://example.com/${'very-long-source-path/'.repeat(3)}`,
    summary: '这是一段用于测试的完整摘要。',
    publishedAt: '2026-07-16T08:00:00.000Z',
    relatedItems: []
  });

  assert.equal(page.data.sourceUrlCanExpand, true);
  assert.equal(page.data.sourceUrlExpanded, false);
  page.toggleSourceUrl();
  assert.equal(page.data.sourceUrlExpanded, true);
  page.toggleSourceUrl();
  assert.equal(page.data.sourceUrlExpanded, false);
});

test('keeps source actions before related reading and exposes separate URL and copy controls', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/feed-detail/index.wxml'), 'utf8');
  assert.ok(markup.indexOf('class="source-section"') < markup.indexOf('class="related-section"'));
  assert.match(markup, /class="source-url [^"]*"[\s\S]*bindtap="openOriginal"/);
  assert.match(markup, /class="source-url-toggle"[\s\S]*catchtap="toggleSourceUrl"/);
  assert.match(markup, /class="source-copy-action" bindtap="copyOriginal">复制<\/button>/);
});

test('uses the existing copy fallback when a source cannot open inside the mini program', () => {
  const page = loadDetailPage();
  const previousWx = global.wx;
  let copiedUrl = '';
  global.wx = {
    setClipboardData(options) {
      copiedUrl = options.data;
      options.success();
    },
    showToast() {}
  };
  try {
    page.data.item = {
      url: 'https://outside.example.com/article',
      originAction: { canOpen: false }
    };
    page.openOriginal();
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
  assert.equal(copiedUrl, 'https://outside.example.com/article');
});
