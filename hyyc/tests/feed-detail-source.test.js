const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { previewSlides } = require('../features/knowledge-feed/detail-model');

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

test('renders source screenshots as an automatic carousel with dots below the image', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/feed-detail/index.wxml'), 'utf8');
  assert.match(markup, /<swiper[\s\S]*autoplay="{{previewAutoplay && item\.previewFileIds\.length > 1}}"/);
  assert.match(markup, /circular="{{item\.previewFileIds\.length > 1}}"/);
  assert.match(markup, /bindchange="onPreviewChange"/);
  assert.match(markup, /wx:for="{{item\.previewSlides}}"[\s\S]*data-index="{{previewImageIndex}}"/);
  assert.match(markup, /wx:if="{{previewSlide\.shouldLoad}}"[\s\S]*src="{{previewSlide\.fileId}}"/);
  assert.match(markup, /class="source-preview-dots"/);
  assert.doesNotMatch(markup, /source-preview-action/);
});

test('loads only the current and neighboring carousel screenshots in the page', () => {
  const fileIds = Array.from({ length: 12 }, (_, index) => `cloud://preview-${index}.jpg`);
  const first = previewSlides(fileIds, 0);
  assert.deepEqual(first.map((slide, index) => slide.shouldLoad ? index : null).filter((value) => value !== null), [0, 1, 11]);
  const middle = previewSlides(fileIds, 6);
  assert.deepEqual(middle.map((slide, index) => slide.shouldLoad ? index : null).filter((value) => value !== null), [5, 6, 7]);
});

test('stops automatic carousel work after one complete cycle', () => {
  const page = loadDetailPage();
  page.data.item = {
    previewFileIds: ['cloud://one.jpg', 'cloud://two.jpg'],
    previewSlides: previewSlides(['cloud://one.jpg', 'cloud://two.jpg'], 0)
  };
  page.onPreviewChange({ detail: { current: 1, source: 'autoplay' } });
  assert.equal(page.data.previewAutoplay, true);
  page.onPreviewChange({ detail: { current: 0, source: 'autoplay' } });
  assert.equal(page.data.previewAutoplay, false);
});

test('tracks the visible screenshot and opens the full screenshot set at the tapped image', async () => {
  const page = loadDetailPage();
  const previousWx = global.wx;
  const requested = [];
  let previewOptions = null;
  global.wx = {
    cloud: {
      async getTempFileURL(options) {
        requested.push(...options.fileList);
        return {
          fileList: [
            { tempFileURL: 'https://temp.example.com/first.jpg' },
            { tempFileURL: 'https://temp.example.com/second.jpg' },
            { tempFileURL: 'https://temp.example.com/third.jpg' }
          ]
        };
      }
    },
    previewImage(options) { previewOptions = options; },
    showToast() {}
  };
  try {
    page.data.item = { previewFileIds: ['cloud://first.jpg', 'cloud://second.jpg', 'cloud://third.jpg'] };
    page.onPreviewChange({ detail: { current: 1 } });
    await page.previewSourceScreenshots({ currentTarget: { dataset: { index: 1 } } });
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(page.data.previewIndex, 1);
  assert.deepEqual(requested, ['cloud://first.jpg', 'cloud://second.jpg', 'cloud://third.jpg']);
  assert.deepEqual(previewOptions, {
    current: 'https://temp.example.com/second.jpg',
    urls: [
      'https://temp.example.com/first.jpg',
      'https://temp.example.com/second.jpg',
      'https://temp.example.com/third.jpg'
    ]
  });
});
