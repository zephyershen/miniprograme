// 云函数：login
// 作用：从云端拿到当前用户的 openId 和 appId
// 这里不额外引入 wx-server-sdk，直接从 event.userInfo 中取（云开发会自动注入）

exports.main = async (event, context) => {
  const userInfo = (event && event.userInfo) || {};

  return {
    openid: userInfo.openId || '',
    appid: userInfo.appId || '',
    userInfo,
  };
};
