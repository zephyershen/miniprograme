// 云函数：exchangePhoneNumber
// 作用：把前端 open-type="getPhoneNumber" 拿到的 code 换成真实手机号
// 前提：小程序后台已开通「获取手机号」能力，否则前端拿不到 code。

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const code = (event && event.code) || '';
  if (!code) {
    return { ok: false, msg: '缺少 code' };
  }

  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    const phoneInfo = (res && res.phoneInfo) || {};
    const phoneNumber = phoneInfo.phoneNumber || '';

    if (!phoneNumber) {
      return { ok: false, msg: '未获取到手机号', raw: res };
    }

    return { ok: true, phoneNumber, phoneInfo };
  } catch (err) {
    console.error('exchangePhoneNumber 失败', err);
    return {
      ok: false,
      msg: (err && (err.errMsg || err.message)) ? (err.errMsg || err.message) : '获取手机号失败'
    };
  }
};

