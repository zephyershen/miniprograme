const test = require('node:test');
const assert = require('node:assert/strict');

test('loads every configured page entrypoint after feature-module migration', () => {
  const registered = [];
  const previousPage = global.Page;
  global.Page = (definition) => registered.push(definition);
  try {
    [
      '../pages/inbox/index',
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
  assert.equal(registered.length, 6);
  assert.equal(typeof registered[0].loadFeed, 'function');
  assert.equal(typeof registered[1].loadItem, 'function');
  assert.equal(typeof registered[2].onLoad, 'function');
});
