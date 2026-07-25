const { verifyViewerAccount } = require('./api.js');
const { requestWechatLoginCode } = require('./wechat-login.js');
const {
  accountPartition,
  viewerAccountVerified,
  rememberViewerAccount
} = require('./storage.js');

let activeVerification = null;

function accountSessionPresentation(access) {
  const partition = accountPartition(access);
  return {
    verified: viewerAccountVerified(access),
    authenticating: Boolean(
      partition
      && activeVerification
      && activeVerification.partition === partition
    )
  };
}

async function ensureViewerAccountSession(access) {
  const partition = accountPartition(access);
  if (!partition) {
    const error = new Error('当前微信账号状态暂时无法确认');
    error.code = 'ACCOUNT_CONTEXT_UNAVAILABLE';
    throw error;
  }
  if (viewerAccountVerified(access)) {
    return { verified: true, reused: true };
  }
  if (activeVerification && activeVerification.partition === partition) {
    return activeVerification.promise;
  }

  const promise = (async () => {
    const loginCode = await requestWechatLoginCode();
    const verified = await verifyViewerAccount(loginCode);
    if (!verified || verified.verified !== true) {
      const error = new Error('微信登录状态校验失败，请重新进入小程序');
      error.code = 'ACCOUNT_VERIFICATION_FAILED';
      throw error;
    }
    if (!rememberViewerAccount(access)) {
      const error = new Error('当前设备无法保存微信登录状态');
      error.code = 'ACCOUNT_STATE_UNAVAILABLE';
      throw error;
    }
    return { verified: true, reused: false };
  })();
  activeVerification = { partition, promise };
  try {
    return await promise;
  } finally {
    if (activeVerification && activeVerification.promise === promise) {
      activeVerification = null;
    }
  }
}

async function waitForViewerAccountSession(access) {
  if (viewerAccountVerified(access)) return true;
  const partition = accountPartition(access);
  if (activeVerification && activeVerification.partition === partition) {
    await activeVerification.promise.catch(() => null);
    return viewerAccountVerified(access);
  }
  let app = null;
  try {
    app = getApp();
  } catch (error) {
    app = null;
  }
  const pending = app && app.viewerAccountSessionPromise;
  if (pending && typeof pending.then === 'function') {
    await pending.catch(() => null);
  }
  return viewerAccountVerified(access);
}

module.exports = {
  accountSessionPresentation,
  ensureViewerAccountSession,
  waitForViewerAccountSession
};
