const test = require('node:test');
const assert = require('node:assert/strict');

function installModuleMock(request, exports) {
  const filename = require.resolve(request);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports
  };
  return () => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  };
}

function loadSession({ verifyViewerAccount, requestWechatLoginCode }) {
  const restores = [
    installModuleMock('../features/account/api', { verifyViewerAccount }),
    installModuleMock('../features/account/wechat-login', { requestWechatLoginCode })
  ];
  const filename = require.resolve('../features/account/session');
  const previous = require.cache[filename];
  delete require.cache[filename];
  let session;
  try {
    session = require(filename);
  } finally {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
    restores.reverse().forEach((restore) => restore());
  }
  return session;
}

function installAccountWx(storage = new Map()) {
  const previousWx = global.wx;
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); }
  };
  return {
    storage,
    restore() {
      if (previousWx) global.wx = previousWx;
      else delete global.wx;
    }
  };
}

const ACCESS = {
  viewer: {
    cachePartition: 'viewer-partition-a'
  }
};

test('startup account session logs in once, verifies the viewer and remembers it', async () => {
  const events = [];
  const environment = installAccountWx();
  const session = loadSession({
    requestWechatLoginCode: async () => {
      events.push('wx-login');
      return 'login-code';
    },
    verifyViewerAccount: async (code) => {
      events.push(`verify:${code}`);
      return { verified: true };
    }
  });
  try {
    assert.deepEqual(
      await session.ensureViewerAccountSession(ACCESS),
      { verified: true, reused: false }
    );
    assert.equal(session.accountSessionPresentation(ACCESS).verified, true);
  } finally {
    environment.restore();
  }

  assert.deepEqual(events, ['wx-login', 'verify:login-code']);
});

test('an existing viewer login skips both WeChat and server verification', async () => {
  const storage = new Map([[
    'membership_account_verification_v1',
    {
      version: 1,
      cachePartition: 'viewer-partition-a',
      verified: true
    }
  ]]);
  const environment = installAccountWx(storage);
  const session = loadSession({
    requestWechatLoginCode: async () => {
      throw new Error('must not login');
    },
    verifyViewerAccount: async () => {
      throw new Error('must not verify');
    }
  });
  try {
    assert.deepEqual(
      await session.ensureViewerAccountSession(ACCESS),
      { verified: true, reused: true }
    );
  } finally {
    environment.restore();
  }
});

test('concurrent startup requests share one account verification', async () => {
  let resolveVerification;
  let loginCount = 0;
  const environment = installAccountWx();
  const session = loadSession({
    requestWechatLoginCode: async () => {
      loginCount += 1;
      return 'login-code';
    },
    verifyViewerAccount: () => new Promise((resolve) => {
      resolveVerification = resolve;
    })
  });
  try {
    const first = session.ensureViewerAccountSession(ACCESS);
    const second = session.ensureViewerAccountSession(ACCESS);
    await Promise.resolve();
    resolveVerification({ verified: true });
    assert.deepEqual(await Promise.all([first, second]), [
      { verified: true, reused: false },
      { verified: true, reused: false }
    ]);
  } finally {
    environment.restore();
  }

  assert.equal(loginCount, 1);
});
