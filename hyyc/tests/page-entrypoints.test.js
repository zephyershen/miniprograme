const test = require('node:test');
const assert = require('node:assert/strict');

test('loads every configured page entrypoint after feature-module migration', () => {
  const registered = [];
  const previousPage = global.Page;
  global.Page = (definition) => registered.push(definition);
  try {
    [
      '../pages/inbox/index',
      '../pages/featured/index',
      '../pages/curated/index',
      '../pages/column-reader/index',
      '../pages/trend-detail/index',
      '../pages/briefing/index',
      '../pages/profile/index',
      '../pages/profile-edit/index',
      '../pages/feed-detail/index',
      '../pages/source-view/index',
      '../pages/cards/index'
    ].forEach((path) => {
      delete require.cache[require.resolve(path)];
      require(path);
    });
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  assert.equal(registered.length, 11);
  assert.equal(typeof registered[0].loadFeed, 'function');
  assert.equal(typeof registered[0].checkForFeedUpdates, 'function');
  assert.equal(typeof registered[0].applyNewItems, 'function');
  assert.equal(typeof registered[1].loadFeed, 'function');
  assert.equal(typeof registered[2].resolveAccess, 'function');
  assert.equal(typeof registered[2].selectSection, 'function');
  assert.equal(typeof registered[2].openPractical, 'function');
  assert.equal(registered[2].loadMoreCases, undefined);
  assert.equal(registered[2].previewPoster, undefined);
  assert.equal(typeof registered[3].loadContent, 'function');
  assert.equal(typeof registered[3].handlePosterChange, 'function');
  assert.equal(typeof registered[3].previewPoster, 'function');
  assert.equal(typeof registered[4].loadDossier, 'function');
  assert.equal(typeof registered[5].loadBriefing, 'function');
  assert.equal(typeof registered[6].loadMembership, 'function');
  assert.equal(typeof registered[7].saveProfile, 'function');
  assert.equal(typeof registered[8].loadItem, 'function');
  assert.equal(typeof registered[9].onLoad, 'function');
  assert.equal(typeof registered[10].loadFavorites, 'function');
});

test('keeps retired digest routes and stores out of the public collection flow', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'));
  assert.equal(app.pages.includes('pages/digest/index'), false);
  assert.equal(app.pages.includes('pages/settings/index'), false);
  const cards = fs.readFileSync(path.resolve(__dirname, '../pages/cards/index.js'), 'utf8');
  assert.doesNotMatch(cards, /loadDashboard|mutateDashboard|digestStore/);
});
