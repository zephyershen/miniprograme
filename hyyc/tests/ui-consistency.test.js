const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.resolve(APP_ROOT, relativePath), 'utf8');
}

function collectFiles(relativeRoot, extension) {
  const root = path.resolve(APP_ROOT, relativeRoot);
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) return collectFiles(relativePath, extension);
    return entry.name.endsWith(extension) ? [path.resolve(APP_ROOT, relativePath)] : [];
  });
}

test('uses the platform font stack with tabular numerals instead of an iOS-only face', () => {
  const styleFiles = [
    path.resolve(APP_ROOT, 'app.wxss'),
    ...collectFiles('components', '.wxss'),
    ...collectFiles('features', '.wxss'),
    ...collectFiles('pages', '.wxss')
  ];
  const styles = styleFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  assert.doesNotMatch(styles, /DIN Alternate/);
  assert.match(read('app.wxss'), /page\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
});

test('keeps every feed engagement action at least forty-four logical pixels wide and high', () => {
  const styles = read('pages/inbox/index.wxss');

  assert.match(styles, /\.post-action\s*\{[^}]*min-width:\s*88rpx;[^}]*height:\s*88rpx;/s);
  assert.match(styles, /button\.post-share\s*\{[^}]*width:\s*88rpx;[^}]*min-height:\s*88rpx;[^}]*flex:\s*0 0 88rpx;/s);
});

test('keeps filter choices tappable and uses text nodes for non-form copy', () => {
  const inboxStyles = read('pages/inbox/index.wxss');
  const inboxMarkup = read('pages/inbox/index.wxml');
  const featuredStyles = read('pages/featured/index.wxss');
  const textOnlyMarkup = [
    read('pages/curated/index.wxml'),
    read('pages/search/index.wxml'),
    read('pages/membership/index.wxml')
  ];

  assert.match(inboxStyles, /\.filter-choice\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(inboxStyles, /\.filter-bar\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(inboxStyles, /\.sort-choice\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(inboxStyles, /\.feed-search-shortcut\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(inboxMarkup, /aria-label="搜索资讯、GitHub、会员专栏与知识简报"/);
  assert.match(featuredStyles, /\.filter-option\s*\{[^}]*min-height:\s*88rpx;/s);
  textOnlyMarkup.forEach((markup) => assert.doesNotMatch(markup, /<label\b/));
});

test('keeps the shared grayscale tokens centralized and removes confirmed dead selectors', () => {
  const tokens = read('styles/design-tokens.wxss');
  const curated = read('pages/curated/index.wxss');
  const appStyles = read('app.wxss');
  const removedSelectors = [
    'button-row',
    'row-status',
    'inline-state',
    'pagination-action',
    'pagination-note'
  ];

  [
    '--ui-surface-hover',
    '--ui-skeleton-highlight',
    '--ui-ink-soft',
    '--ui-muted-strong',
    '--ui-muted-soft',
    '--ui-rule-strong',
    '--ui-on-accent'
  ].forEach((token) => assert.match(tokens, new RegExp(`${token}:`)));

  assert.match(curated, /color:\s*var\(--ui-ink\)/);
  assert.match(curated, /color:\s*var\(--ui-muted-soft\)/);
  assert.match(curated, /border-bottom:\s*1rpx solid var\(--ui-rule-strong\)/);

  removedSelectors.forEach((selector) => {
    assert.doesNotMatch(`${appStyles}\n${curated}`, new RegExp(`\\.${selector}\\b`));
  });
});

test('uses design tokens instead of page-local hex colors', () => {
  const styleFiles = [
    ...collectFiles('components', '.wxss'),
    ...collectFiles('features', '.wxss'),
    ...collectFiles('pages', '.wxss')
  ];
  styleFiles.forEach((file) => {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /#[0-9a-f]{3,8}\b/i,
      `${path.relative(APP_ROOT, file)} contains a hard-coded color`
    );
  });
});

test('uses one shared actionable empty state across public content surfaces', () => {
  const appConfig = JSON.parse(read('app.json'));
  const componentMarkup = read('components/empty-state/index.wxml');
  const componentStyles = read('components/empty-state/index.wxss');
  const hostMarkup = [
    read('pages/inbox/index.wxml'),
    read('pages/featured/index.wxml'),
    read('pages/briefing/index.wxml'),
    read('pages/curated/index.wxml'),
    read('pages/column-reader/index.wxml'),
    read('pages/trend-detail/index.wxml'),
    read('pages/messages/index.wxml'),
    read('pages/cards/index.wxml'),
    read('pages/membership/index.wxml'),
    read('pages/profile/index.wxml'),
    read('pages/column-admin/index.wxml'),
    read('pages/column-editor/index.wxml')
  ];

  assert.equal(
    appConfig.usingComponents['empty-state'],
    '/components/empty-state/index'
  );
  hostMarkup.forEach((markup) => assert.match(markup, /<empty-state\b/));
  assert.match(componentMarkup, /wx:if="\{\{actionLabel\}\}"/);
  assert.match(componentMarkup, /bindtap="handleAction"/);
  assert.match(componentStyles, /\.empty-state-action\s*\{[^}]*min-height:\s*88rpx;/s);
});

test('uses one shared skeleton treatment on long-form loading surfaces', () => {
  const appConfig = JSON.parse(read('app.json'));
  const component = read('components/skeleton-state/index.wxml');
  const hosts = [
    read('pages/inbox/index.wxml'),
    read('pages/briefing/index.wxml'),
    read('pages/curated/index.wxml'),
    read('pages/column-reader/index.wxml'),
    read('pages/trend-detail/index.wxml')
  ];
  assert.equal(
    appConfig.usingComponents['skeleton-state'],
    '/components/skeleton-state/index'
  );
  assert.match(component, /aria-role="progressbar"/);
  hosts.forEach((markup) => assert.match(markup, /<skeleton-state\b/));
});

test('keeps sharing enabled on the directory, briefing, membership, and search pages', () => {
  [
    read('pages/curated/index.js'),
    read('pages/briefing/index.js'),
    read('pages/membership/index.js'),
    read('pages/search/index.js')
  ].forEach((source) => {
    assert.match(source, /\bonShareAppMessage\s*\(/);
    assert.match(source, /\bonShareTimeline\s*\(/);
  });
});

test('ships a complete restrained icon pair for every native tab', () => {
  const appConfig = JSON.parse(read('app.json'));

  assert.equal(appConfig.tabBar.list.length, 4);
  appConfig.tabBar.list.forEach((tab) => {
    [tab.iconPath, tab.selectedIconPath].forEach((relativePath) => {
      assert.equal(typeof relativePath, 'string');
      const absolutePath = path.resolve(APP_ROOT, relativePath);
      const image = fs.readFileSync(absolutePath);
      assert.deepEqual(
        [...image.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10]
      );
      assert.equal(image.readUInt32BE(16), 81);
      assert.equal(image.readUInt32BE(20), 81);
      assert.ok(image.length < 40 * 1024);
    });
  });
});
