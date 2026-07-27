const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { finishPullDownRefresh } = require('../features/runtime/pull-down-refresh.js');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('always stops the native refresh affordance after a successful reload', async () => {
  const previousWx = global.wx;
  let stopCount = 0;
  global.wx = {
    stopPullDownRefresh() {
      stopCount += 1;
    }
  };

  try {
    const result = await finishPullDownRefresh(async () => 'fresh');
    assert.equal(result, 'fresh');
    assert.equal(stopCount, 1);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('stops the native refresh affordance without replacing a reload failure', async () => {
  const previousWx = global.wx;
  const expected = new Error('reload failed');
  let stopCount = 0;
  global.wx = {
    stopPullDownRefresh() {
      stopCount += 1;
    }
  };

  try {
    await assert.rejects(
      finishPullDownRefresh(async () => {
        throw expected;
      }),
      expected
    );
    assert.equal(stopCount, 1);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('enables pull-to-refresh only on reloadable content surfaces with explicit handlers', () => {
  const refreshablePages = ['briefing', 'curated', 'featured', 'column-reader'];
  const intentionallyStaticPages = ['feed-detail', 'trend-detail', 'source-view'];

  refreshablePages.forEach((page) => {
    const config = JSON.parse(read(`../pages/${page}/index.json`));
    const source = read(`../pages/${page}/index.js`);
    assert.equal(config.enablePullDownRefresh, true, `${page} must enable pull-to-refresh`);
    assert.match(source, /onPullDownRefresh\(\)/, `${page} must complete pull-to-refresh`);
    assert.match(source, /finishPullDownRefresh/, `${page} must stop the native affordance`);
  });

  intentionallyStaticPages.forEach((page) => {
    const config = JSON.parse(read(`../pages/${page}/index.json`));
    assert.notEqual(config.enablePullDownRefresh, true, `${page} should stay non-refreshable`);
  });
});
