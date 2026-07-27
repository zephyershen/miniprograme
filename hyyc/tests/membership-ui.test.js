const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeMembershipAccess,
  memberPurchasesEnabled,
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
  assert.equal(memberPurchasesEnabled(free), false);

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
  assert.equal(freePreview.isActiveMember, false);
  assert.equal(freePreview.purchaseMode, 'subscribe');
  assert.equal(freePreview.canPreviewRoles, true);
  assert.equal(freePreview.isRolePreview, true);
  assert.equal(freePreview.roleOptions.find((item) => item.key === 'free').active, true);

  const memberPreview = membershipPresentation(normalizeMembershipAccess({
    viewer: {
      role: 'member', actualRole: 'admin', canPreviewRoles: true,
      previewRole: 'member', isRolePreview: true
    }
  }));
  assert.equal(memberPreview.isActiveMember, false);
  assert.equal(memberPreview.purchaseMode, 'renew');
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
  assert.equal(expired.isActiveMember, false);
  assert.equal(expired.purchaseMode, 'subscribe');
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

test('presents an active membership as renewable with its explicit period end', () => {
  const active = membershipPresentation(normalizeMembershipAccess({
    viewer: {
      role: 'member',
      membershipStatus: 'active',
      currentPeriodEnd: '2026-09-22T08:00:00.000Z'
    }
  }), Date.parse('2026-07-24T08:00:00.000Z'));

  assert.equal(active.isActiveMember, true);
  assert.equal(active.purchaseMode, 'renew');
  assert.equal(active.periodEndLabel, '2026.09.22');
});

test('keeps the complete Pro benefit list in one model without claiming free engagement actions', () => {
  const benefits = membershipBenefits();
  assert.deepEqual(benefits.map((item) => item.key), [
    'curated', 'courses', 'practicals', 'briefings', 'history', 'comments', 'support'
  ]);
  assert.match(benefits.find((item) => item.key === 'courses').copy, /持续更新的基础课全文/);
  assert.match(benefits.find((item) => item.key === 'courses').title, /高清手绘图文/);
  assert.match(benefits.find((item) => item.key === 'practicals').copy, /持续更新的动手课/);
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

  const billing = membershipBillingPresentation(
    { available: true, plan: {
      key: 'pro_30d', durationDays: 30, priceCents: 590, compareAtPriceCents: 590
    } },
    { memberPurchases: true, mutationsAllowed: true }
  );
  assert.equal(billing.available, true);
  assert.equal(billing.plan.hasDiscount, false);
  assert.equal(billing.plan.discountLabel, '');
  assert.equal(billing.plan.compareAtPriceLabel, '');

  const unavailable = membershipBillingPresentation(
    { available: true, plan: {
      key: 'pro_30d', durationDays: 30, priceCents: 0, compareAtPriceCents: 1090
    } },
    { memberPurchases: true, mutationsAllowed: true }
  );
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.plan.hasDiscount, false);
  assert.equal(unavailable.plan.compareAtPriceLabel, '');

  const serverReady = {
    available: true,
    plan: { key: 'pro_30d', durationDays: 30, priceCents: 590 }
  };
  assert.equal(membershipBillingPresentation(serverReady).available, false);
  assert.equal(membershipBillingPresentation(
    serverReady,
    { memberPurchases: true, mutationsAllowed: false }
  ).available, false);
  assert.equal(membershipBillingPresentation(
    serverReady,
    { memberPurchases: false, mutationsAllowed: true }
  ).available, false);
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

test('renders four native tabs and a state-aware Pro purchase or renewal entry', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['资讯', '专栏', '简报', '我的']);
  assert.equal(app.pages.includes('pages/membership/index'), true);

  const profile = fs.readFileSync(path.resolve(__dirname, '../pages/profile/index.wxml'), 'utf8');
  const profileScript = fs.readFileSync(path.resolve(__dirname, '../pages/profile/index.js'), 'utf8');
  assert.match(profile, /class="user-role-badge/);
  assert.match(profile, /catchtap="openMembership"/);
  assert.match(profile, /list-row list-row-vip/);
  assert.match(profile, /会员中心/);
  assert.match(profile, /bindtap="openMembership"/);
  assert.match(profile, /\{\{membership\.roleLabel\}\}/);
  assert.match(profile, /管理员测试工具/);
  assert.match(profile, /bindtap="selectRolePreview"/);
  assert.match(profileScript, /openMembership\(\)/);
  assert.doesNotMatch(profile, /bindtap="logoutWechatAccount"|退出登录/);
  assert.doesNotMatch(profileScript, /logoutWechatAccount|logoutViewerAccountSession/);
  assert.doesNotMatch(profile, /bindtap="purchaseMembership"/);
  assert.doesNotMatch(profileScript, /purchaseMembership|loadBillingPlans/);
  assert.doesNotMatch(profile, /¥(?:5\.9|10\.9)/);

  const membership = fs.readFileSync(path.resolve(__dirname, '../pages/membership/index.wxml'), 'utf8');
  const membershipScript = fs.readFileSync(path.resolve(__dirname, '../pages/membership/index.js'), 'utf8');
  assert.match(membership, /Pro 会员/);
  assert.match(membership, /wx:for="\{\{membership\.benefits\}\}"/);
  assert.match(membership, /membership\.benefits\.length/);
  assert.match(membership, /membership\.membershipTerms\.supportBoundary/);
  assert.match(membership, /membership\.membershipTerms\.renewalCopy/);
  assert.match(membership, /billing\.plan\.priceLabel/);
  assert.match(membership, /billing\.plan\.compareAtPriceLabel/);
  assert.match(membership, /billing\.plan\.discountLabel/);
  assert.match(membership, /billing\.plan\.savingsLabel/);
  assert.match(membership, /billing\.plan\.offerTag/);
  assert.match(membership, /pro-offer-compare/);
  assert.match(membership, /当前会员价/);
  assert.match(membership, /bindtap="purchaseMembership"/);
  assert.match(membership, /wx:if="\{\{billing\.available && account\.verified\}\}"/);
  assert.match(membership, /loading="\{\{billing\.purchasing\}\}"/);
  assert.match(membership, /disabled="\{\{billing\.purchasing\}\}"/);
  assert.match(membership, /订阅并支付/);
  assert.match(membership, /membership\.purchaseMode === 'renew'/);
  assert.match(membership, /membership\.purchaseMode === 'renew' \? '续费' : '订阅并支付'/);
  assert.doesNotMatch(membership, /\? '续费 ' \+/);
  assert.match(membership, /当前有效期至 \{\{membership\.periodEndLabel\}\}/);
  assert.match(membership, /从该日顺延 \{\{billing\.plan\.durationLabel \|\| '30 天'\}\}/);
  assert.match(membership, /会员有效期会继续累加/);
  assert.match(membership, /直接进入系统收银台/);
  assert.match(membership, /微信不允许自动读取真实头像昵称/);
  assert.match(membership, /class="membership-contact"/);
  assert.match(membership, /会员咨询/);
  assert.match(membership, /bindtap="copyWechatContact"/);
  assert.match(membership, /复制微信号 \{\{wechatContact\}\}/);
  assert.match(membershipScript, /const WECHAT_CONTACT = 'MrShenzf'/);
  assert.match(membershipScript, /wx\.setClipboardData\(\{\s*data: WECHAT_CONTACT/s);
  assert.match(membershipScript, /微信号已复制/);
  assert.doesNotMatch(membership, /使用当前微信账号登录|bindtap="logoutWechatAccount"|已完成订阅账号验证/);
  assert.doesNotMatch(membershipScript, /verifyMembershipAccount|loginWechatAccount|loginForPayment|logoutViewerAccountSession/);
  assert.match(membershipScript, /checkoutMembership/);
  assert.doesNotMatch(membershipScript, /confirmWechatAccountPayment/);
  assert.doesNotMatch(membershipScript, /wx\.getUserProfile|wx\.getUserInfo/);
  assert.doesNotMatch(membership, /立即解锁全部权益|解锁全部 Pro 权益|查看价格并开通 Pro/);
  const membershipStyles = fs.readFileSync(path.resolve(__dirname, '../pages/membership/index.wxss'), 'utf8');
  assert.match(membershipStyles, /\.pro-pass\s*\{/);
  assert.match(membershipStyles, /\.pro-benefit-list\s*\{/);
  assert.match(membershipStyles, /\.pro-current-period\s*\{/);
  assert.match(membershipStyles, /\.pro-offer-compare[^}]*text-decoration:\s*line-through/);
  assert.match(membershipStyles, /\.pro-purchase-button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(membershipStyles, /\.membership-contact\s*\{/);
  assert.match(membershipStyles, /\.membership-contact-handle text\s*\{/);
  assert.doesNotMatch(`${membership}\n${membershipStyles}`, /pro-pass-rail/);
  assert.doesNotMatch(membershipStyles, /\.pro-pass::after/);
  assert.doesNotMatch(membership, /¥(?:5\.9|10\.9)/);

  const appScript = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  assert.match(appScript, /initializeViewerSession\(true\)/);
  assert.match(appScript, /ensureViewerAccountSession/);

  const profileEditor = fs.readFileSync(path.resolve(__dirname, '../pages/profile-edit/index.wxml'), 'utf8');
  const profileEditorScript = fs.readFileSync(path.resolve(__dirname, '../pages/profile-edit/index.js'), 'utf8');
  assert.match(profileEditor, /微信资料 · 可选/);
  assert.match(profileEditor, /暂不设置，返回订阅/);
  assert.match(profileEditor, /open-type="chooseAvatar"/);
  assert.match(profileEditor, /type="nickname"/);
  assert.match(profileEditorScript, /options\.from === 'membership'/);
  assert.doesNotMatch(profileEditorScript, /getUserProfile|getUserInfo/);

  const prompt = fs.readFileSync(path.resolve(__dirname, '../components/membership-prompt/index.wxml'), 'utf8');
  const promptScript = fs.readFileSync(path.resolve(__dirname, '../components/membership-prompt/index.js'), 'utf8');
  const promptStyles = fs.readFileSync(path.resolve(__dirname, '../components/membership-prompt/index.wxss'), 'utf8');
  assert.match(prompt, /billingPlan\.priceLabel/);
  assert.match(prompt, /billingPlan\.compareAtPriceLabel/);
  assert.match(prompt, /billingPlan\.discountLabel/);
  assert.match(prompt, /billingPlan\.savingsLabel/);
  assert.match(prompt, /billingPlan\.offerTag/);
  assert.match(prompt, /billingAvailable/);
  assert.match(prompt, /wx:for="\{\{prompt\.benefits\}\}"/);
  assert.match(prompt, /prompt\.benefits\.length/);
  assert.match(prompt, /prompt\.membershipTerms\.supportBoundary/);
  assert.match(prompt, /prompt\.membershipTerms\.renewalCopy/);
  assert.match(prompt, /item\.featured/);
  assert.match(prompt, /暂不可购买/);
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

test('copies the membership contact WeChat id from the page footer', () => {
  const previousPage = global.Page;
  const previousWx = global.wx;
  let definition;
  let clipboardValue = '';
  const toasts = [];
  global.Page = (page) => { definition = page; };
  global.wx = {
    setClipboardData: ({ data, success }) => {
      clipboardValue = data;
      success();
    },
    showToast: (options) => toasts.push(options)
  };
  try {
    const entrypoint = require.resolve('../pages/membership/index');
    delete require.cache[entrypoint];
    require(entrypoint);
    definition.copyWechatContact.call({ pageDisposed: false });
    assert.equal(clipboardValue, 'MrShenzf');
    assert.deepEqual(toasts, [{ title: '微信号已复制', icon: 'success' }]);
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
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

test('home channel labels hide counts and render the featured premium label', () => {
  const inbox = fs.readFileSync(path.resolve(__dirname, '../pages/inbox/index.wxml'), 'utf8');
  const inboxStyle = fs.readFileSync(path.resolve(__dirname, '../pages/inbox/index.wxss'), 'utf8');
  assert.match(inbox, /class="featured-label">\{\{feed\.featuredShortcut\.label\}\}/);
  assert.doesNotMatch(inbox, /class="channel-lock"/);
  assert.match(inboxStyle, /\.featured-label\s*\{[^}]*background-clip:\s*text/);
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
