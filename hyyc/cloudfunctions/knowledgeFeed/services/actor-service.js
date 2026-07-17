const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');

function ownerKeyForOpenId(openId) {
  if (typeof openId !== 'string' || !openId.trim()) throw new Error('OPENID_REQUIRED');
  return crypto.createHash('sha256').update(openId.trim()).digest('hex');
}

function createActorService({ getWXContext }) {
  function resolve() {
    const context = typeof getWXContext === 'function' ? getWXContext() : null;
    const openId = context && context.OPENID;
    if (typeof openId !== 'string' || !openId) {
      throw new AppError('AUTH_REQUIRED', '请在微信中重新打开小程序后再试');
    }
    return { ownerKey: ownerKeyForOpenId(openId) };
  }

  return { resolve };
}

module.exports = { createActorService, ownerKeyForOpenId };
