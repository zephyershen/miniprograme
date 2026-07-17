const test = require('node:test');
const assert = require('node:assert/strict');

test('loads every configured page entrypoint after feature-module migration', () => {
  const registered = [];
  const previousPage = global.Page;
  global.Page = (definition) => registered.push(definition);
  try {
    [
      '../pages/inbox/index',
      '../pages/curated/index',
      '../pages/briefing/index',
      '../pages/profile/index',
      '../pages/feed-detail/index',
      '../pages/source-view/index',
      '../pages/digest/index',
      '../pages/cards/index',
      '../pages/settings/index'
    ].forEach((path) => {
      delete require.cache[require.resolve(path)];
      require(path);
    });
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  assert.equal(registered.length, 9);
  assert.equal(typeof registered[0].loadFeed, 'function');
  assert.equal(typeof registered[1].loadFeed, 'function');
  assert.equal(typeof registered[2].loadBriefing, 'function');
  assert.equal(typeof registered[3].loadMembership, 'function');
  assert.equal(typeof registered[4].loadItem, 'function');
  assert.equal(typeof registered[5].onLoad, 'function');
});
