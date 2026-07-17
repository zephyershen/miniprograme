const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeMembershipAccess,
  canUseFeature
} = require('../features/membership/access');
const { createFilterDraftState, decorateFeed } = require('../features/knowledge-feed/list-model');
const { normalizeBriefing, filterBriefing } = require('../features/briefing/model');
const { BRIEFING_SAMPLE } = require('../features/briefing/sample');

test('normalizes the free, Pro and administrator capability matrix', () => {
  const free = normalizeMembershipAccess({ viewer: { role: 'free' } });
  assert.deepEqual(free.entitlements.history, { mode: 'rolling', days: 7 });
  assert.equal(canUseFeature(free, 'history_30d'), false);
  assert.equal(canUseFeature(free, 'curated_feed'), false);

  const member = normalizeMembershipAccess({
    viewer: { role: 'member', membershipStatus: 'active' },
    entitlements: {
      history: { mode: 'rolling', days: 30 },
      allowedTimeRanges: ['1d', '3d', '7d', '30d'],
      curatedFeed: true,
      digests: ['24h', '7d', '30d']
    }
  });
  assert.equal(canUseFeature(member, 'history_30d'), true);
  assert.equal(canUseFeature(member, 'curated_feed'), true);
  assert.equal(canUseFeature(member, 'digest_30d'), true);

  const admin = normalizeMembershipAccess({ viewer: { role: 'admin' } });
  assert.deepEqual(admin.entitlements.history, { mode: 'all' });
  assert.equal(admin.access.defaultTimeKey, 'all');
  assert.equal(canUseFeature(admin, 'digest_24h'), true);
});

test('shows a locked 30-day choice to free users without exposing a count', () => {
  const draft = createFilterDraftState({
    viewer: { role: 'free' },
    facets: []
  }, 'all', { time: '7d', company: 'all', direction: 'all' });
  const option = draft.filterOptions.time.find((item) => item.key === '30d');
  assert.equal(option.locked, true);
  assert.equal(option.disabled, false);
  assert.equal(option.count, '');
});

test('marks the end of a complete free seven-day feed as a membership boundary', () => {
  const item = {
    id: 'recent',
    title: 'Recent item',
    publishedAt: new Date().toISOString(),
    channelKey: 'ai',
    topicKeys: []
  };
  const view = decorateFeed({
    items: [item],
    facets: [item],
    hasMore: false,
    viewer: { role: 'free' }
  }, 'all', { time: '7d', company: 'all', direction: 'all' }, [item]);
  assert.equal(view.historyBoundary, true);
});

test('keeps the free briefing example fixed and filterable', () => {
  const briefing = normalizeBriefing(BRIEFING_SAMPLE);
  assert.equal(briefing.sample, true);
  assert.ok(briefing.mustKnow.length >= 3);
  assert.ok(filterBriefing(briefing, 'trend').trends.length > 0);
});

test('renders four native tabs and never shows price or a payment button during internal testing', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['资讯', '精选', '简报', '我的']);
  const profile = fs.readFileSync(path.resolve(__dirname, '../pages/profile/index.wxml'), 'utf8');
  assert.match(profile, /会员能力内测中/);
  assert.doesNotMatch(profile, /立即支付|购买会员|¥|￥/);
});

test('free locked pages use fixed samples rather than live member content', () => {
  const curated = fs.readFileSync(path.resolve(__dirname, '../pages/curated/index.wxml'), 'utf8');
  const briefing = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxml'), 'utf8');
  assert.match(curated, /固定示例/);
  assert.match(briefing, /固定完整示例/);
  assert.doesNotMatch(curated, /AIHOT|公开 API/);
  assert.doesNotMatch(briefing, /AIHOT|公开 API/);
});
