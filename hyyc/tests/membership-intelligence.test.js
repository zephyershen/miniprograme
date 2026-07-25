const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AppError, fail } = require('../cloudfunctions/knowledgeFeed/lib/errors');
const {
  entitlementView,
  createFeedEntitlementService
} = require('../cloudfunctions/knowledgeFeed/services/feed-entitlement-service');
const {
  createRolePreviewService
} = require('../cloudfunctions/knowledgeFeed/services/role-preview-service');
const {
  normalizeMembership,
  membershipActive
} = require('../cloudfunctions/knowledgeFeed/services/membership-service');
const {
  analysisInputHash,
  evaluateAnalysis
} = require('../cloudfunctions/knowledgeFeed/policies/feed-curation');
const { qualityTier } = require('../cloudfunctions/knowledgeFeed/policies/feed-quality');
const {
  analysisJobId,
  analysisPriority,
  analysisJob
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-analysis-job');
const {
  encodePageCursor,
  decodePageCursor
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-item');
const {
  coverageFromDocuments
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-day-index');
const {
  createDisabledIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-provider');
const {
  createFeedAnalysisWorkerService
} = require('../cloudfunctions/knowledgeFeed/services/feed-analysis-worker-service');
const {
  createCuratedFeedQueryService
} = require('../cloudfunctions/knowledgeFeed/services/curated-feed-query-service');
const {
  createDigestQueryService
} = require('../cloudfunctions/knowledgeFeed/services/digest-query-service');

const NOW = Date.parse('2026-07-17T08:00:00.000Z');
const CONFIG = { freeWindowDays: 1, memberWindowDays: 30 };

test('returns capability entitlements for free, member and all-retained admin roles', async () => {
  const service = createFeedEntitlementService({
    accessRepository: {
      get: async (ownerKey) => ownerKey === 'a'.repeat(64)
        ? { role: 'admin', status: 'active' }
        : null
    },
    membershipRepository: {
      get: async (ownerKey) => ownerKey === 'b'.repeat(64)
        ? { planCode: 'pro', status: 'active', currentPeriodEnd: new Date(NOW + 1000) }
        : null
    },
    config: CONFIG,
    now: () => NOW
  });
  const free = await service.resolve({ ownerKey: 'c'.repeat(64) });
  const member = await service.resolve({ ownerKey: 'b'.repeat(64) });
  const admin = await service.resolve({ ownerKey: 'a'.repeat(64) });
  assert.deepEqual(free.entitlements.history, { mode: 'rolling', days: 1 });
  assert.equal(free.entitlements.curatedFeed, false);
  assert.deepEqual(member.entitlements.history, { mode: 'rolling', days: 30 });
  assert.deepEqual(member.entitlements.digests, ['24h', '7d', '30d']);
  assert.deepEqual(admin.entitlements.history, { mode: 'all' });
  assert.equal(admin.access.defaultTimeKey, 'all');
  assert.deepEqual(admin.entitlements.allowedTimeRanges, ['1d', '3d', '7d', '30d', 'all']);
});

test('lets a real administrator preview free and member entitlements without losing admin authority', async () => {
  const grants = new Map([
    ['a'.repeat(64), { role: 'admin', status: 'active', previewRole: 'free' }]
  ]);
  const updates = [];
  const accessRepository = {
    get: async (ownerKey) => grants.get(ownerKey) || null,
    setPreviewRole: async (ownerKey, previewRole, updatedAt) => {
      updates.push({ ownerKey, previewRole, updatedAt });
      grants.set(ownerKey, { ...grants.get(ownerKey), previewRole });
    }
  };
  const entitlementService = createFeedEntitlementService({
    accessRepository,
    membershipRepository: { get: async () => null },
    config: CONFIG,
    now: () => NOW
  });
  const previewService = createRolePreviewService({ accessRepository, now: () => NOW });
  const actor = { ownerKey: 'a'.repeat(64) };

  const free = await entitlementService.resolve(actor);
  assert.equal(free.viewer.role, 'free');
  assert.equal(free.viewer.actualRole, 'admin');
  assert.equal(free.viewer.canPreviewRoles, true);
  assert.equal(free.viewer.isRolePreview, true);
  assert.deepEqual(free.entitlements.history, { mode: 'rolling', days: 1 });

  await previewService.set(actor, 'member');
  const member = await entitlementService.resolve(actor);
  assert.equal(member.viewer.role, 'member');
  assert.equal(member.viewer.membershipStatus, 'active');
  assert.deepEqual(member.entitlements.history, { mode: 'rolling', days: 30 });
  assert.equal(updates.length, 1);

  await assert.rejects(
    () => previewService.set(actor, 'owner'),
    (error) => error.code === 'INVALID_REQUEST'
  );
  await assert.rejects(
    () => createRolePreviewService({
      accessRepository: { get: async () => null }, now: () => NOW
    }).set({ ownerKey: 'b'.repeat(64) }, 'admin'),
    (error) => error.code === 'ADMIN_REQUIRED'
  );
});

test('expires stale memberships while retaining cancel-at-period-end access until period end', () => {
  const active = {
    planCode: 'pro', status: 'active', renewalState: 'cancel_at_period_end',
    currentPeriodEnd: new Date(NOW + 1000)
  };
  assert.equal(membershipActive(active, NOW), true);
  assert.equal(normalizeMembership({ ...active, currentPeriodEnd: new Date(NOW - 1) }, NOW).status, 'expired');
});

test('preserves the structured entitlement feature key and drops arbitrary details', () => {
  const result = fail(new AppError('ENTITLEMENT_REQUIRED', 'locked', {
    featureKey: 'curated_feed', internalPrompt: 'secret'
  }));
  assert.deepEqual(result.error, {
    code: 'ENTITLEMENT_REQUIRED', message: 'locked', featureKey: 'curated_feed'
  });
});

test('does not treat upstream selected as member curation and scores local analysis deterministically', () => {
  assert.equal(qualityTier({ selected: true }), 'standard');
  const result = evaluateAnalysis({
    importance: 90, novelty: 80, sourceTrust: 90, evidence: 80, actionability: 70,
    duplicatePenalty: 0, shortReason: '一手发布 · 重大模型更新'
  });
  assert.equal(result.qualityTier, 'curated');
  assert.ok(result.curationScore >= 70);
  assert.equal(result.curationReason, '一手发布 · 重大模型更新');
});

test('analysis identity ignores popularity and upstream selection changes', () => {
  const item = {
    id: 'item0001', title: 'Title', summary: 'Summary', url: 'https://example.com',
    source: 'Example', category: 'ai', channelKey: 'ai', topicKeys: ['company:test'],
    score: 10, selected: false
  };
  assert.equal(analysisInputHash(item), analysisInputHash({ ...item, score: 99, selected: true }));
  const config = { provider: 'test', policyVersion: 1 };
  const first = analysisJob(item, config, new Date(NOW));
  const second = analysisJob({ ...item, score: 99 }, config, new Date(NOW));
  assert.equal(first._id, second._id);
  assert.equal(first._id, analysisJobId('test', item.id, first.expectedInputHash, 1));
});

test('prioritizes newly published analysis work over the historical backlog', () => {
  assert.ok(analysisPriority({ publishedAt: '2026-07-19T00:00:00.000Z' }, 1000)
    > analysisPriority({ publishedAt: '2026-06-19T00:00:00.000Z' }, 1000));
  assert.equal(analysisPriority({}, 1000), 1000);
});

test('keeps the production intelligence worker idle while no provider is configured', async () => {
  const service = createFeedAnalysisWorkerService({
    provider: createDisabledIntelligenceProvider(),
    jobRepository: { listDue: async () => { throw new Error('must not query jobs'); } },
    itemRepository: {}, analysisRepository: {},
    config: { jobsPerCycle: 2, maxAttempts: 8 }
  });
  assert.deepEqual(await service.run(), { status: 'disabled', attempted: 0, results: [] });
});

test('gates curated and rolling digest reads without leaking live member content', async () => {
  const free = entitlementView('free', CONFIG);
  const member = entitlementView('member', CONFIG);
  const curated = createCuratedFeedQueryService({
    itemFeedQueryService: { getFeed: async (input) => ({ mode: input.mode, sort: input.sort }) }
  });
  await assert.rejects(() => curated.getFeed({}, free), (error) => (
    error.code === 'ENTITLEMENT_REQUIRED' && error.details.featureKey === 'curated_feed'
  ));
  assert.deepEqual(await curated.getFeed({}, member), {
    mode: 'curated',
    sort: 'importance'
  });

  const digestDocument = {
    _id: 'digest_24h_20260717', windowKey: '24h', status: 'published',
    generatedAt: new Date(NOW), executiveSummary: '今日重点',
    references: [{ itemId: 'item0001', title: 'Snapshot', summary: 'Saved' }]
  };
  const digests = createDigestQueryService({
    digestRepository: {
      latest: async () => digestDocument,
      get: async () => digestDocument
    },
    itemFeedQueryService: {
      getItem: async () => { throw new AppError('ITEM_NOT_FOUND', 'gone'); }
    }
  });
  await assert.rejects(() => digests.getDigest('24h', free), (error) => (
    error.code === 'ENTITLEMENT_REQUIRED' && error.details.featureKey === 'digest_24h'
  ));
  assert.equal((await digests.getDigest('24h', member)).digest.executiveSummary, '今日重点');
  const reference = await digests.getReference('digest_24h_20260717', 'item0001', member);
  assert.equal(reference.mode, 'snapshot');
  assert.equal(reference.item.title, 'Snapshot');
});

test('keeps backend analysis and moderation mechanics out of user-facing copy', () => {
  const userFacingFiles = [
    '../pages/featured/index.wxml',
    '../pages/briefing/index.wxml',
    '../components/comment-sheet/index.js',
    '../features/membership/prompt.js',
    '../cloudfunctions/knowledgeFeed/services/comment-moderation-service.js',
    '../cloudfunctions/knowledgeFeed/services/curated-feed-query-service.js',
    '../cloudfunctions/knowledgeFeed/services/digest-query-service.js'
  ];
  const forbidden = /AI 正在|AI 自动|由 AI|云端 AI|AI 用量|模型 Token|分析服务启用|真实分析服务|aiDisclosure|当前数据覆盖不完整|结论仅代表已收录范围/;
  userFacingFiles.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.doesNotMatch(content, forbidden, relativePath);
  });
});

test('keeps launch copy free of internal-test and incomplete-coverage notices', () => {
  const userFacingFiles = [
    '../pages/featured/index.wxml',
    '../pages/briefing/index.wxml',
    '../pages/curated/index.wxml',
    '../pages/profile/index.wxml',
    '../pages/profile/index.js',
    '../pages/membership/index.wxml',
    '../pages/membership/index.js',
    '../features/membership/prompt.js'
  ];
  const forbidden = /内测中|不会在这里发起扣款|数据仍在持续补全|完整起点/;
  userFacingFiles.forEach((relativePath) => {
    const content = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.doesNotMatch(content, forbidden, relativePath);
  });
});

test('encodes stable latest, heat and importance cursors', () => {
  const item = {
    _id: 'test_item0001', publishedAt: '2026-07-17T01:00:00.000Z', score: 88,
    curationScore: 92
  };
  for (const sort of ['latest', 'hot', 'importance']) {
    const encoded = encodePageCursor(item, sort);
    const decoded = decodePageCursor(encoded, sort);
    assert.equal(decoded.id, item._id);
    assert.equal(decoded.publishedAt, item.publishedAt);
  }
});

test('reports the oldest continuous all-mode day without claiming curated history is complete', () => {
  assert.deepEqual(coverageFromDocuments([
    { date: '2026-07-17', coverage: 'all' },
    { date: '2026-07-16', coverage: 'all' },
    { date: '2026-07-15', coverage: 'daily-curated' },
    { date: '2026-07-14', coverage: 'all' }
  ]), { completeFrom: '2026-07-16', partialDayCount: 1 });
});

test('keeps maintenance actions outside the public knowledge feed router', () => {
  const source = fs.readFileSync(path.join(
    __dirname, '../cloudfunctions/knowledgeFeed/index.js'
  ), 'utf8');
  assert.doesNotMatch(source, /grantAdmin:\s|maintenance:\s|seedVisuals:\s|runVisuals:\s/);
  assert.match(source, /entitlements:\s*async/);
  assert.match(source, /setRolePreview:\s*async/);
  assert.match(source, /event\.mode === 'curated'/);
});
