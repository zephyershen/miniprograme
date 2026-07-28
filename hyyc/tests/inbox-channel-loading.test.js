const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function loadInboxPage() {
  let definition;
  const previousPage = global.Page;
  global.Page = (value) => { definition = value; };
  try {
    const entrypoint = require.resolve('../pages/inbox/index');
    delete require.cache[entrypoint];
    require(entrypoint);
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return definition;
}

test('switching a source channel shows only a content-area spinner', () => {
  const page = loadInboxPage();
  const loadCalls = [];
  const context = {
    data: {
      activeChannel: 'all',
      sortMode: 'latest'
    },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    loadFeed(force, options) {
      loadCalls.push({ force, options });
    }
  };

  page.selectChannel.call(context, {
    currentTarget: { dataset: { key: 'news' } }
  });

  assert.equal(context.data.activeChannel, 'news');
  assert.equal(context.data.loading, false);
  assert.equal(context.data.channelTransitionLoading, true);
  assert.equal(context.data.newItemsVisible, false);
  assert.deepEqual(loadCalls, [{
    force: false,
    options: { channelTransition: true }
  }]);
});

test('renders the spinner in the content area without visible loading copy', () => {
  const markup = read('../pages/inbox/index.wxml');
  const styles = read('../pages/inbox/index.wxss');
  const spinnerBlock = markup.match(
    /<view wx:if="\{\{channelTransitionLoading\}\}"[\s\S]*?<\/view>\s*<\/view>/
  );

  assert.ok(spinnerBlock);
  assert.match(spinnerBlock[0], /channel-loading-surface/);
  assert.match(spinnerBlock[0], /channel-loading-spinner/);
  assert.doesNotMatch(spinnerBlock[0], /<text\b|正在|加载中<\/text>/);
  assert.match(styles,
    /\.channel-loading-surface\s*\{[^}]*min-height:\s*calc\(100vh - 302rpx\);[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  assert.match(styles,
    /\.channel-loading-spinner\s*\{[^}]*border-top-color:\s*var\(--ui-accent\);[^}]*animation:\s*feed-loading-spin/s);
  assert.doesNotMatch(markup,
    /channel-tab[^"]*(?:loading|spinner)|(?:loading|spinner)[^"]*channel-tab/);
});

test('keeps the new-items notice as a fixed overlay without shifting the list', () => {
  const markup = read('../pages/inbox/index.wxml');
  const styles = read('../pages/inbox/index.wxss');
  assert.match(styles, /\.new-items-float\s*\{[^}]*position:\s*fixed;/s);
  assert.doesNotMatch(markup, /post-list-noticed/);
  assert.doesNotMatch(styles, /\.post-list-noticed\b/);
});

test('shows the shared loading component during pull-to-refresh', () => {
  const markup = read('../pages/inbox/index.wxml');
  const styles = read('../pages/inbox/index.wxss');
  assert.match(
    markup,
    /wx:if="\{\{refreshingFeed\}\}" class="feed-refresh-float"[\s\S]*?<loading-state[^>]*label="正在刷新资讯"/
  );
  assert.match(styles, /\.feed-refresh-float\s*\{[^}]*position:\s*fixed;/s);
});

test('reserves feed media height while durable cloud files resolve', () => {
  const markup = read('../pages/inbox/index.wxml');
  const styles = read('../pages/inbox/index.wxss');
  assert.equal((markup.match(/class="post-media-shell"/g) || []).length, 1);
  assert.equal((markup.match(/class="post-media-placeholder"/g) || []).length, 1);
  assert.match(markup,
    /wx:if="\{\{postItem\.listVisualFileId \|\| postItem\.visualFileId \|\| postItem\.listVisualUrl\}\}" class="post-media-shell"/);
  assert.equal((markup.match(/<template\s+is="feed-post-card"/g) || []).length, 3);
  assert.match(styles,
    /\.post-media-shell\s*\{[^}]*overflow:\s*hidden;[^}]*height:\s*340rpx;/s);
  assert.match(styles,
    /\.post-media,\s*\.post-media-placeholder\s*\{[^}]*height:\s*100%;/s);
});

test('keeps lazy timeline continuation visible until the selected day is complete', () => {
  const markup = read('../pages/inbox/index.wxml');
  const styles = read('../pages/inbox/index.wxss');

  assert.match(
    markup,
    /itemIndex === dayGroup\.items\.length - 1 && !dayGroup\.hasMore \? 'timeline-entry-end' : ''/
  );
  assert.match(
    markup,
    /wx:if="\{\{dayGroup\.error && dayGroup\.items\.length\}\}"[^>]*aria-role="button"[\s\S]*?timeline-line-stub[\s\S]*?timeline-day-more-button-error[\s\S]*?wx:elif="\{\{dayGroup\.hasMore && dayGroup\.items\.length\}\}"[^>]*aria-role="button"[^>]*aria-label="加载这一天的更多资讯"/
  );
  assert.match(markup, />展开更多<\/text>/);
  assert.match(
    markup,
    /dayGroup\.count > dayGroup\.loadedCount[\s\S]*剩余 \{\{dayGroup\.count - dayGroup\.loadedCount\}\} 条/
  );
  assert.match(styles, /\.timeline-day-more\s*\{[^}]*min-height:\s*92rpx;/s);
  assert.match(styles, /\.timeline-day-more-button\s*\{[^}]*min-height:\s*68rpx;/s);
  assert.match(styles, /\.timeline-line-stub\s*\{[^}]*height:\s*calc\(50% \+ 22rpx\);/s);
});
