const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createPosterRecovery } = require('../features/ai-column/poster-recovery.js');

test('re-signs and remounts one failed poster exactly once', async () => {
  let reloads = 0;
  const remounts = [];
  const failures = [];
  const recovery = createPosterRecovery({
    reload: async () => {
      reloads += 1;
      return true;
    },
    remount: async (index) => {
      remounts.push(index);
      return true;
    },
    onFailure: (key) => failures.push(key)
  });

  assert.equal(await recovery.recover({ key: 'poster-1', index: 0 }), true);
  assert.equal(await recovery.recover({ key: 'poster-1', index: 0 }), false);
  assert.equal(reloads, 1);
  assert.deepEqual(remounts, [0]);
  assert.deepEqual(failures, ['poster-1']);
});

test('coalesces adjacent poster failures into one protected-content reload', async () => {
  let resolveReload;
  let reloads = 0;
  const remounts = [];
  const recovery = createPosterRecovery({
    reload: () => {
      reloads += 1;
      return new Promise((resolve) => {
        resolveReload = resolve;
      });
    },
    remount: async (index) => {
      remounts.push(index);
      return true;
    },
    onFailure() {}
  });

  const first = recovery.recover({ key: 'poster-1', index: 0 });
  const duplicate = recovery.recover({ key: 'poster-1', index: 0 });
  const adjacent = recovery.recover({ key: 'poster-2', index: 1 });
  await Promise.resolve();
  assert.equal(reloads, 1);
  resolveReload(true);

  assert.equal(await first, true);
  assert.equal(await duplicate, true);
  assert.equal(await adjacent, true);
  assert.deepEqual(remounts.sort(), [0, 1]);
});

test('shows the fallback when a protected-content reload cannot refresh the URL', async () => {
  const failures = [];
  const recovery = createPosterRecovery({
    reload: async () => false,
    remount: async () => {
      throw new Error('must not remount');
    },
    onFailure: (key) => failures.push(key)
  });

  assert.equal(await recovery.recover({ key: 'poster-3', index: 2 }), false);
  assert.deepEqual(failures, ['poster-3']);
});

test('the reader keeps adjacent lazy loading and exposes the automatic recovery copy', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '../pages/column-reader/index.js'),
    'utf8'
  );
  const markup = fs.readFileSync(
    path.resolve(__dirname, '../pages/column-reader/index.wxml'),
    'utf8'
  );

  assert.match(script, /createPosterRecovery/);
  assert.match(script, /loadContent\(\{ force: true, preserveCurrent: true \}\)/);
  assert.match(script, /remountPoster/);
  assert.match(markup, /posterLoads\[posterIndex\]/);
  assert.match(markup, /正在重新获取手绘图/);
  assert.match(markup, /图片仍未加载，请下拉刷新后重试/);
});
