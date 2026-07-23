const crypto = require('node:crypto');
const { BillingError } = require('./errors');

const PKCS7_BLOCK_SIZE = 32;
const MAX_MESSAGE_BYTES = 128 * 1024;

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return leftBuffer.length > 0 && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function messageSignature(...parts) {
  return crypto.createHash('sha1')
    .update(parts.map((part) => String(part || '')).sort().join(''), 'utf8')
    .digest('hex');
}

function verifyMessageSignature(expected, ...parts) {
  return safeEqualText(expected, messageSignature(...parts));
}

function decodeAesKey(encodingAesKey) {
  const normalized = String(encodingAesKey || '').trim();
  if (!/^[A-Za-z0-9+/]{43}$/.test(normalized)) {
    throw new BillingError('MESSAGE_PUSH_CONFIG_INVALID', '消息推送配置无效', 503);
  }
  const key = Buffer.from(`${normalized}=`, 'base64');
  if (key.length !== 32) {
    throw new BillingError('MESSAGE_PUSH_CONFIG_INVALID', '消息推送配置无效', 503);
  }
  return key;
}

function pkcs7Pad(value) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const paddingLength = PKCS7_BLOCK_SIZE - (source.length % PKCS7_BLOCK_SIZE);
  return Buffer.concat([source, Buffer.alloc(paddingLength, paddingLength)]);
}

function pkcs7Unpad(value) {
  if (!Buffer.isBuffer(value) || !value.length) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  const paddingLength = value[value.length - 1];
  if (paddingLength < 1 || paddingLength > PKCS7_BLOCK_SIZE
    || paddingLength > value.length) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  for (let index = value.length - paddingLength; index < value.length; index += 1) {
    if (value[index] !== paddingLength) {
      throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
    }
  }
  return value.subarray(0, value.length - paddingLength);
}

function decodeCiphertext(encrypted) {
  const normalized = String(encrypted || '').trim();
  if (!normalized || normalized.length > Math.ceil(MAX_MESSAGE_BYTES * 4 / 3) + 8
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  const ciphertext = Buffer.from(normalized, 'base64');
  if (!ciphertext.length || ciphertext.length % 16 !== 0
    || ciphertext.length > MAX_MESSAGE_BYTES) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  return ciphertext;
}

function decryptWechatMessage(encrypted, { encodingAesKey, miniProgramAppId }) {
  const key = decodeAesKey(encodingAesKey);
  let decrypted;
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    decrypted = pkcs7Unpad(Buffer.concat([
      decipher.update(decodeCiphertext(encrypted)),
      decipher.final()
    ]));
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }

  if (decrypted.length < 21) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  const messageLength = decrypted.readUInt32BE(16);
  const messageEnd = 20 + messageLength;
  if (messageLength < 1 || messageEnd >= decrypted.length) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  const messageBuffer = decrypted.subarray(20, messageEnd);
  const appId = decrypted.subarray(messageEnd).toString('utf8');
  if (!safeEqualText(appId, miniProgramAppId)) {
    throw new BillingError('MESSAGE_PUSH_APP_MISMATCH', '消息来源无效', 403);
  }
  const message = messageBuffer.toString('utf8');
  if (!Buffer.from(message, 'utf8').equals(messageBuffer)) {
    throw new BillingError('MESSAGE_PUSH_DECRYPT_FAILED', '消息解密失败', 403);
  }
  return message;
}

function encryptWechatMessage(message, {
  encodingAesKey,
  miniProgramAppId,
  randomBytes = crypto.randomBytes
}) {
  const key = decodeAesKey(encodingAesKey);
  const messageBuffer = Buffer.from(String(message || ''), 'utf8');
  const appIdBuffer = Buffer.from(String(miniProgramAppId || ''), 'utf8');
  if (!messageBuffer.length || messageBuffer.length > MAX_MESSAGE_BYTES || !appIdBuffer.length) {
    throw new BillingError('MESSAGE_PUSH_ENCRYPT_FAILED', '消息加密失败', 500);
  }
  const random = randomBytes(16);
  if (!Buffer.isBuffer(random) || random.length !== 16) {
    throw new BillingError('MESSAGE_PUSH_ENCRYPT_FAILED', '消息加密失败', 500);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBuffer.length, 0);
  const plaintext = pkcs7Pad(Buffer.concat([random, length, messageBuffer, appIdBuffer]));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
}

function encryptWechatResponse(payload, config, {
  timestamp = Math.floor(Date.now() / 1000),
  nonce,
  randomBytes
} = {}) {
  const responseTimestamp = String(timestamp);
  const responseNonce = String(nonce || '');
  if (!/^\d{1,20}$/.test(responseTimestamp) || !responseNonce || responseNonce.length > 128) {
    throw new BillingError('MESSAGE_PUSH_RESPONSE_INVALID', '消息响应无效', 500);
  }
  const encrypted = encryptWechatMessage(JSON.stringify(payload), { ...config, randomBytes });
  return {
    Encrypt: encrypted,
    MsgSignature: messageSignature(config.token, responseTimestamp, responseNonce, encrypted),
    TimeStamp: Number(responseTimestamp),
    Nonce: responseNonce
  };
}

module.exports = {
  PKCS7_BLOCK_SIZE,
  MAX_MESSAGE_BYTES,
  safeEqualText,
  messageSignature,
  verifyMessageSignature,
  decodeAesKey,
  pkcs7Pad,
  pkcs7Unpad,
  decryptWechatMessage,
  encryptWechatMessage,
  encryptWechatResponse
};
