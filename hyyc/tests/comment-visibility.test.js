const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PRODUCT_FEATURES,
  isProductFeatureEnabled
} = require('../config/product-features.js');
const {
  COMMENT_MESSAGE_KINDS,
  visibleMessagesResult
} = require('../features/messages/visibility.js');
const { membershipBenefits } = require('../features/membership/benefits.js');
const { membershipPresentation } = require('../features/membership/presentation.js');
const { membershipPrompt } = require('../features/membership/prompt.js');

function loadPageDefinition(relativePath) {
  const filename = require.resolve(relativePath);
  const previousModule = require.cache[filename];
  const previousPage = global.Page;
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[filename];
  require(filename);
  if (previousModule) require.cache[filename] = previousModule;
  else delete require.cache[filename];
  if (previousPage) global.Page = previousPage;
  else delete global.Page;
  return definition;
}

function pageSource(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('keeps the review release comment visibility switch deterministically off', () => {
  assert.deepEqual(PRODUCT_FEATURES, { comments: false });
  assert.equal(isProductFeatureEnabled('comments'), false);
  assert.equal(isProductFeatureEnabled('unknown'), false);

  [
    '../pages/inbox/index.js',
    '../pages/feed-detail/index.js',
    '../pages/messages/index.js',
    '../pages/profile/index.js',
    '../pages/profile-edit/index.js'
  ].forEach((filename) => {
    assert.equal(loadPageDefinition(filename).data.commentsEnabled, false, filename);
  });
  assert.equal(loadPageDefinition('../pages/messages/index.js').data.activeMessageTab, 'system');
});

test('hides every comment message kind and recomputes unread from visible notifications', () => {
  const hiddenMessages = [...COMMENT_MESSAGE_KINDS].map((kind, index) => ({
    id: `comment-${index}`,
    kind,
    unread: true
  }));
  const visible = visibleMessagesResult({
    unreadCount: hiddenMessages.length + 4,
    messages: [
      ...hiddenMessages,
      { id: 'legacy-comment-route', kind: 'legacy', openComments: true, unread: true },
      { id: 'legacy-comment-id', kind: 'legacy', commentId: 'comment-1', unread: true },
      { id: 'future-comment-category', kind: 'future_kind', category: 'comments', unread: true },
      {
        id: 'future-comment-route-category',
        kind: 'future_kind',
        route: { category: 'discussion' },
        unread: true
      },
      {
        id: 'future-comment-shadowed-category',
        kind: 'future_kind',
        category: 'system',
        payload: { category: 'comments' },
        unread: true
      },
      {
        id: 'future-comment-payload-route',
        kind: 'future_kind',
        payload: { openComments: true, replyToCommentId: 'comment-2' },
        unread: true
      },
      { id: 'future-comment-uppercase', kind: 'COMMENT_RECEIVED', unread: true },
      { id: 'profile', kind: 'profile_review_approved', unread: true },
      { id: 'membership', kind: 'membership_activated', isRead: true }
    ]
  });

  assert.deepEqual(visible.messages.map((message) => message.id), ['profile', 'membership']);
  assert.equal(visible.interactionCount, 0);
  assert.equal(visible.systemCount, 2);
  assert.equal(visible.unreadCount, 1);
  assert.equal(visible.hasUnread, true);

  const restored = visibleMessagesResult({
    unreadCount: hiddenMessages.length + 4,
    messages: hiddenMessages
  }, Date.now(), { commentsEnabled: true });
  assert.equal(restored.messages.length, hiddenMessages.length);
  assert.equal(restored.unreadCount, hiddenMessages.length + 4);
});

test('gates both comment bubbles, the detail sheet, and comment-only message UI', () => {
  const inbox = pageSource('pages/inbox/index.wxml');
  const detail = pageSource('pages/feed-detail/index.wxml');
  const messages = pageSource('pages/messages/index.wxml');

  assert.match(
    inbox,
    /wx:if="\{\{commentsEnabled\}\}" class="post-action[^"]*"[^>]*catchtap="openComments"/
  );
  assert.equal(
    (inbox.match(/commentsEnabled:\s*commentsEnabled/g) || []).length,
    3,
    'every feed card template invocation must receive the release visibility switch'
  );
  assert.match(
    detail,
    /wx:if="\{\{commentsEnabled\}\}" class="detail-action" bindtap="openComments"/
  );
  assert.match(
    detail,
    /<comment-sheet[\s\S]*wx:if="\{\{commentsEnabled && item && item\.engagement\.canComment\}\}"/
  );
  assert.match(messages, /wx:if="\{\{commentsEnabled\}\}" class="message-tabs"/);
  assert.match(
    messages,
    /wx:if="\{\{commentsEnabled && activeMessageTab === 'interaction'\}\}"/
  );
  assert.match(
    messages,
    /<button\s+wx:if="\{\{commentsEnabled\}\}"\s+class="read-all-action"/
  );
});

test('ignores legacy comment deep links while the release switch is off', () => {
  const definition = loadPageDefinition('../pages/feed-detail/index.js');
  let loadCalls = 0;
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
    loadItem() {
      loadCalls += 1;
    }
  };

  definition.onLoad.call(page, {
    id: 'feed-item',
    comments: '1',
    commentId: 'comment-id'
  });

  assert.equal(loadCalls, 1);
  assert.equal(page.openCommentsAfterLoad, false);
  assert.equal(page.data.focusedCommentId, '');
  assert.equal(page.data.commentsOpen, false);
});

test('does not arm the profile editor to return to comments from an old deep link', () => {
  const definition = loadPageDefinition('../pages/profile-edit/index.js');
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
    loadProfile() {}
  };

  definition.onLoad.call(page, { from: 'comments' });

  assert.equal(page.returnToComments, false);
  assert.equal(page.data.membershipSetup, false);
});

test('does not mark hidden comment notifications read through the bulk action', async () => {
  const definition = loadPageDefinition('../pages/messages/index.js');
  const page = {
    ...definition,
    data: {
      ...JSON.parse(JSON.stringify(definition.data)),
      hasUnread: true,
      messages: [{ id: 'system-message', unread: true, isRead: false }]
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };

  assert.equal(await definition.markAllMessages.call(page), false);
  assert.equal(page.data.messages[0].unread, true);
  assert.equal(page.data.hasUnread, true);
});

test('removes comment claims from visible membership and profile presentation', () => {
  const benefits = membershipBenefits();
  const member = membershipPresentation({
    viewer: { role: 'member', membershipStatus: 'active' }
  });
  const commentPrompt = membershipPrompt('comments');
  const profile = pageSource('pages/profile/index.wxml');
  const profileEditor = pageSource('pages/profile-edit/index.wxml');

  assert.equal(benefits.some((benefit) => benefit.key === 'comments'), false);
  assert.doesNotMatch(JSON.stringify(benefits), /评论/);
  assert.doesNotMatch(member.roleCopy, /评论/);
  assert.equal(commentPrompt.featureKey, 'curated_feed');
  assert.doesNotMatch(JSON.stringify(commentPrompt), /评论/);
  assert.match(profile, /commentsEnabled \?/);
  assert.match(profileEditor, /commentsEnabled \?/);
});

test('uses a neutral envelope for the general message entry instead of a comment bubble', () => {
  const profileStyles = pageSource('pages/profile/index.wxss');

  assert.match(profileStyles, /%3Crect x='3' y='5' width='18' height='14' rx='2'\/%3E/);
  assert.match(profileStyles, /%3Cpath d='M4 7l8 6 8-6'\/%3E/);
  assert.doesNotMatch(profileStyles, /M21 11\.5a8\.38/);
});
