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
  console.log('mock exchangePhoneNumber', wxCode);
  await delay(300);
  // 演示：返回一个占位手机号
  return { ok: true, phoneNumber: '13800138000' };
}

async function validateInvite(inviteCode, building, door){
  console.log('mock validateInvite', inviteCode, building, door);
  await delay(300);
  // 演示：HYYC2025 视为正确
  return { ok: inviteCode && inviteCode.toUpperCase() === 'HYYC2025' };
}

module.exports = { sendSmsCode, verifySmsCode, exchangePhoneNumber, validateInvite };

