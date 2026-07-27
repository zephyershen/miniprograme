const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('renders AIHOT source tags instead of internal category labels on feed surfaces', () => {
  const inbox = read('../pages/inbox/index.wxml');
  const detail = read('../pages/feed-detail/index.wxml');

  assert.match(inbox, /wx:for="\{\{postItem\.sourceTags\}\}"/);
  assert.match(detail, /wx:for="\{\{item\.sourceTags\}\}"/);
  assert.doesNotMatch(inbox, /categoryLabel/);
  assert.doesNotMatch(detail, /categoryLabel/);
});

test('renders every inbox feed shape through one shared post-card template', () => {
  const inbox = read('../pages/inbox/index.wxml');
  const templateCalls = inbox.match(/<template\s+is="feed-post-card"/g) || [];
  const cardBodies = inbox.match(/class="post post-tone-/g) || [];

  assert.match(inbox, /<template name="feed-post-card">/);
  assert.equal(templateCalls.length, 3);
  assert.equal(cardBodies.length, 1);
  assert.match(inbox, /postItem:\s*dayItem/);
  assert.match(inbox, /postItem:\s*feed\.leadItem/);
  assert.match(inbox, /postItem:\s*item/);
  assert.match(inbox, /data-media-path="\{\{mediaRoot\}\}\.sourceAuthor\.avatarUrl"/);
  assert.match(inbox, /data-media-path="\{\{mediaRoot\}\}\.listVisualUrl"/);
});

test('keeps WeChat v2 buttons shrinkable inside fixed action rows', () => {
  const appStyles = read('../app.wxss');
  const inboxStyles = read('../pages/inbox/index.wxss');
  const featuredStyles = read('../pages/featured/index.wxss');

  assert.match(appStyles, /button\s*\{[^}]*min-width:\s*0;/s);
  assert.match(inboxStyles, /\.filter-reset\s*\{[^}]*width:\s*180rpx;/s);
  assert.match(inboxStyles, /\.filter-apply\s*\{[^}]*flex:\s*1;/s);
  assert.match(featuredStyles, /\.filter-reset\s*\{[^}]*width:\s*170rpx;/s);
  assert.match(featuredStyles, /\.filter-apply\s*\{[^}]*flex:\s*1;/s);
});

test('renders compact source avatars, names and handles with a source-label fallback', () => {
  const inbox = read('../pages/inbox/index.wxml');
  const inboxStyles = read('../pages/inbox/index.wxss');
  const detail = read('../pages/feed-detail/index.wxml');
  const detailStyles = read('../pages/feed-detail/index.wxss');

  [inbox, detail].forEach((markup) => {
    assert.match(markup, /sourceAuthor\.avatarUrl/);
    assert.match(markup, /sourceAuthor\.fallbackAvatarUrl/);
    assert.match(markup, /sourceAuthor\.avatarInitial/);
    assert.match(markup, /sourceAuthor\.displayName/);
    assert.match(markup, /sourceAuthor\.handleLabel/);
    assert.match(markup, /sourceAuthor\.fallbackLabel/);
  });
  assert.doesNotMatch(`${inbox}\n${detail}`, /src="{{[^}]*sourceAuthor\.avatarFileId}}"/);
  assert.match(`${inbox}\n${detail}`, /data-media-fallback="{{[^}]*sourceAuthor\.fallbackAvatarUrl}}"/);
  assert.match(inboxStyles, /\.post-byline\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;/s);
  assert.match(inboxStyles, /\.post-actions\s*\{[^}]*flex:\s*none;/s);
  assert.match(inboxStyles, /\.post-source-tag\s*\{/);
  assert.match(detailStyles, /\.detail-source-tag\s*\{/);
  assert.doesNotMatch(`${inbox}\n${inboxStyles}`, /post-kicker|post-cat/);
});

test('keeps a small visual gap between adjacent timeline cards', () => {
  const inboxStyles = read('../pages/inbox/index.wxss');
  assert.match(inboxStyles,
    /\.timeline-day-body \.timeline-entry \+ \.timeline-entry\s*\{[^}]*margin-top:\s*14rpx;/s);
});

test('never binds durable cloud file ids directly on knowledge feed image surfaces', () => {
  const markup = [
    read('../pages/inbox/index.wxml'),
    read('../pages/feed-detail/index.wxml'),
    read('../pages/featured/index.wxml'),
    read('../pages/cards/index.wxml')
  ].join('\n');

  assert.doesNotMatch(markup, /src="{{[^}]*\b(?:avatar|listVisual|cover)?FileId\b[^}]*}}"/);
  assert.match(markup, /sourceAuthor\.avatarUrl/);
  assert.match(markup, /listVisualUrl/);
  assert.match(markup, /coverUrl/);
});

test('all knowledge feed images have deterministic one-retry error recovery metadata', () => {
  const surfaces = [
    read('../pages/inbox/index.wxml'),
    read('../pages/feed-detail/index.wxml'),
    read('../pages/featured/index.wxml'),
    read('../pages/cards/index.wxml')
  ];

  surfaces.forEach((markup) => {
    const imageTags = markup.match(/<image\b[^>]*\/?\s*>/g) || [];
    assert.ok(imageTags.length >= 1);
    imageTags.forEach((tag) => {
      assert.match(tag, /binderror="handleMediaError"/);
      assert.match(tag, /data-media-key=/);
      assert.match(tag, /data-file-id=/);
      assert.match(tag, /data-media-url=/);
      assert.match(tag, /data-media-path=/);
    });
  });
});
