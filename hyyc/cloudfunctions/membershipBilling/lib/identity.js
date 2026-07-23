const crypto = require('node:crypto');
const { BillingError } = require('./errors');

function ownerKeyForOpenId(openId) {
  if (typeof openId !== 'string' || !openId) {
    throw new BillingError('AUTH_REQUIRED', '请在微信中重新打开小程序后再试', 401);
  }
  return crypto.createHash('sha256').update(openId).digest('hex');
}

function resolveActor(getWXContext) {
  const context = getWXContext();
  const openId = context && context.OPENID;
  return { openId, ownerKey: ownerKeyForOpenId(openId) };
}

module.exports = { ownerKeyForOpenId, resolveActor };
