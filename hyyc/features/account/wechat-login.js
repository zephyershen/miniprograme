function requestWechatLoginCode(wxApi = typeof wx === 'undefined' ? null : wx) {
  return new Promise((resolve, reject) => {
    if (!wxApi || typeof wxApi.login !== 'function') {
      const error = new Error('暂时无法连接微信登录，请稍后重试');
      error.code = 'ACCOUNT_LOGIN_UNAVAILABLE';
      reject(error);
      return;
    }
    wxApi.login({
      success(result) {
        const code = result && typeof result.code === 'string' ? result.code.trim() : '';
        if (code) {
          resolve(code);
          return;
        }
        const error = new Error('微信登录状态获取失败，请重新进入小程序');
        error.code = 'ACCOUNT_LOGIN_FAILED';
        reject(error);
      },
      fail() {
        const error = new Error('微信登录状态获取失败，请重新进入小程序');
        error.code = 'ACCOUNT_LOGIN_FAILED';
        reject(error);
      }
    });
  });
}

module.exports = { requestWechatLoginCode };
