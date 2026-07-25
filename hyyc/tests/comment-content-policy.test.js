const test = require('node:test');
const assert = require('node:assert/strict');

const {
  commentContainsLink: clientContainsLink
} = require('../features/engagement/comment-policy');
const {
  commentContainsLink: serverContainsLink
} = require('../cloudfunctions/knowledgeFeed/policies/comment-content-policy');
const {
  COMMENT_MODERATION_INSTRUCTIONS
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-prompts');
const {
  createFeedEngagementService,
  normalizeCommentContent
} = require('../cloudfunctions/knowledgeFeed/services/feed-engagement-service');

const LINK_CASES = [
  '看看 https://example.com/a',
  '访问 www.example.com',
  'example.com',
  'example．com',
  'example 点 com',
  'example dot com',
  'http：／／example.com',
  '联系 me@example.com',
  '服务器 192.168.1.10',
  '#小程序://示例/abc'
];

const SAFE_CASES = [
  '这个判断有依据，我同意其中第二点。',
  'HTTP 是一种网络协议，但这里没有发链接。',
  '模型名称是 GPT-5.6。',
  '这次更新对普通用户有什么影响？'
];

test('client and server reject direct, full-width and obfuscated links consistently', () => {
  LINK_CASES.forEach((value) => {
    assert.equal(clientContainsLink(value), true, value);
    assert.equal(serverContainsLink(value), true, value);
  });
  SAFE_CASES.forEach((value) => {
    assert.equal(clientContainsLink(value), false, value);
    assert.equal(serverContainsLink(value), false, value);
  });
});

test('the authoritative service rejects links before a comment is queued', () => {
  LINK_CASES.forEach((value) => {
    assert.throws(
      () => normalizeCommentContent(value),
      (error) => error
        && error.code === 'COMMENT_LINK_NOT_ALLOWED'
        && /不能包含链接/.test(error.message)
    );
  });
});

test('the authoritative service deletes staged images when a link is rejected', async () => {
  const ownerKey = 'a'.repeat(64);
  const discarded = [];
  const service = createFeedEngagementService({
    repository: {},
    commentReviewRepository: {
      async findByMutation() {
        return null;
      },
      async enqueue() {
        throw new Error('LINKED_COMMENT_MUST_NOT_BE_ENQUEUED');
      }
    },
    profileRepository: {
      async get() {
        return {
          nickname: '测试用户',
          avatarFileId: 'cloud://env/avatar.jpg',
          moderation: { status: 'approved' }
        };
      }
    },
    itemLoader: async () => ({ id: 'item-0001' }),
    userMediaService: {
      async discardUnpublished(actor, kind, fileIds) {
        discarded.push({ actor, kind, fileIds });
      }
    },
    config: {
      commentMaxLength: 280,
      commentImageLimit: 3,
      userMediaStagingFileIdPrefix: 'cloud://env/user-media/staging/',
      commentReviewMediaTtlMs: 60_000
    },
    now: () => Date.parse('2026-07-25T00:00:00.000Z')
  });

  await assert.rejects(
    () => service.addComment(
      'item-0001',
      {
        content: '请访问 example.com',
        attachments: [{ fileId: 'cloud://env/user-media/staging/comment.jpg' }],
        clientMutationId: 'mutation-1'
      },
      { ownerKey },
      {
        entitlements: { comments: true },
        viewer: { isActualAdmin: false }
      }
    ),
    (error) => error && error.code === 'COMMENT_LINK_NOT_ALLOWED'
  );
  assert.deepEqual(discarded, [{
    actor: { ownerKey },
    kind: 'comment',
    fileIds: ['cloud://env/user-media/staging/comment.jpg']
  }]);
});

test('AI moderation explicitly rejects promotion, diversion, links and illegal activity', () => {
  assert.match(COMMENT_MODERATION_INSTRUCTIONS, /推广、广告、软文、带货/);
  assert.match(COMMENT_MODERATION_INSTRUCTIONS, /微信号、QQ、手机号、邮箱、二维码/);
  assert.match(COMMENT_MODERATION_INSTRUCTIONS, /不允许发布任何链接/);
  assert.match(COMMENT_MODERATION_INSTRUCTIONS, /诈骗、赌博、毒品、色情/);
  assert.match(COMMENT_MODERATION_INSTRUCTIONS, /图片要同时检查二维码、联系方式、广告素材和违法内容/);
});
