const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeMembershipAccess,
  canUseFeature
} = require('../features/membership/access');
const {
  membershipPresentation,
  formatPeriodEnd
} = require('../features/membership/presentation');
const {
  membershipBenefits,
  membershipOffer,
  membershipBillingPresentation
} = require('../features/membership/benefits');
const { membershipPrompt } = require('../features/membership/prompt');
const { createFilterDraftState, decorateFeed } = require('../features/knowledge-feed/list-model');
const { normalizeBriefing, filterBriefing } = require('../features/briefing/model');
const { BRIEFING_SAMPLE } = require('../features/briefing/sample');

test('normalizes the free, Pro and administrator capability matrix', () => {
  const free = normalizeMembershipAccess({ viewer: { role: 'free' } });
  assert.deepEqual(free.entitlements.history, { mode: 'rolling', days: 1 });
  assert.equal(canUseFeature(free, 'history_30d'), false);
  assert.equal(canUseFeature(free, 'curated_feed'), false);
  assert.equal(canUseFeature(free, 'ai_column'), false);
  assert.equal(canUseFeature(free, 'comments'), false);
  assert.equal(canUseFeature(free, 'digests'), false);

  const member = normalizeMembershipAccess({
    viewer: { role: 'member', membershipStatus: 'active' },
    entitlements: {
      history: { mode: 'rolling', days: 30 },
      allowedTimeRanges: ['1d', '3d', '7d', '30d'],
      curatedFeed: true,
      aiColumn: true,
      comments: true,
      digests: ['24h', '7d', '30d']
    }
  });
  assert.equal(canUseFeature(member, 'history_30d'), true);
  assert.equal(canUseFeature(member, 'curated_feed'), true);
  assert.equal(canUseFeature(member, 'ai_column'), true);
  assert.equal(canUseFeature(member, 'comments'), true);
  assert.equal(canUseFeature(member, 'digests'), true);
  assert.equal(canUseFeature(member, 'digest_30d'), true);

  const admin = normalizeMembershipAccess({ viewer: { role: 'admin' } });
  assert.deepEqual(admin.entitlements.history, { mode: 'all' });
  assert.equal(admin.access.defaultTimeKey, 'all');
  assert.equal(canUseFeature(admin, 'digest_24h'), true);
});

test('keeps administrator role-preview controls visible while rendering effective free or Pro access', () => {
  const freePreview = membershipPresentation(normalizeMembershipAccess({
    viewer: {
      role: 'free', actualRole: 'admin', canPreviewRoles: true,
      previewRole: 'free', isRolePreview: true
    }
  }));
  assert.equal(freePreview.roleLabel, '普通用户');
  assert.equal(freePreview.canPreviewRoles, true);
  assert.equal(freePreview.isRolePreview, true);
  assert.equal(freePreview.roleOptions.find((item) => item.key === 'free').active, true);

  const memberPreview = membershipPresentation(normalizeMembershipAccess({
    viewer: {
      role: 'member', actualRole: 'admin', canPreviewRoles: true,
      previewRole: 'member', isRolePreview: true
    }
  }));
  assert.equal(memberPreview.isPrivileged, true);
  assert.equal(memberPreview.roleOptions.find((item) => item.key === 'member').active, true);
});

test('fails closed when a cached paid membership has already reached its period end', () => {
  const expired = membershipPresentation(normalizeMembershipAccess({
    viewer: {
      role: 'member',
      membershipStatus: 'active',
      currentPeriodEnd: '2026-07-19T23:59:59.000Z'
    }
  }), Date.parse('2026-07-20T00:00:00.000Z'));
  assert.equal(expired.role, 'free');
  assert.equal(expired.isPrivileged, false);
  assert.equal(expired.accessExpired, true);
  assert.equal(expired.periodEndLabel, '');
});

test('does not turn a missing membership period end into the Unix epoch', () => {
  assert.equal(formatPeriodEnd(null), '');
  assert.equal(formatPeriodEnd(undefined), '');
  assert.equal(formatPeriodEnd(''), '');
  assert.equal(membershipPresentation({
    viewer: { role: 'member', currentPeriodEnd: null }
  }).periodEndLabel, '');
});

test('keeps the complete Pro benefit list in one model without claiming free engagement actions', () => {
  const benefits = membershipBenefits();
  assert.deepEqual(benefits.map((item) => item.key), [
    'curated', 'courses', 'practicals', 'briefings', 'history', 'comments', 'support'
  ]);
  assert.match(benefits.find((item) => item.key === 'courses').copy, /24 节基础课全文/);
  assert.match(benefits.find((item) => item.key === 'courses').copy, /高清手绘图文/);
  assert.match(benefits.find((item) => item.key === 'practicals').copy, /6 节动手课/);
  assert.match(benefits.find((item) => item.key === 'briefings').copy, /24 小时、7 天和 30 天/);
  assert.match(benefits.find((item) => item.key === 'support').title, /不另外收费/);
  assert.doesNotMatch(JSON.stringify(benefits), /喜欢|收藏功能|分享/);

  const commentPrompt = membershipPrompt('comments');
  assert.equal(commentPrompt.focusBenefit.key, 'comments');
  assert.equal(commentPrompt.benefits[0].key, 'comments');
  assert.deepEqual(
    new Set(commentPrompt.benefits.map((item) => item.key)),
    new Set(benefits.map((item) => item.key))
  );
  assert.doesNotMatch(
    JSON.stringify(membershipPrompt('digests')),
    /影响判断|跟你有什么关系/
  );
});

test('derives the offer, savings and discount only from the server plan amounts', () => {
  const offer = membershipOffer({
    key: 'pro_30d', name: '30 天会员', durationDays: 30,
    priceCents: 590, priceLabel: 'ignored',
    compareAtPriceCents: 1090, compareAtPriceLabel: 'ignored'
  });
  assert.equal(offer.priceLabel, '¥5.9');
  assert.equal(offer.compareAtPriceLabel, '¥10.9');
  assert.equal(offer.savingsCents, 500);
  assert.equal(offer.savingsLabel, '¥5');
  assert.equal(offer.percentOffLabel, '省 46%');
  assert.equal(offer.discountLabel, '5.4 折');
  assert.equal(offer.hasDiscount, true);

  const changedOffer = membershipOffer({
    key: 'pro_30d', durationDays: 30, priceCents: 1200, compareAtPriceCents: 2000
  });
  assert.equal(changedOffer.priceLabel, '¥12');
  assert.equal(changedOffer.discountLabel, '6 折');
  assert.equal(changedOffer.percentOffLabel, '省 40%');
  assert.equal(changedOffer.savingsLabel, '¥8');

  const billing = membershipBillingPresentation({ available: true, plan: {
    key: 'pro_30d', durationDays: 30, priceCents: 590, compareAtPriceCents: 590
  } });
  assert.equal(billing.available, true);
  assert.equal(billing.plan.hasDiscount, false);
  assert.equal(billing.plan.discountLabel, '');
  assert.equal(billing.plan.compareAtPriceLabel, '');

  const unavailable = membershipBillingPresentation({ available: true, plan: {
    key: 'pro_30d', durationDays: 30, priceCents: 0, compareAtPriceCents: 1090
  } });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.plan.hasDiscount, false);
  assert.equal(unavailable.plan.compareAtPriceLabel, '');
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

test('marks the end of a complete free 24-hour feed as a membership boundary', () => {
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
  }, 'all', { time: '1d', company: 'all', direction: 'all' }, [item]);
  assert.equal(view.historyBoundary, true);
});

test('keeps the free briefing example fixed and filterable', () => {
  const briefing = normalizeBriefing(BRIEFING_SAMPLE);
  assert.equal(briefing.sample, true);
  assert.ok(briefing.mustKnow.length >= 3);
  assert.ok(filterBriefing(briefing, 'trend').mustKnow.length > 0);
  assert.equal(briefing.trends, undefined);
});

test('renders four native tabs and a real one-time Pro purchase entry', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['资讯', '专栏', '简报', '我的']);
  const profile = fs.readFileSync(path.resolve(__dirname, '../pages/profile/index.wxml'), 'utf8');
  assert.match(profile, /Pro 会员/);
  assert.match(profile, /wx:for="\{\{membership\.benefits\}\}"/);
  assert.match(profile, /membership\.benefits\.length/);
  assert.match(profile, /membership\.membershipTerms\.supportBoundary/);
  assert.match(profile, /membership\.membershipTerms\.renewalCopy/);
  assert.match(profile, /管理员测试工具/);
  assert.match(profile, /bindtap="selectRolePreview"/);
  assert.match(profile, /billing\.plan\.priceLabel/);
  assert.match(profile, /billing\.plan\.compareAtPriceLabel/);
  assert.match(profile, /billing\.plan\.discountLabel/);
  assert.match(profile, /billing\.plan\.savingsLabel/);
  assert.match(profile, /billing\.plan\.offerTag/);
  assert.match(profile, /pro-offer-compare/);
  assert.match(profile, /当前会员价/);
  assert.match(profile, /bindtap="purchaseMembership"/);
  assert.match(profile, /wx:if="\{\{billing\.available\}\}"/);
  assert.match(profile, /loading="\{\{billing\.purchasing\}\}"/);
  assert.match(profile, /disabled="\{\{billing\.purchasing\}\}"/);
  assert.match(profile, /<button\s+[^>]*class="pro-purchase-button"[^>]*>\s*订阅\s*<\/button>/);
  assert.doesNotMatch(profile, /续费 30 天|立即解锁全部权益|解锁全部 Pro 权益|查看价格并开通 Pro/);
  const profileStyles = fs.readFileSync(path.resolve(__dirname, '../pages/profile/index.wxss'), 'utf8');
  assert.match(profileStyles, /\.pro-pass\s*\{/);
  assert.match(profileStyles, /\.pro-benefit-list\s*\{/);
  assert.match(profileStyles, /\.pro-offer-compare[^}]*text-decoration:\s*line-through/);
  assert.match(profileStyles, /\.pro-purchase-button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(`${profile}\n${profileStyles}`, /pro-pass-rail/);
  assert.doesNotMatch(profileStyles, /\.pro-pass::after/);
  assert.doesNotMatch(profile, /¥(?:5\.9|10\.9)/);

  const prompt = fs.readFileSync(path.resolve(__dirname, '../components/membership-prompt/index.wxml'), 'utf8');
  const promptScript = fs.readFileSync(path.resolve(__dirname, '../components/membership-prompt/index.js'), 'utf8');
  const promptStyles = fs.readFileSync(path.resolve(__dirname, '../components/membership-prompt/index.wxss'), 'utf8');
  assert.match(prompt, /billingPlan\.priceLabel/);
  assert.match(prompt, /billingPlan\.compareAtPriceLabel/);
  assert.match(prompt, /billingPlan\.discountLabel/);
  assert.match(prompt, /billingPlan\.savingsLabel/);
  assert.match(prompt, /billingPlan\.offerTag/);
  assert.match(prompt, /wx:for="\{\{prompt\.benefits\}\}"/);
  assert.match(prompt, /prompt\.benefits\.length/);
  assert.match(prompt, /prompt\.membershipTerms\.supportBoundary/);
  assert.match(prompt, /prompt\.membershipTerms\.renewalCopy/);
  assert.match(prompt, /item\.featured/);
  const promptMaskTag = prompt.match(/<view\b(?=[^>]*class="member-prompt-mask")[^>]*>/)?.[0] || '';
  const promptScrollTag = prompt.match(/<scroll-view\b(?=[^>]*class="member-card-scroll")[^>]*>/)?.[0] || '';
  assert.match(promptMaskTag, /\bcatchtouchmove="stopPropagation"/);
  assert.match(promptScrollTag, /\bscroll-y(?:\s|=|>)/);
  assert.doesNotMatch(prompt, /class="member-benefit-current"|>\s*当前\s*<\/text>/);
  assert.match(prompt, /bindtap="viewBenefits"/);
  assert.match(prompt, /<button\s+[^>]*class="member-primary"[^>]*>\s*订阅\s*<\/button>/);
  assert.doesNotMatch(prompt, /续费 30 天|立即解锁全部权益|解锁全部 Pro 权益|查看价格并开通 Pro/);
  assert.match(promptScript, /loadBillingPlans/);
  assert.match(promptStyles, /\.member-card-scroll\s*\{/);
  assert.match(promptStyles, /\.member-benefit-list\s*\{/);
  assert.match(promptStyles, /\.member-offer-compare[^}]*text-decoration:\s*line-through/);
  assert.match(promptStyles, /\.member-primary\s*\{[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(`${prompt}\n${promptStyles}`, /member-card-rail/);
  assert.doesNotMatch(promptStyles, /\.member-card::after/);
  assert.doesNotMatch(prompt, /¥(?:5\.9|10\.9)/);
});

test('locks every host page while the shared membership prompt is visible', () => {
  const pagesRoot = path.resolve(__dirname, '../pages');
  const promptPages = fs.readdirSync(pagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      file: path.join(pagesRoot, entry.name, 'index.wxml')
    }))
    .filter((entry) => fs.existsSync(entry.file))
    .map((entry) => ({ ...entry, source: fs.readFileSync(entry.file, 'utf8') }))
    .filter((entry) => /<membership-prompt\b/.test(entry.source));

  assert.ok(promptPages.length > 0);
  promptPages.forEach(({ name, source }) => {
    const pageMetaTag = source.match(/^\s*<page-meta\b[^>]*>/)?.[0] || '';
    assert.match(pageMetaTag, /membershipPromptVisible/, `${name} must lock the host page for the membership prompt`);
    assert.match(pageMetaTag, /overflow:\s*hidden;/, `${name} must disable host-page scrolling`);
    if (name === 'feed-detail') {
      assert.match(pageMetaTag, /commentsOpen/, 'feed-detail must preserve the comment-sheet scroll lock');
    }
  });
});

test('free locked pages use fixed samples rather than live member content', () => {
  const featured = fs.readFileSync(path.resolve(__dirname, '../pages/featured/index.wxml'), 'utf8');
  const column = fs.readFileSync(path.resolve(__dirname, '../pages/curated/index.wxml'), 'utf8');
  const briefing = fs.readFileSync(path.resolve(__dirname, '../pages/briefing/index.wxml'), 'utf8');
  assert.match(featured, /体验示例/);
  assert.match(featured, /<membership-prompt/);
  assert.match(featured, /feature-key="\{\{membershipPromptFeature\}\}"/);
  assert.match(featured, /bindtap="openMembershipPrompt"/);
  assert.match(column, /Pro 专属/);
  assert.match(column, /先看懂，再动手/);
  assert.match(column, /基础课/);
  assert.match(column, /动手课/);
  assert.match(briefing, /体验示例/);
  assert.doesNotMatch(featured, /AIHOT|公开 API/);
  assert.doesNotMatch(briefing, /AIHOT|公开 API/);
});

test('keeps direct featured-page access on the shared membership prompt path', () => {
  const featuredScript = fs.readFileSync(path.resolve(__dirname, '../pages/featured/index.js'), 'utf8');
  assert.match(featuredScript, /membershipPromptFeature:\s*'curated_feed'/);
  assert.match(featuredScript, /openMembershipPrompt\(\)/);
  assert.match(featuredScript, /membershipPromptVisible:\s*true/);
  assert.match(featuredScript, /openMembershipFromPrompt\(\)/);
});

test('home channel labels hide counts and render the featured capability lock', () => {
  const inbox = fs.readFileSync(path.resolve(__dirname, '../pages/inbox/index.wxml'), 'utf8');
  assert.match(inbox, /wx:if="\{\{feed\.featuredShortcut\.locked\}\}" class="channel-lock"/);
  assert.doesNotMatch(inbox, /wx:if="\{\{item\.premium\}\}" class="channel-lock"/);
  assert.match(inbox, /new-items-float/);
  assert.match(inbox, /bindtap="applyNewItems"/);
  assert.doesNotMatch(inbox, /class="channel-count"/);
});

test('uses curated feed capability for featured navigation across free, member and admin views', () => {
  const previousPage = global.Page;
  const previousWx = global.wx;
  let definition;
  const navigations = [];
  global.Page = (page) => { definition = page; };
  global.wx = { navigateTo: (options) => navigations.push(options) };
  try {
    const entrypoint = require.resolve('../pages/inbox/index');
    delete require.cache[entrypoint];
    require(entrypoint);
    const prompts = [];
    const context = (role, curatedFeed) => ({
      data: { feed: { viewer: { role }, entitlements: { curatedFeed } } },
      openMembershipPrompt: (featureKey) => prompts.push({ role, featureKey })
    });
    const event = { currentTarget: { dataset: { key: 'featured' } } };
    definition.selectChannel.call(context('free', false), event);
    definition.selectChannel.call(context('member', true), event);
    definition.selectChannel.call(context('admin', true), event);

    assert.deepEqual(prompts, [{ role: 'free', featureKey: 'curated_feed' }]);
    assert.deepEqual(navigations, [
      { url: '/pages/featured/index' },
      { url: '/pages/featured/index' }
    ]);
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('uses AI news wording for the navigation bar and share fallbacks', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../pages/inbox/index.json'), 'utf8'));
  const inboxScript = fs.readFileSync(path.resolve(__dirname, '../pages/inbox/index.js'), 'utf8');
  const detailScript = fs.readFileSync(path.resolve(__dirname, '../pages/feed-detail/index.js'), 'utf8');
  assert.equal(config.navigationBarTitleText, 'AI 资讯');
  assert.match(inboxScript, /一条值得看的 AI 资讯/);
  assert.match(detailScript, /title: item \? item\.title : 'AI 资讯'/);
  assert.doesNotMatch(`${inboxScript}\n${detailScript}`, /知识更新/);
});
