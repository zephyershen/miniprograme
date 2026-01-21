// 仅用于前端联调的占位 API。接后端后替换为真实请求。

function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function sendSmsCode(phone){
  console.log('mock sendSmsCode', phone);
  await delay(400);
  return { ok: true };
}

async function verifySmsCode(phone, code){
  console.log('mock verifySmsCode', phone, code);
  await delay(300);
  // 演示：123456 视为正确
  return { ok: code === '123456' };
}

async function exchangePhoneNumber(wxCode){
  // 正式逻辑：把前端拿到的 code 发到云函数，云函数再调用微信 openapi 换回手机号
  // 说明：如果云函数未部署/未开通能力，会在 catch 里返回 ok:false
  try {
    const fnRes = await wx.cloud.callFunction({
      name: 'exchangePhoneNumber',
      data: { code: wxCode }
    });
    const r = (fnRes && fnRes.result) || {};
    if (r && r.ok && r.phoneNumber) {
      return { ok: true, phoneNumber: r.phoneNumber };
    }
    return { ok: false, msg: r.msg || '获取手机号失败' };
  } catch (err) {
    console.error('callFunction exchangePhoneNumber 失败', err);
    return { ok: false, msg: '获取手机号失败（云函数未部署或未开通能力）' };
  }
}

async function validateInvite(inviteCode, building, door){
  console.log('mock validateInvite', inviteCode, building, door);
  await delay(300);
  // 演示：HYYC2025 视为正确
  return { ok: inviteCode && inviteCode.toUpperCase() === 'HYYC2025' };
}

module.exports = { sendSmsCode, verifySmsCode, exchangePhoneNumber, validateInvite };
