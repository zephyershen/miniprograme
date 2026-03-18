// 云函数：huifuMiniappPay
// 用途：在本项目内快速验证“汇付(斗拱) 聚合正扫 -> 微信小程序支付”链路：
// - 调用聚合正扫接口生成 pay_info
// - 小程序端用 wx.requestPayment 拉起支付
//
// 注意：
// - 这是联调用云函数：只做最小链路验证；生产环境需要补齐 notify_url、验签、幂等、安全校验等。
// - 汇付接口签名规则：仅对 body.data 按 ASCII 字典序排序后 JSON 字符串做 SHA256WithRSA 加签（Base64 输出）。

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_HUIFU_HOST = 'api.huifu.com';
const DEFAULT_HUIFU_JSPAY_PATH = '/v3/trade/payment/jspay';
const DEFAULT_HUIFU_USER_INDV_OPEN_PATH = '/v2/user/basicdata/indv';
const DEFAULT_HUIFU_USER_BUSI_OPEN_PATH = '/v2/user/busi/open';
const DEFAULT_HUIFU_USER_BUSI_MODIFY_PATH = '/v2/user/busi/modify';
const DEFAULT_HUIFU_USER_INFO_QUERY_PATH = '/v2/user/basicdata/query';
const DEFAULT_HUIFU_ACCT_BALANCE_QUERY_PATH = '/v2/trade/acctpayment/balance/query';
const DEFAULT_HUIFU_WITHDRAW_PATH = '/v2/trade/settlement/encashment';
const DEFAULT_HUIFU_WITHDRAW_QUERY_PATH = '/v2/trade/settlement/query';
const DEFAULT_HUIFU_DELAY_CONFIRM_PATH = '/v2/trade/payment/delaytrans/confirm';
const DEFAULT_HUIFU_SCANPAY_REFUND_PATH = '/v3/trade/payment/scanpay/refund';
const DEFAULT_HUIFU_SCANPAY_REFUND_QUERY_PATH = '/v3/trade/payment/scanpay/refundquery';

const USER_COLLECTION = 'userInfo';
const GOODS_COLLECTION = 'goods';
const TASK_COLLECTION = 'tasks';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';
const BUILD_TAG = 'huifuMiniappPay@2026-03-16.1';
const GOODS_PAYMENT_LOCK_TTL_MS = Math.max(60 * 1000, Number(process.env.GOODS_PAYMENT_LOCK_TTL_MS) || 15 * 60 * 1000);
const TASK_DELAY_CONFIRM_LOCK_TTL_MS = Math.max(60 * 1000, Number(process.env.TASK_DELAY_CONFIRM_LOCK_TTL_MS) || 10 * 60 * 1000);
const MIN_PUBLISH_AMOUNT_YUAN = 0.5;
const MIN_PUBLISH_AMOUNT_CENTS = 50;

const db = cloud.database();

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function isSystemCompensateCall(event = {}) {
  const token = pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);
  return !!(
    event
    && event.systemCompensate === true
    && token
    && pickStr(event.compensateToken) === token
  );
}

function pickObj(...vals) {
  for (const v of vals) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  }
  return null;
}

function clampStr(s, maxLen = 120) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

function stripWrappingQuotes(s = '') {
  const t = String(s || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function normalizePem(pemLike = '') {
  // Cloud env vars are often pasted as a single line with literal "\n".
  return stripWrappingQuotes(String(pemLike || ''))
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function looksLikePemPrivateKey(pem = '') {
  const s = String(pem || '').trim();
  return Boolean(s && s.includes('-----BEGIN') && s.includes('PRIVATE KEY-----'));
}

function wordwrap64(s) {
  return String(s || '').replace(/\s+/g, '').replace(/(.{64})/g, '$1\n').trim();
}

function base64Pkcs8ToPem(base64Key = '') {
  const b64 = String(base64Key || '').trim();
  if (!b64) return '';
  return `-----BEGIN PRIVATE KEY-----\n${wordwrap64(b64)}\n-----END PRIVATE KEY-----`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ''));
  } catch (e) {
    return null;
  }
}

function safeJsonStringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch (e) {
    return '';
  }
}

function loadLocalConfig() {
  const candidates = ['./config.local.js', './config.js'];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(p);
    } catch (e) {
      // ignore
    }
  }
  return {};
}

function yyyymmdd(d = new Date()) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function randomId(len = 24) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function formatYuan2(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  // 保留两位小数，避免浮点误差
  return (Math.round(n * 100) / 100).toFixed(2);
}

function yuanToCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) >= 1e-8) return null;
  return Math.round(n * 100);
}

function centsToYuanStr(cents) {
  const c = Number(cents);
  if (!Number.isFinite(c) || c < 0) return '';
  return (c / 100).toFixed(2);
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function positiveMoney(v) {
  const n = roundMoney(v);
  return n > 0 ? n : 0;
}

function extractHuifuRespData(raw = {}) {
  const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  const top = parsed && typeof parsed === 'object' ? parsed : {};
  let body = top.body;
  if (typeof body === 'string') {
    body = safeJsonParse(body) || body;
  }
  let respData = top.resp_data != null
    ? top.resp_data
    : (top.respData != null
      ? top.respData
      : (body && typeof body === 'object' && body.data != null ? body.data : top.data));
  if (respData == null) respData = top;
  if (typeof respData === 'string') {
    const parsedRespData = safeJsonParse(respData);
    respData = parsedRespData && typeof parsedRespData === 'object' ? parsedRespData : {};
  }
  return respData && typeof respData === 'object' ? respData : {};
}

function resolveTaskPaymentAmounts(task = {}) {
  const t = task && typeof task === 'object' ? task : {};
  const pay = t.pay && typeof t.pay === 'object' ? t.pay : {};
  const notifyData = extractHuifuRespData(t.huifuNotify);
  const hasFeeMeta = !!(
    (pay && Object.prototype.hasOwnProperty.call(pay, 'feeAmtYuan'))
    || (notifyData && (Object.prototype.hasOwnProperty.call(notifyData, 'fee_amount') || Object.prototype.hasOwnProperty.call(notifyData, 'fee_amt')))
  );

  const orderAmtYuan = positiveMoney(
    pay.orderAmtYuan
    || pay.transAmtYuan
    || notifyData.ord_amt
    || notifyData.trans_amt
    || t.amount
    || 0
  );
  const feeAmtYuan = positiveMoney(
    pay.feeAmtYuan
    || notifyData.fee_amount
    || notifyData.fee_amt
    || 0
  );
  let confirmableAmtYuan = positiveMoney(
    pay.confirmableAmtYuan
    || pay.unconfirmAmtYuan
    || notifyData.unconfirm_amt
    || notifyData.unconfirmAmt
    || 0
  );
  if (!confirmableAmtYuan && orderAmtYuan > 0 && hasFeeMeta) {
    const netAmtYuan = roundMoney(orderAmtYuan - feeAmtYuan);
    if (netAmtYuan > 0) confirmableAmtYuan = netAmtYuan;
  }

  return {
    orderAmtYuan,
    feeAmtYuan,
    confirmableAmtYuan,
    orderCents: yuanToCents(orderAmtYuan) || 0,
    confirmableCents: yuanToCents(confirmableAmtYuan) || 0,
    paymentFeeCents: yuanToCents(feeAmtYuan) || 0,
  };
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function toWalletDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function getPrimaryWalletId(openid) {
  return pickStr(openid);
}

function isLegacyShadowWallet(wallet = {}) {
  const role = pickStr(wallet && wallet.walletRole).toLowerCase();
  return role === 'legacy_shadow' || !!pickStr(wallet && wallet.shadowOf);
}

function sumWalletAmount(walletDocs = [], field = 'balance') {
  return roundMoney((Array.isArray(walletDocs) ? walletDocs : []).reduce((sum, item) => (
    sum + Number(item && item[field] ? item[field] : 0)
  ), 0));
}

function pickWalletBoundaryDate(walletDocs = [], field = 'updatedAt', mode = 'max', fallback = new Date()) {
  const list = Array.isArray(walletDocs) ? walletDocs : [];
  let chosen = fallback;
  let chosenMs = toWalletDateMs(fallback);
  for (const item of list) {
    const value = item && item[field];
    const ms = toWalletDateMs(value);
    if (!ms) continue;
    if (!chosenMs) {
      chosen = value;
      chosenMs = ms;
      continue;
    }
    if (mode === 'min' ? ms < chosenMs : ms > chosenMs) {
      chosen = value;
      chosenMs = ms;
    }
  }
  return chosen || fallback;
}

function buildPrimaryWalletSnapshot(openid, walletDocs = [], now = new Date()) {
  const ownerOpenid = pickStr(openid);
  const docs = (Array.isArray(walletDocs) ? walletDocs : []).filter((item) => item && pickStr(item._openid) === ownerOpenid);
  const primaryId = getPrimaryWalletId(ownerOpenid);
  const primaryDoc = docs.find((item) => pickStr(item._id) === primaryId) || null;
  const mergeDocs = docs.filter((item) => item && (pickStr(item._id) === primaryId || !isLegacyShadowWallet(item)));
  const legacyDocs = docs.filter((item) => pickStr(item._id) && pickStr(item._id) !== primaryId);
  const aggregateDocs = mergeDocs.length ? mergeDocs : docs;
  return {
    _openid: ownerOpenid,
    balance: sumWalletAmount(aggregateDocs, 'balance'),
    incomeTotal: sumWalletAmount(aggregateDocs, 'incomeTotal'),
    expenseTotal: sumWalletAmount(aggregateDocs, 'expenseTotal'),
    createdAt: primaryDoc && primaryDoc.createdAt
      ? primaryDoc.createdAt
      : pickWalletBoundaryDate(docs, 'createdAt', 'min', now),
    updatedAt: now,
    walletRole: 'primary',
    isPrimary: true,
    shadowedWalletIds: legacyDocs.map((item) => pickStr(item._id)).filter(Boolean),
    ...(legacyDocs.length ? { mergedAt: now } : {}),
  };
}

async function markLegacyWalletDocs(tx, legacyDocs = [], primaryId = '', now = new Date()) {
  for (const item of Array.isArray(legacyDocs) ? legacyDocs : []) {
    const legacyId = pickStr(item && item._id);
    if (!legacyId || legacyId === primaryId) continue;
    await tx.collection(WALLET_COLLECTION).doc(legacyId).update({
      data: {
        walletRole: 'legacy_shadow',
        isPrimary: false,
        shadowOf: primaryId,
        shadowedAt: now,
        updatedAt: now,
      }
    });
  }
}

async function ensurePrimaryWalletDoc(tx, openid, now = new Date()) {
  const ownerOpenid = pickStr(openid);
  const primaryId = getPrimaryWalletId(ownerOpenid);
  if (!ownerOpenid || !primaryId) return { walletId: '', wallet: null, legacyDocs: [] };

  const walletRes = await tx.collection(WALLET_COLLECTION)
    .where({ _openid: ownerOpenid })
    .limit(20)
    .get();
  const walletDocs = (walletRes && walletRes.data) || [];
  if (!walletDocs.length) return { walletId: primaryId, wallet: null, legacyDocs: [] };

  const primaryDoc = walletDocs.find((item) => pickStr(item._id) === primaryId) || null;
  const legacyDocs = walletDocs.filter((item) => pickStr(item._id) && pickStr(item._id) !== primaryId);
  const actionableLegacyDocs = legacyDocs.filter((item) => !isLegacyShadowWallet(item) || pickStr(item.shadowOf) !== primaryId);
  if (!primaryDoc || actionableLegacyDocs.length) {
    const snapshot = buildPrimaryWalletSnapshot(ownerOpenid, walletDocs, now);
    if (primaryDoc && primaryDoc._id) {
      await tx.collection(WALLET_COLLECTION).doc(primaryId).update({
        data: {
          balance: snapshot.balance,
          incomeTotal: snapshot.incomeTotal,
          expenseTotal: snapshot.expenseTotal,
          createdAt: snapshot.createdAt,
          updatedAt: now,
          walletRole: 'primary',
          isPrimary: true,
          shadowedWalletIds: snapshot.shadowedWalletIds,
          mergedAt: snapshot.mergedAt || now,
        }
      });
    } else {
      await tx.collection(WALLET_COLLECTION).doc(primaryId).set({ data: snapshot });
    }
    await markLegacyWalletDocs(tx, legacyDocs, primaryId, now);
    return { walletId: primaryId, wallet: { ...(primaryDoc || {}), ...snapshot, _id: primaryId }, legacyDocs };
  }
  return { walletId: primaryId, wallet: primaryDoc, legacyDocs };
}

function calcPlatformFeeCents({ totalCents, feeRate = 0.04 }) {
  const t = Number(totalCents);
  const r = Number(feeRate);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(r) || r < 0 || r >= 1) return null;
  // 四舍五入到分
  return Math.round(t * r);
}

function buildSplitBunch({ totalCents, feeRate, platformHuifuId, sellerHuifuId }) {
  const feeCents = calcPlatformFeeCents({ totalCents, feeRate });
  if (feeCents == null) return { ok: false, err: { code: 'INVALID_FEE_RATE', msg: '平台费率不合法' } };
  const sellerCents = totalCents - feeCents;
  if (sellerCents <= 0) return { ok: false, err: { code: 'FEE_TOO_HIGH', msg: '平台手续费过高，卖家应得金额<=0' } };

  const acctSplitBunchObj = {
    acct_infos: [
      { huifu_id: platformHuifuId, div_amt: centsToYuanStr(feeCents) },
      { huifu_id: sellerHuifuId, div_amt: centsToYuanStr(sellerCents) },
    ],
  };

  return {
    ok: true,
    feeCents,
    sellerCents,
    acctSplitBunchObj,
    acctSplitBunch: JSON.stringify(acctSplitBunchObj),
  };
}

function buildTaskDelayConfirmSplitBunch({ orderCents, confirmableCents, feeRate, platformHuifuId, sellerHuifuId }) {
  const grossOrderCents = Number(orderCents);
  const availableCents = Number(confirmableCents);
  const grossFeeCents = calcPlatformFeeCents({ totalCents: grossOrderCents, feeRate });
  if (!Number.isFinite(grossOrderCents) || grossOrderCents <= 0) {
    return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '任务佣金不合法' } };
  }
  if (!Number.isFinite(availableCents) || availableCents <= 0) {
    return { ok: false, err: { code: 'INVALID_CONFIRMABLE_AMOUNT', msg: '当前支付单缺少可确认金额' } };
  }
  if (grossFeeCents == null) {
    return { ok: false, err: { code: 'INVALID_FEE_RATE', msg: '平台费率不合法' } };
  }

  const sellerCents = grossOrderCents - grossFeeCents;
  if (sellerCents <= 0) {
    return { ok: false, err: { code: 'FEE_TOO_HIGH', msg: '平台手续费过高，接单人应得金额<=0' } };
  }
  if (availableCents < sellerCents) {
    return { ok: false, err: { code: 'CONFIRMABLE_AMOUNT_TOO_LOW', msg: '可确认金额小于接单人应得金额，无法确认打款' } };
  }

  const platformCents = availableCents - sellerCents;
  const acctInfos = [];
  if (platformCents > 0) {
    acctInfos.push({ huifu_id: platformHuifuId, div_amt: centsToYuanStr(platformCents) });
  }
  acctInfos.push({ huifu_id: sellerHuifuId, div_amt: centsToYuanStr(sellerCents) });

  const acctSplitBunchObj = { acct_infos: acctInfos };
  return {
    ok: true,
    feeCents: platformCents,
    grossFeeCents,
    sellerCents,
    confirmableCents: availableCents,
    paymentFeeCents: Math.max(0, grossOrderCents - availableCents),
    acctSplitBunchObj,
    acctSplitBunch: JSON.stringify(acctSplitBunchObj),
  };
}

function sortObjectByAsciiKeys(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const keys = Object.keys(o).sort(); // ASCII 字典序
  const out = {};
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

function buildSortedJsonStringForSign(dataObj) {
  // 仅排序第一层；如果某字段值本身是 JSON 字符串，不需要对字符串内部排序（按文档说明）
  const sorted = sortObjectByAsciiKeys(dataObj);
  return JSON.stringify(sorted);
}

function rsaSha256SignBase64({ message, privateKeyPem }) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(String(message || ''), 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

function huifuRequest({ hostName, pathName, body, timeoutMs = 15000 }) {
  const bodyStr = JSON.stringify(body || {});
  const options = {
    hostname: hostName,
    port: 443,
    path: pathName,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Accept: 'application/json',
      'User-Agent': 'hyyc-miniprogram-cloudfunction',
    },
    timeout: timeoutMs,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          raw,
          json: safeJsonParse(raw),
        });
      });
    });

    req.on('timeout', () => req.destroy(new Error('huifu_request_timeout')));
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function resolveHuifuConfig(event = {}) {
  const local = loadLocalConfig() || {};

  const sysId = pickStr(process.env.HUIFU_SYS_ID, event.sysId, local.sysId);
  const productId = pickStr(process.env.HUIFU_PRODUCT_ID, event.productId, local.productId);
  const huifuId = pickStr(process.env.HUIFU_HUIFU_ID, event.huifuId, local.huifuId);
  const subAppid = pickStr(process.env.HUIFU_SUB_APPID, event.subAppid, local.subAppid);

  let privateKey = normalizePem(pickStr(process.env.HUIFU_PRIVATE_KEY, event.privateKey, local.privateKey));
  const privateKeyPath = pickStr(process.env.HUIFU_PRIVATE_KEY_PATH, event.privateKeyPath, local.privateKeyPath, './cert/huifu_private_key.pem');

  if (!privateKey) {
    try {
      privateKey = fs.readFileSync(path.resolve(__dirname, privateKeyPath), 'utf8').trim();
      privateKey = normalizePem(privateKey);
    } catch (e) {
      // ignore
    }
  }

  // 如果用户直接贴了 base64（无头尾），自动包成 PEM
  if (privateKey && !looksLikePemPrivateKey(privateKey) && /^[A-Za-z0-9+/=\r\n]+$/.test(privateKey)) {
    privateKey = base64Pkcs8ToPem(privateKey);
  }

  let privateKeyFormatError = null;
  if (!privateKey || !looksLikePemPrivateKey(privateKey)) {
    privateKeyFormatError = {
      code: 'INVALID_PRIVATE_KEY_FORMAT',
      msg: '汇付私钥格式不正确：需要 PKCS8 PEM（-----BEGIN PRIVATE KEY----- ...）或对应的 Base64 内容',
      hint: `你可以在云函数目录放置 ${privateKeyPath}，或通过环境变量 HUIFU_PRIVATE_KEY 配置。`,
    };
    privateKey = '';
  }

  return { sysId, productId, huifuId, subAppid, privateKey, privateKeyPath, privateKeyFormatError };
}

function resolvePlatformFeeRate(event = {}) {
  const raw = pickStr(process.env.HUIFU_PLATFORM_FEE_RATE, event.platformFeeRate);
  // 业务约定默认：平台收 4%，用户得 96%
  if (!raw) return 0.04;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.04;
  if (n > 0 && n < 1) return n; // 0.03
  if (n > 1 && n < 100) return n / 100; // 3 -> 0.03
  return 0.04;
}

function getHuifuUserIdFromUserDoc(user = {}) {
  const u = user && typeof user === 'object' ? user : {};
  const huifuObj = u.huifu && typeof u.huifu === 'object' ? u.huifu : null;
  return pickStr(
    u.huifuUserId,
    u.huifu_id,
    u.huifuId,
    huifuObj && (huifuObj.huifuId || huifuObj.huifu_id || huifuObj.user_huifu_id)
  );
}

function isHuifuOpenSuccess(user = {}) {
  const u = user && typeof user === 'object' ? user : {};
  const s = pickStr(u.huifu_open_status);
  if (!s) return false;
  return s === 'success';
}

function isUserBusiOpenSuccess(user = {}) {
  const u = user && typeof user === 'object' ? user : {};
  const userBusiObj = u.userBusiApply && typeof u.userBusiApply === 'object' ? u.userBusiApply : null;
  const s = pickStr(u.user_busi_status, userBusiObj && userBusiObj.status);
  return s === 'success';
}

function getReceiverHuifuIdFromUserDoc(user = {}) {
  return getHuifuUserIdFromUserDoc(user);
}

function isReceiverReady(user = {}) {
  return Boolean(getHuifuUserIdFromUserDoc(user))
    && isHuifuOpenSuccess(user)
    && isUserBusiOpenSuccess(user);
}

async function getUserInfoByOpenid(openid) {
  const db = cloud.database();
  const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

async function getGoodsById(goodsId) {
  const db = cloud.database();
  const res = await db.collection(GOODS_COLLECTION).doc(goodsId).get();
  return (res && res.data) ? res.data : null;
}

function getGoodsPaymentLock(goods = {}) {
  return goods && goods.paymentLock && typeof goods.paymentLock === 'object'
    ? goods.paymentLock
    : {};
}

function isGoodsPaymentLockActive(lock = {}, nowMs = Date.now()) {
  const status = pickStr(lock.status).toLowerCase();
  if (['paid', 'released', 'failed', 'expired'].includes(status)) return false;
  const expiresAtMs = toDateMs(lock.expiresAt);
  return !!pickStr(lock.reqSeqId) && expiresAtMs > nowMs;
}

async function acquireGoodsPaymentLock({ goodsId, buyerOpenid }) {
  const normalizedGoodsId = pickStr(goodsId);
  const normalizedBuyerOpenid = pickStr(buyerOpenid);
  if (!normalizedGoodsId || !normalizedBuyerOpenid) {
    return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少商品或买家信息' } };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const reqDate = yyyymmdd(now);
  const reqSeqId = `GD${reqDate}${randomId(20)}`;
  const expiresAt = new Date(nowMs + GOODS_PAYMENT_LOCK_TTL_MS);

  return db.runTransaction(async (tx) => {
    const docRes = await tx.collection(GOODS_COLLECTION).doc(normalizedGoodsId).get();
    const goods = docRes && docRes.data ? docRes.data : null;
    if (!goods) return { ok: false, err: { code: 'GOODS_NOT_FOUND', msg: '商品不存在' } };

    const status = pickStr(goods.status) || 'posted';
    if (status !== 'posted') {
      return { ok: false, err: { code: status === 'sold' ? 'ALREADY_SOLD' : 'NOT_FOR_SALE', msg: '该商品当前不可购买', status } };
    }

    const sellerOpenid = pickStr(goods._openid);
    if (!sellerOpenid) return { ok: false, err: { code: 'MISSING_SELLER', msg: '商品缺少发布者信息' } };
    if (sellerOpenid === normalizedBuyerOpenid) {
      return { ok: false, err: { code: 'CANNOT_BUY_SELF', msg: '不能购买自己发布的商品' } };
    }

    const existingLock = getGoodsPaymentLock(goods);
    if (isGoodsPaymentLockActive(existingLock, nowMs)) {
      const sameBuyer = pickStr(existingLock.buyerOpenid) === normalizedBuyerOpenid;
      return {
        ok: false,
        err: {
          code: sameBuyer ? 'GOODS_PAY_PENDING' : 'GOODS_LOCKED',
          msg: sameBuyer
            ? '你有一笔商品支付正在处理中，请稍后再试'
            : '该商品已有用户正在支付，请稍后重试'
        }
      };
    }

    await tx.collection(GOODS_COLLECTION).doc(normalizedGoodsId).update({
      data: {
        paymentLock: {
          buyerOpenid: normalizedBuyerOpenid,
          reqDate,
          reqSeqId,
          status: 'locked',
          createdAt: now,
          updatedAt: now,
          expiresAt,
        },
        updatedAt: now,
      }
    });

    return {
      ok: true,
      goods,
      reqDate,
      reqSeqId,
      expiresAt,
    };
  });
}

async function updateGoodsPaymentLock(goodsId, patch = {}) {
  const normalizedGoodsId = pickStr(goodsId);
  if (!normalizedGoodsId || !patch || typeof patch !== 'object') return;
  const goods = await getGoodsById(normalizedGoodsId);
  if (!goods) return;
  const prevLock = getGoodsPaymentLock(goods);
  await db.collection(GOODS_COLLECTION).doc(normalizedGoodsId).update({
    data: {
      paymentLock: {
        ...prevLock,
        ...patch,
        updatedAt: new Date(),
      },
      updatedAt: new Date(),
    }
  });
}

async function releaseGoodsPaymentLock({ goodsId, buyerOpenid, reqSeqId = '', reqDate = '', reason = '' }) {
  const normalizedGoodsId = pickStr(goodsId);
  const normalizedBuyerOpenid = pickStr(buyerOpenid);
  if (!normalizedGoodsId || !normalizedBuyerOpenid) {
    return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少商品或买家信息' } };
  }

  return db.runTransaction(async (tx) => {
    const docRes = await tx.collection(GOODS_COLLECTION).doc(normalizedGoodsId).get();
    const goods = docRes && docRes.data ? docRes.data : null;
    if (!goods) return { ok: false, err: { code: 'GOODS_NOT_FOUND', msg: '商品不存在' } };
    if (pickStr(goods.status) === 'sold') return { ok: true, already: true };

    const lock = getGoodsPaymentLock(goods);
    if (!pickStr(lock.reqSeqId)) return { ok: true, already: true };
    if (pickStr(lock.buyerOpenid) && pickStr(lock.buyerOpenid) !== normalizedBuyerOpenid) {
      return { ok: false, err: { code: 'LOCK_OWNER_MISMATCH', msg: '当前支付锁不属于你' } };
    }
    if (pickStr(reqSeqId) && pickStr(lock.reqSeqId) !== pickStr(reqSeqId)) {
      return { ok: false, err: { code: 'LOCK_REQ_MISMATCH', msg: '支付锁请求号不匹配' } };
    }
    if (pickStr(reqDate) && pickStr(lock.reqDate) && pickStr(lock.reqDate) !== pickStr(reqDate)) {
      return { ok: false, err: { code: 'LOCK_REQDATE_MISMATCH', msg: '支付锁日期不匹配' } };
    }

    const now = new Date();
    await tx.collection(GOODS_COLLECTION).doc(normalizedGoodsId).update({
      data: {
        paymentLock: {
          ...lock,
          status: 'released',
          releaseReason: pickStr(reason, 'client_cancelled'),
          releasedAt: now,
          expiresAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      }
    });
    return { ok: true };
  });
}

async function prepareTaskDelayConfirmLock({ taskId, ownerOpenid }) {
  const normalizedTaskId = pickStr(taskId);
  const normalizedOwnerOpenid = pickStr(ownerOpenid);
  if (!normalizedTaskId || !normalizedOwnerOpenid) {
    return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少任务或用户信息' } };
  }

  const now = new Date();
  const nowMs = now.getTime();

  return db.runTransaction(async (tx) => {
    const docRes = await tx.collection(TASK_COLLECTION).doc(normalizedTaskId).get();
    const task = docRes && docRes.data ? docRes.data : null;
    if (!task) return { ok: false, err: { code: 'TASK_NOT_FOUND', msg: '任务不存在' } };
    if (pickStr(task._openid) !== normalizedOwnerOpenid) {
      return { ok: false, err: { code: 'NOT_OWNER', msg: '只有发布者可以确认完成' } };
    }

    const status = pickStr(task.status);
    if (status === 'completed') return { ok: true, task, alreadyCompleted: true };
    if (status !== 'submitted') {
      return { ok: false, err: { code: 'INVALID_STATUS', msg: '当前任务还不能确认完成', status } };
    }

    const split = task.split && typeof task.split === 'object' ? task.split : {};
    const delayConfirm = split.delayConfirm && typeof split.delayConfirm === 'object' ? split.delayConfirm : {};
    const existingReqDate = pickStr(delayConfirm.reqDate);
    const existingReqSeqId = pickStr(delayConfirm.reqSeqId);
    const lockExpiresAtMs = toDateMs(delayConfirm.lockExpiresAt);
    const hasInFlightLock = pickStr(split.status) === 'confirming' && existingReqDate && existingReqSeqId && lockExpiresAtMs > nowMs;

    if (hasInFlightLock) {
      return {
        ok: true,
        task,
        pending: true,
        reqDate: existingReqDate,
        reqSeqId: existingReqSeqId,
      };
    }

    const reqDate = existingReqDate || yyyymmdd(now);
    const reqSeqId = existingReqSeqId || `DC${reqDate}${randomId(20)}`;
    const payObj = task.pay && typeof task.pay === 'object' ? task.pay : {};
    const nextDelayConfirm = {
      ...delayConfirm,
      reqDate,
      reqSeqId,
      orgReqDate: pickStr(delayConfirm.orgReqDate, payObj.reqDate),
      orgReqSeqId: pickStr(delayConfirm.orgReqSeqId, payObj.reqSeqId),
      orgHfSeqId: pickStr(delayConfirm.orgHfSeqId, payObj.orgHfSeqId),
      requestedAt: delayConfirm.requestedAt || now,
      lockExpiresAt: new Date(nowMs + TASK_DELAY_CONFIRM_LOCK_TTL_MS),
    };

    await tx.collection(TASK_COLLECTION).doc(normalizedTaskId).update({
      data: {
        split: {
          ...split,
          status: 'confirming',
          delayConfirm: nextDelayConfirm,
          lastError: null,
        },
        updatedAt: now,
      }
    });

    return {
      ok: true,
      task: {
        ...task,
        split: {
          ...split,
          status: 'confirming',
          delayConfirm: nextDelayConfirm,
        }
      },
      reqDate,
      reqSeqId,
    };
  });
}

async function getTaskById(taskId) {
  const db = cloud.database();
  const res = await db.collection(TASK_COLLECTION).doc(taskId).get();
  return (res && res.data) ? res.data : null;
}

async function markTaskDelayConfirmFailed({
  taskId,
  task,
  code = '',
  msg = '',
  respCode = '',
  respDesc = '',
  reqDate = '',
  reqSeqId = '',
  resetReq = false,
  extra = {},
}) {
  const normalizedTaskId = pickStr(taskId);
  if (!normalizedTaskId) return;
  const split = task && task.split && typeof task.split === 'object' ? task.split : {};
  const delayConfirm = split.delayConfirm && typeof split.delayConfirm === 'object' ? split.delayConfirm : {};
  const now = new Date();

  try {
    await db.collection(TASK_COLLECTION).doc(normalizedTaskId).update({
      data: {
        updatedAt: now,
        split: {
          ...split,
          mode: 'delay',
          status: 'failed',
          lastError: {
            code: pickStr(code, respCode),
            respCode: pickStr(respCode),
            respDesc: pickStr(respDesc, msg),
            at: now,
          },
          delayConfirm: {
            ...delayConfirm,
            lastReqDate: pickStr(reqDate, delayConfirm.lastReqDate, delayConfirm.reqDate),
            lastReqSeqId: pickStr(reqSeqId, delayConfirm.lastReqSeqId, delayConfirm.reqSeqId),
            lastFailedAt: now,
            lockExpiresAt: now,
            reqDate: resetReq ? '' : pickStr(delayConfirm.reqDate),
            reqSeqId: resetReq ? '' : pickStr(delayConfirm.reqSeqId),
          },
          ...extra,
        }
      }
    });
  } catch (e) {
    console.error('[delay_confirm_task] mark failure failed', e);
  }
}

async function recordWalletTransaction({
  openid,
  amount,
  balanceDelta,
  type,
  bizKey,
  title,
  summary,
  relatedId,
  counterpartOpenid,
  affectsBalance,
  fundChannel,
  createdAt = new Date(),
}) {
  const ownerOpenid = pickStr(openid);
  const txType = pickStr(type);
  const key = pickStr(bizKey);
  const amt = roundMoney(amount);
  let delta = roundMoney(balanceDelta);
  if (!Number.isFinite(delta)) delta = amt;
  const shouldAffectBalance = typeof affectsBalance === 'boolean' ? affectsBalance : delta !== 0;
  if (!shouldAffectBalance) delta = 0;
  const channel = pickStr(fundChannel, shouldAffectBalance ? 'huifu_balance' : 'wechat_pay');
  if (!ownerOpenid || !txType || !key || (!amt && !delta)) return { ok: false, code: 'INVALID_LEDGER_INPUT' };

  const db = cloud.database();
  return db.runTransaction(async (tx) => {
    const existsRes = await tx.collection(TRANSACTIONS_COLLECTION)
      .where({ _openid: ownerOpenid, bizKey: key })
      .limit(1)
      .get();
    const existsList = (existsRes && existsRes.data) || [];
    if (existsList.length) return { ok: true, duplicated: true };

    const walletState = await ensurePrimaryWalletDoc(tx, ownerOpenid, createdAt);
    const wallet = walletState && walletState.wallet ? walletState.wallet : null;
    const walletId = pickStr(walletState && walletState.walletId);
    const currentBalance = roundMoney(wallet && wallet.balance);
    const nextBalance = roundMoney(currentBalance + delta);
    const incomeDelta = delta > 0 ? delta : 0;
    const expenseDelta = delta < 0 ? Math.abs(delta) : 0;

    if (walletId && wallet) {
      await tx.collection(WALLET_COLLECTION).doc(walletId).update({
        data: {
          balance: nextBalance,
          incomeTotal: roundMoney(Number(wallet.incomeTotal || 0) + incomeDelta),
          expenseTotal: roundMoney(Number(wallet.expenseTotal || 0) + expenseDelta),
          walletRole: 'primary',
          isPrimary: true,
          updatedAt: createdAt,
        }
      });
    } else if (shouldAffectBalance) {
      await tx.collection(WALLET_COLLECTION).doc(walletId || getPrimaryWalletId(ownerOpenid)).set({
        data: {
          _openid: ownerOpenid,
          balance: nextBalance,
          incomeTotal: incomeDelta,
          expenseTotal: expenseDelta,
          createdAt,
          updatedAt: createdAt,
          walletRole: 'primary',
          isPrimary: true,
          shadowedWalletIds: [],
        }
      });
    }

    await tx.collection(TRANSACTIONS_COLLECTION).add({
      data: {
        _openid: ownerOpenid,
        bizKey: key,
        type: txType,
        amount: amt,
        balanceDelta: delta,
        affectsBalance: shouldAffectBalance,
        fundChannel: channel,
        balanceAfter: nextBalance,
        title: pickStr(title),
        summary: pickStr(summary),
        relatedId: pickStr(relatedId),
        counterpartOpenid: pickStr(counterpartOpenid),
        createdAt,
        updatedAt: createdAt,
      }
    });

    return { ok: true, balanceAfter: nextBalance };
  });
}

async function huifuCallSignedJson({ hostName, pathName, cfg, data, copyLogLabel = '', debugMeta = {} }) {
  const signPayload = buildSortedJsonStringForSign(data);
  const sign = rsaSha256SignBase64({ message: signPayload, privateKeyPem: cfg.privateKey });
  const body = {
    sys_id: cfg.sysId,
    product_id: cfg.productId,
    data,
    sign,
  };
  if (copyLogLabel) {
    console.log(`[copyable:${copyLogLabel}:request] ${JSON.stringify({
      host: hostName,
      path: pathName,
      body,
    })}`);
  }
  console.log('[huifuMiniappPay] request', JSON.stringify({
    action: pickStr(debugMeta && debugMeta.action),
    buildTag: pickStr(debugMeta && debugMeta.buildTag, BUILD_TAG),
    openid: pickStr(debugMeta && debugMeta.openid),
    host: hostName,
    path: pathName,
    reqDate: pickStr(debugMeta && debugMeta.reqDate, data && data.req_date),
    reqSeqId: pickStr(debugMeta && debugMeta.reqSeqId, data && data.req_seq_id),
  }));
  try {
    const resp = await huifuRequest({ hostName, pathName, body });
    resp.requestMeta = {
      host: hostName,
      path: pathName,
      body,
    };
    console.log('[huifuMiniappPay] response', JSON.stringify({
      action: pickStr(debugMeta && debugMeta.action),
      buildTag: pickStr(debugMeta && debugMeta.buildTag, BUILD_TAG),
      openid: pickStr(debugMeta && debugMeta.openid),
      host: hostName,
      path: pathName,
      reqDate: pickStr(debugMeta && debugMeta.reqDate, data && data.req_date),
      reqSeqId: pickStr(debugMeta && debugMeta.reqSeqId, data && data.req_seq_id),
      statusCode: resp && resp.statusCode,
      body: resp && resp.json ? resp.json : (resp && resp.raw),
    }));
    if (copyLogLabel) {
      console.log(`[copyable:${copyLogLabel}:response] ${JSON.stringify({
        statusCode: resp && resp.statusCode,
        body: resp && resp.json ? resp.json : (resp && resp.raw),
      })}`);
    }
    return resp;
  } catch (err) {
    console.error('[huifuMiniappPay] request failed', JSON.stringify({
      action: pickStr(debugMeta && debugMeta.action),
      buildTag: pickStr(debugMeta && debugMeta.buildTag, BUILD_TAG),
      openid: pickStr(debugMeta && debugMeta.openid),
      host: hostName,
      path: pathName,
      reqDate: pickStr(debugMeta && debugMeta.reqDate, data && data.req_date),
      reqSeqId: pickStr(debugMeta && debugMeta.reqSeqId, data && data.req_seq_id),
      error: err && err.message ? err.message : String(err),
    }));
    throw err;
  }
}

function unwrapHuifuResp(resp = {}) {
  const rawTop = resp && resp.json ? resp.json : {};
  const respData = (rawTop && typeof rawTop === 'object' && rawTop.data)
    ? rawTop.data
    : rawTop;
  return {
    okHttp: !!(resp.statusCode >= 200 && resp.statusCode < 300),
    rawTop,
    respData,
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = pickStr(event.action, 'jspay');
  const systemCompensate = isSystemCompensateCall(event);
  if (systemCompensate && action !== 'delay_confirm_task') {
    return { ok: false, err: { code: 'SYSTEM_ACTION_NOT_ALLOWED', msg: '系统补偿仅支持任务确认打款' }, buildTag: BUILD_TAG };
  }
  const debugOpenid = pickStr(OPENID, systemCompensate ? event.ownerOpenid : '', systemCompensate ? event.targetOpenid : '');
  const cfg = resolveHuifuConfig(event);
  console.log('[huifuMiniappPay] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid: debugOpenid,
    systemCompensate,
    eventKeys: Object.keys(event || {}).sort().slice(0, 30),
  }));

  if (cfg.privateKeyFormatError) {
    return { ok: false, err: cfg.privateKeyFormatError, buildTag: BUILD_TAG };
  }
  if (!cfg.sysId || !cfg.productId || !cfg.huifuId) {
    return {
      ok: false,
      err: {
        code: 'MISSING_CONFIG',
        msg: '缺少汇付配置：sysId/productId/huifuId 必填',
        got: { sysId: cfg.sysId, productId: cfg.productId, huifuId: cfg.huifuId },
      }
      ,
      buildTag: BUILD_TAG
    };
  }

  const hostName = pickStr(process.env.HUIFU_API_HOST, event.apiHost, DEFAULT_HUIFU_HOST);
  const callSigned = ({ pathName, data, copyLogLabel = '' }) => huifuCallSignedJson({
    hostName,
    pathName,
    cfg,
    data,
    copyLogLabel,
    debugMeta: {
      action,
      openid: debugOpenid,
      buildTag: BUILD_TAG,
      reqDate: pickStr(data && data.req_date),
      reqSeqId: pickStr(data && data.req_seq_id),
    }
  });

  async function doJspay({ transAmtYuan, goodsDesc, reqSeqIdInput, reqDateInput, delayAcctFlag = 'N', acctSplitBunch = '' }) {
    const transAmt = formatYuan2(transAmtYuan);
    if (!transAmt) return { ok: false, err: 'invalid_transAmtYuan' };

    const feeFlag = pickStr(delayAcctFlag, 'N').toUpperCase();
    const delayAcct = feeFlag === 'Y' ? 'Y' : 'N';

    const reqDate = (/^\d{8}$/.test(pickStr(reqDateInput)) ? pickStr(reqDateInput) : yyyymmdd(new Date()));
    const reqSeqId = pickStr(reqSeqIdInput, event.reqSeqId, `HF${reqDate}${randomId(20)}`);

    const subAppid = pickStr(event.subAppid, cfg.subAppid);
    if (!subAppid) {
      return {
        ok: false,
        err: {
          code: 'MISSING_SUB_APPID',
          msg: '缺少 sub_appid：微信小程序支付一般需要 wx_data.sub_appid + wx_data.sub_openid',
        }
      };
    }

    // 按文档：wx_data 是 jsonObject 字符串
    const wxDataStr = JSON.stringify({
      sub_appid: subAppid,
      sub_openid: OPENID,
    });

    const data = {
      req_date: reqDate,
      req_seq_id: reqSeqId,
      huifu_id: cfg.huifuId,
      goods_desc: clampStr(goodsDesc, 120),
      trade_type: 'T_MINIAPP',
      trans_amt: transAmt,
      wx_data: wxDataStr,
      delay_acct_flag: delayAcct,
    };

    const notifyUrl = pickStr(process.env.HUIFU_NOTIFY_URL, event.notifyUrl, event.notify_url);
    if (notifyUrl) data.notify_url = notifyUrl;

    const bunchStr = pickStr(acctSplitBunch);
    if (bunchStr) data.acct_split_bunch = bunchStr;

    const pathName = pickStr(process.env.HUIFU_JSPAY_PATH, event.apiPath, DEFAULT_HUIFU_JSPAY_PATH);
    const resp = await callSigned({ pathName, data, copyLogLabel: 'jspay' });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;

    const rawTop = resp.json || {};
    // 返回示例中是：{ data: {...}, sign: "..." }
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;

    if (!okHttp) {
      return {
        ok: false,
        err: {
          code: 'HTTP_ERROR',
          statusCode: resp.statusCode,
          raw: resp.raw,
        }
      };
    }

    const payInfoStr = respData && respData.pay_info ? String(respData.pay_info) : '';
    const payParams = safeJsonParse(payInfoStr);
    const respCode = pickStr(respData && (respData.resp_code || respData.return_code || respData.code || respData.respCode));
    const respDesc = pickStr(respData && (respData.resp_desc || respData.resp_msg || respData.return_msg || respData.message || respData.respDesc));

    // 汇付小程序下单场景里，00000100 也表示“下单成功”，此时会返回 pay_info，
    // 后续应继续拉起 wx.requestPayment，而不是当作失败拦掉。
    const isBizSuccess = !respCode || respCode === '00000000' || respCode === '00000100';
    if (!isBizSuccess) {
      return {
        ok: false,
        err: {
          code: 'HUIFU_BIZ_ERROR',
          msg: respDesc ? `${respCode}:${respDesc}` : respCode,
          respData,
        }
      };
    }

    if (!payParams || !payParams.timeStamp || !payParams.nonceStr || !payParams.package || !payParams.paySign) {
      return {
        ok: false,
        err: {
          code: 'NO_PAY_INFO',
          msg: '汇付未返回可用的 pay_info（无法拉起 wx.requestPayment）',
          respData,
        }
      };
    }

    return {
      ok: true,
      apiHost: hostName,
      apiPath: pathName,
      reqDate,
      reqSeqId,
      openid: OPENID,
      transAmt,
      huifuResp: respData,
      payInfo: payInfoStr,
      // wx.requestPayment 所需字段（直接透传 pay_info 解析结果）
      payParams: {
        timeStamp: String(payParams.timeStamp),
        nonceStr: String(payParams.nonceStr),
        package: String(payParams.package),
        signType: String(payParams.signType || 'RSA'),
        paySign: String(payParams.paySign),
      }
    };
  }

  if (action === 'jspay') {
    return await doJspay({
      transAmtYuan: event.transAmtYuan,
      goodsDesc: pickStr(event.goodsDesc, 'HYYC pay'),
      reqSeqIdInput: event.reqSeqId,
      delayAcctFlag: event.delayAcctFlag,
      acctSplitBunch: event.acctSplitBunch,
    });
  }

  if (action === 'jspay_goods') {
    const goodsId = pickStr(event.goodsId);
    if (!goodsId) return { ok: false, err: { code: 'MISSING_GOODS_ID', msg: '缺少 goodsId' } };

    const lockRes = await acquireGoodsPaymentLock({ goodsId, buyerOpenid: OPENID });
    if (!lockRes || !lockRes.ok) return lockRes || { ok: false, err: { code: 'LOCK_FAILED', msg: '商品锁单失败' } };
    try {
      const goods = lockRes.goods || {};
      const totalCents = yuanToCents(goods.price);
      if (!totalCents) {
        await releaseGoodsPaymentLock({
          goodsId,
          buyerOpenid: OPENID,
          reqDate: lockRes.reqDate,
          reqSeqId: lockRes.reqSeqId,
          reason: 'invalid_price',
        });
        return { ok: false, err: { code: 'INVALID_PRICE', msg: '商品价格不合法' } };
      }
      if (totalCents < MIN_PUBLISH_AMOUNT_CENTS) {
        await releaseGoodsPaymentLock({
          goodsId,
          buyerOpenid: OPENID,
          reqDate: lockRes.reqDate,
          reqSeqId: lockRes.reqSeqId,
          reason: 'price_below_minimum',
        });
        return { ok: false, err: { code: 'PRICE_TOO_LOW', msg: `商品价格不能低于 ${MIN_PUBLISH_AMOUNT_YUAN} 元` } };
      }

      const sellerOpenid = pickStr(goods._openid);
      const sellerUser = await getUserInfoByOpenid(sellerOpenid);
      const sellerHuifuUserId = getReceiverHuifuIdFromUserDoc(sellerUser || {});
      if (!sellerHuifuUserId || !isReceiverReady(sellerUser || {})) {
        await releaseGoodsPaymentLock({
          goodsId,
          buyerOpenid: OPENID,
          reqDate: lockRes.reqDate,
          reqSeqId: lockRes.reqSeqId,
          reason: 'seller_not_ready',
        });
        return {
          ok: false,
          err: {
            code: 'SELLER_NOT_ONBOARDED',
            msg: '卖家暂未开通收款，无法完成分账',
            hint: '请稍后再试或联系管理员处理。'
          }
        };
      }

      const feeRate = resolvePlatformFeeRate(event);
      const split = buildSplitBunch({
        totalCents,
        feeRate,
        platformHuifuId: cfg.huifuId,
        sellerHuifuId: sellerHuifuUserId,
      });
      if (!split.ok) {
        await releaseGoodsPaymentLock({
          goodsId,
          buyerOpenid: OPENID,
          reqDate: lockRes.reqDate,
          reqSeqId: lockRes.reqSeqId,
          reason: 'split_build_failed',
        });
        return { ok: false, err: split.err };
      }

      const ret = await doJspay({
        transAmtYuan: totalCents / 100,
        goodsDesc: pickStr(goods.title, goods.desc, '商品购买'),
        reqSeqIdInput: lockRes.reqSeqId,
        reqDateInput: lockRes.reqDate,
        delayAcctFlag: 'N',
        acctSplitBunch: split.acctSplitBunch,
      });
      if (!ret || !ret.ok) {
        await releaseGoodsPaymentLock({
          goodsId,
          buyerOpenid: OPENID,
          reqDate: lockRes.reqDate,
          reqSeqId: lockRes.reqSeqId,
          reason: 'order_create_failed',
        });
        return ret;
      }

      await updateGoodsPaymentLock(goodsId, {
        status: 'request_sent',
        reqDate: pickStr(ret.reqDate, lockRes.reqDate),
        reqSeqId: pickStr(ret.reqSeqId, lockRes.reqSeqId),
        requestedAt: new Date(),
        expiresAt: lockRes.expiresAt,
      });

      return {
        ...ret,
        goodsId,
      };
    } catch (e) {
      await releaseGoodsPaymentLock({
        goodsId,
        buyerOpenid: OPENID,
        reqDate: lockRes.reqDate,
        reqSeqId: lockRes.reqSeqId,
        reason: 'jspay_goods_exception',
      });
      throw e;
    }
  }

  if (action === 'release_goods_lock') {
    const goodsId = pickStr(event.goodsId);
    if (!goodsId) return { ok: false, err: { code: 'MISSING_GOODS_ID', msg: '缺少 goodsId' } };
    return await releaseGoodsPaymentLock({
      goodsId,
      buyerOpenid: OPENID,
      reqDate: pickStr(event.reqDate),
      reqSeqId: pickStr(event.reqSeqId),
      reason: pickStr(event.reason, 'client_cancelled'),
    });
  }

  if (action === 'delay_jspay_goods') {
    const goodsId = pickStr(event.goodsId);
    if (!goodsId) return { ok: false, err: { code: 'MISSING_GOODS_ID', msg: '缺少 goodsId' } };

    const goods = await getGoodsById(goodsId);
    if (!goods) return { ok: false, err: { code: 'GOODS_NOT_FOUND', msg: '商品不存在' } };

    const status = pickStr(goods.status) || 'posted';
    if (status !== 'posted') {
      return { ok: false, err: { code: 'NOT_FOR_SALE', msg: '该商品当前不可购买', status } };
    }

    const sellerOpenid = pickStr(goods._openid);
    if (!sellerOpenid) return { ok: false, err: { code: 'MISSING_SELLER', msg: '商品缺少发布者信息' } };
    if (OPENID && sellerOpenid === OPENID) {
      return { ok: false, err: { code: 'CANNOT_BUY_SELF', msg: '不能购买自己发布的商品' } };
    }

    const totalCents = yuanToCents(goods.price);
    if (!totalCents) return { ok: false, err: { code: 'INVALID_PRICE', msg: '商品价格不合法' } };
    if (totalCents < MIN_PUBLISH_AMOUNT_CENTS) {
      return { ok: false, err: { code: 'PRICE_TOO_LOW', msg: `商品价格不能低于 ${MIN_PUBLISH_AMOUNT_YUAN} 元` } };
    }

    const sellerUser = await getUserInfoByOpenid(sellerOpenid);
    const sellerHuifuUserId = getReceiverHuifuIdFromUserDoc(sellerUser || {});
    if (!sellerHuifuUserId || !isReceiverReady(sellerUser || {})) {
      return {
        ok: false,
        err: {
          code: 'SELLER_NOT_ONBOARDED',
          msg: '卖家暂未开通收款，无法完成分账',
          hint: '请稍后再试或联系管理员处理。'
        }
      };
    }

    const feeRate = resolvePlatformFeeRate(event);
    const split = buildSplitBunch({
      totalCents,
      feeRate,
      platformHuifuId: cfg.huifuId,
      sellerHuifuId: sellerHuifuUserId,
    });
    if (!split.ok) return { ok: false, err: split.err };

    const ret = await doJspay({
      transAmtYuan: totalCents / 100,
      goodsDesc: pickStr(goods.title, goods.desc, '商品购买'),
      reqSeqIdInput: event.reqSeqId,
      delayAcctFlag: 'Y',
      acctSplitBunch: '',
    });
    if (!ret || !ret.ok) return ret;

    return {
      ...ret,
      splitPreview: {
        totalCents,
        feeRate,
        feeCents: split.feeCents,
        sellerCents: split.sellerCents,
        platformHuifuId: cfg.huifuId,
        sellerHuifuUserId,
      },
      delayConfirm: {
        orgReqDate: ret.reqDate,
        orgReqSeqId: ret.reqSeqId,
        acctSplitBunch: split.acctSplitBunchObj,
      },
    };
  }

  if (action === 'delay_jspay_task') {
    const taskId = pickStr(event.taskId, event.tid, event.id);
    if (!taskId) return { ok: false, err: { code: 'MISSING_TASK_ID', msg: '缺少 taskId' }, buildTag: BUILD_TAG };

    const task = await getTaskById(taskId);
    if (!task) return { ok: false, err: { code: 'TASK_NOT_FOUND', msg: '任务不存在' }, buildTag: BUILD_TAG };

    // 只能由发布者发起支付
    if (pickStr(task._openid) !== pickStr(OPENID)) {
      return { ok: false, err: { code: 'NOT_OWNER', msg: '只有发布者可以发起支付' }, buildTag: BUILD_TAG };
    }

    const status = pickStr(task.status) || '';
    if (status && status !== 'pay_pending') {
      return { ok: false, err: { code: 'INVALID_STATUS', msg: '当前任务状态不允许发起支付', status }, buildTag: BUILD_TAG };
    }

    const totalCents = yuanToCents(task.amount);
    if (!totalCents) return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '任务佣金不合法' }, buildTag: BUILD_TAG };
    if (totalCents < MIN_PUBLISH_AMOUNT_CENTS) {
      return { ok: false, err: { code: 'AMOUNT_TOO_LOW', msg: `任务佣金不能低于 ${MIN_PUBLISH_AMOUNT_YUAN} 元` }, buildTag: BUILD_TAG };
    }

    const existingPay = (task.pay && typeof task.pay === 'object') ? task.pay : {};
    const reqDate = (/^\d{8}$/.test(pickStr(existingPay.reqDate)) ? pickStr(existingPay.reqDate) : yyyymmdd(new Date()));
    const reqSeqId = pickStr(existingPay.reqSeqId) || `TK${reqDate}${String(taskId).slice(-16)}`;

    const ret = await doJspay({
      transAmtYuan: totalCents / 100,
      goodsDesc: pickStr(task.title, task.desc, '任务支付'),
      reqSeqIdInput: reqSeqId,
      reqDateInput: reqDate,
      delayAcctFlag: 'Y',
      acctSplitBunch: '',
    });
    if (!ret || !ret.ok) return ret;

    // 最佳努力写入：保存“原交易信息”，后续 delay_confirm 需要用到
    try {
      const db = cloud.database();
      const resp = ret.huifuResp || {};
      const orgHfSeqId = pickStr(resp.hf_seq_id, resp.hfSeqId, resp.org_hf_seq_id, resp.orgHfSeqId);
      const orderAmtYuan = positiveMoney(resp.trans_amt || resp.transAmt || task.amount || 0);
      const feeAmtYuan = positiveMoney(resp.fee_amt || resp.fee_amount || existingPay.feeAmtYuan || 0);
      const unconfirmAmtYuan = positiveMoney(resp.unconfirm_amt || resp.unconfirmAmt || existingPay.unconfirmAmtYuan || 0);
      const confirmableAmtYuan = unconfirmAmtYuan || positiveMoney(orderAmtYuan - feeAmtYuan);
      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          pay: {
            ...(existingPay || {}),
            status: 'created',
            delayAcctFlag: 'Y',
            reqDate: ret.reqDate,
            reqSeqId: ret.reqSeqId,
            orgHfSeqId: orgHfSeqId || pickStr(existingPay.orgHfSeqId),
            hfSeqId: orgHfSeqId || pickStr(existingPay.hfSeqId),
            orderAmtYuan: orderAmtYuan || positiveMoney(task.amount),
            transAmtYuan: orderAmtYuan || positiveMoney(task.amount),
            feeAmtYuan,
            unconfirmAmtYuan: unconfirmAmtYuan || confirmableAmtYuan,
            confirmableAmtYuan,
            createdAt: new Date(),
          },
          updatedAt: new Date(),
        }
      });
    } catch (e) {
      console.error('[delay_jspay_task] update task pay failed', e);
    }

    return { ...ret, taskId };
  }

  if (action === 'delay_confirm_task') {
    const taskId = pickStr(event.taskId, event.tid, event.id);
    if (!taskId) return { ok: false, err: { code: 'MISSING_TASK_ID', msg: '缺少 taskId' }, buildTag: BUILD_TAG };
    const confirmOwnerOpenid = systemCompensate ? pickStr(event.ownerOpenid) : pickStr(OPENID);
    if (!confirmOwnerOpenid) {
      return { ok: false, err: { code: 'MISSING_OWNER_OPENID', msg: '缺少任务发布者身份' }, buildTag: BUILD_TAG };
    }

    const preparedConfirm = await prepareTaskDelayConfirmLock({ taskId, ownerOpenid: confirmOwnerOpenid });
    if (!preparedConfirm || !preparedConfirm.ok) {
      return { ...(preparedConfirm || { ok: false, err: { code: 'PREPARE_FAILED', msg: '确认打款预处理失败' } }), buildTag: BUILD_TAG };
    }

    const task = preparedConfirm.task || {};

    const status = pickStr(task.status) || '';
    if (preparedConfirm.alreadyCompleted || status === 'completed') {
      try {
        const completedSplit = task.split && typeof task.split === 'object' ? task.split : {};
        const completedWorkerOpenid = pickStr(task.workerOpenid || task.worker_openid);
        const workerIncome = roundMoney(Number(completedSplit.workerCents || 0) / 100);
        if (completedWorkerOpenid && workerIncome > 0) {
          await recordWalletTransaction({
            openid: completedWorkerOpenid,
            amount: workerIncome,
            type: 'task_income',
            bizKey: `task_income:${taskId}:${pickStr(completedSplit.delayConfirm && completedSplit.delayConfirm.reqSeqId, 'completed')}`,
            title: pickStr(task.title, task.desc, '任务收入'),
            summary: `任务完成到账 ¥${workerIncome.toFixed(2)}，已计入汇付余额`,
            relatedId: taskId,
            counterpartOpenid: pickStr(task._openid),
          });
        }
      } catch (ledgerErr) {
        console.error('[delay_confirm_task] ensure completed wallet mirror failed', ledgerErr);
      }
      return { ok: true, status: 'completed', already: true, buildTag: BUILD_TAG };
    }
    if (preparedConfirm.pending) {
      return {
        ok: true,
        status: 'confirming',
        pending: true,
        reqDate: pickStr(preparedConfirm.reqDate),
        reqSeqId: pickStr(preparedConfirm.reqSeqId),
        msg: '任务正在确认打款，请稍后刷新查看结果',
        buildTag: BUILD_TAG
      };
    }
    if (status !== 'submitted') {
      return { ok: false, err: { code: 'INVALID_STATUS', msg: '当前任务还不能确认完成', status }, buildTag: BUILD_TAG };
    }

    const payObj = (task.pay && typeof task.pay === 'object') ? task.pay : {};
    const orgReqDate = pickStr(payObj.reqDate);
    const orgReqSeqId = pickStr(payObj.reqSeqId);
    const orgHfSeqId = pickStr(payObj.orgHfSeqId);
    if (!orgReqDate || (!orgReqSeqId && !orgHfSeqId)) {
      await markTaskDelayConfirmFailed({
        taskId,
        task,
        code: 'MISSING_ORG_TRADE',
        msg: '缺少原交易信息（无法延时分账确认）',
        reqDate: pickStr(preparedConfirm.reqDate),
        reqSeqId: pickStr(preparedConfirm.reqSeqId),
        resetReq: true,
      });
      return { ok: false, err: { code: 'MISSING_ORG_TRADE', msg: '缺少原交易信息（无法延时分账确认）' }, buildTag: BUILD_TAG };
    }

    const workerHuifuId = pickStr(task.workerHuifuId);
    const workerOpenid = pickStr(task.workerOpenid || task.worker_openid);

    let finalWorkerHuifuId = workerHuifuId;
    let workerUser = null;
    if (!finalWorkerHuifuId && workerOpenid) {
      workerUser = await getUserInfoByOpenid(workerOpenid);
      finalWorkerHuifuId = getReceiverHuifuIdFromUserDoc(workerUser || {});
    }

    if (!finalWorkerHuifuId || (workerUser && !isReceiverReady(workerUser || {}))) {
      await markTaskDelayConfirmFailed({
        taskId,
        task,
        code: 'WORKER_NOT_HUIFU_READY',
        msg: '接单人暂未开通收款，无法打款',
        reqDate: pickStr(preparedConfirm.reqDate),
        reqSeqId: pickStr(preparedConfirm.reqSeqId),
        resetReq: true,
      });
      return {
        ok: false,
        err: { code: 'WORKER_NOT_HUIFU_READY', msg: '接单人暂未开通收款，无法打款' },
        buildTag: BUILD_TAG
      };
    }

    const payAmounts = resolveTaskPaymentAmounts(task);
    const orderCents = payAmounts.orderCents || yuanToCents(task.amount);
    if (!orderCents) {
      await markTaskDelayConfirmFailed({
        taskId,
        task,
        code: 'INVALID_AMOUNT',
        msg: '任务佣金不合法',
        reqDate: pickStr(preparedConfirm.reqDate),
        reqSeqId: pickStr(preparedConfirm.reqSeqId),
        resetReq: true,
      });
      return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '任务佣金不合法' }, buildTag: BUILD_TAG };
    }
    const confirmableCents = payAmounts.confirmableCents;
    const feeRate = resolvePlatformFeeRate(event);
    const split = buildTaskDelayConfirmSplitBunch({
      orderCents,
      confirmableCents,
      feeRate,
      platformHuifuId: cfg.huifuId,
      sellerHuifuId: finalWorkerHuifuId,
    });
    if (!split.ok) {
      await markTaskDelayConfirmFailed({
        taskId,
        task,
        code: pickStr(split.err && split.err.code, 'SPLIT_BUILD_FAILED'),
        msg: pickStr(split.err && split.err.msg, '确认打款金额构造失败'),
        reqDate: pickStr(preparedConfirm.reqDate),
        reqSeqId: pickStr(preparedConfirm.reqSeqId),
        resetReq: true,
        extra: {
          confirmableCents,
          paymentFeeCents: payAmounts.paymentFeeCents,
        },
      });
      return { ok: false, err: split.err, buildTag: BUILD_TAG };
    }

    const data = {
      req_seq_id: pickStr(preparedConfirm.reqSeqId, event.reqSeqId),
      req_date: pickStr(preparedConfirm.reqDate, yyyymmdd(new Date())),
      huifu_id: cfg.huifuId,
      org_req_date: orgReqDate,
      org_req_seq_id: orgReqSeqId,
      org_hf_seq_id: orgHfSeqId,
      acct_split_bunch: split.acctSplitBunch,
    };

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_DELAY_CONFIRM_PATH);
    const resp = await callSigned({ pathName, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };

    const respCode = pickStr(respData && (respData.resp_code || respData.return_code || respData.code || respData.respCode));
    const respDesc = pickStr(respData && (respData.resp_desc || respData.resp_msg || respData.return_msg || respData.message || respData.respDesc));
    if (respCode && respCode !== '00000000') {
      await markTaskDelayConfirmFailed({
        taskId,
        task,
        code: 'HUIFU_BIZ_ERROR',
        msg: respDesc ? `${respCode}:${respDesc}` : respCode,
        respCode,
        respDesc,
        reqDate: data.req_date,
        reqSeqId: data.req_seq_id,
        resetReq: true,
        extra: {
          confirmableCents: split.confirmableCents,
          paymentFeeCents: split.paymentFeeCents,
        },
      });

      return {
        ok: false,
        err: {
          code: 'HUIFU_BIZ_ERROR',
          msg: respDesc ? `${respCode}:${respDesc}` : respCode,
          respCode,
          respDesc,
          respData,
        },
        buildTag: BUILD_TAG
      };
    }

    // 最佳努力回写任务状态
    try {
      const db = cloud.database();
      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
          split: {
            mode: 'delay',
            status: 'completed',
            feeRate,
            totalCents: orderCents,
            confirmableCents: split.confirmableCents,
            feeCents: split.feeCents,
            grossFeeCents: split.grossFeeCents,
            workerCents: split.sellerCents,
            paymentFeeCents: split.paymentFeeCents,
            platformHuifuId: cfg.huifuId,
            workerHuifuId: finalWorkerHuifuId,
            delayConfirm: {
              reqDate: data.req_date,
              reqSeqId: data.req_seq_id,
              orgReqDate,
              orgReqSeqId,
              orgHfSeqId,
              confirmedAt: new Date(),
              lockExpiresAt: new Date(),
            },
            huifuResp: respData,
          }
        }
      });
    } catch (e) {
      console.error('[delay_confirm_task] update task failed', e);
    }

    try {
      const workerIncome = roundMoney(split.sellerCents / 100);
      if (workerOpenid && workerIncome > 0) {
        await recordWalletTransaction({
          openid: workerOpenid,
          amount: workerIncome,
          type: 'task_income',
          bizKey: `task_income:${taskId}:${data.req_seq_id}`,
          title: pickStr(task.title, task.desc, '任务收入'),
          summary: `任务完成到账 ¥${workerIncome.toFixed(2)}，已计入汇付余额，平台分成 ¥${roundMoney(split.feeCents / 100).toFixed(2)}，支付手续费 ¥${roundMoney(split.paymentFeeCents / 100).toFixed(2)}`,
          relatedId: taskId,
          counterpartOpenid: pickStr(task._openid),
          createdAt: new Date(),
        });
      }
    } catch (ledgerErr) {
      console.error('[delay_confirm_task] wallet mirror failed', ledgerErr);
    }

    return {
      ok: true,
      apiPath: pathName,
      reqSeqId: data.req_seq_id,
      reqDate: data.req_date,
      huifuResp: respData,
      splitPreview: {
        totalCents: orderCents,
        confirmableCents: split.confirmableCents,
        feeRate,
        feeCents: split.feeCents,
        grossFeeCents: split.grossFeeCents,
        workerCents: split.sellerCents,
        paymentFeeCents: split.paymentFeeCents,
        platformHuifuId: cfg.huifuId,
        workerHuifuId: finalWorkerHuifuId,
      },
      buildTag: BUILD_TAG
    };
  }

  if (action === 'user_indv_open') {
    const data = {
      req_seq_id: pickStr(event.reqSeqId, `UO${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: yyyymmdd(new Date()),
      name: pickStr(event.name),
      cert_type: pickStr(event.certType, '00'),
      cert_no: pickStr(event.certNo),
      cert_validity_type: pickStr(event.certValidityType),
      cert_begin_date: pickStr(event.certBeginDate),
      cert_end_date: pickStr(event.certEndDate),
      mobile_no: pickStr(event.mobileNo),
    };
    if (!data.name || !data.cert_type || !data.cert_no || !data.cert_validity_type || !data.cert_begin_date || !data.mobile_no) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '个人用户开户缺少必填参数' }, buildTag: BUILD_TAG };
    }
    if (data.cert_validity_type === '0' && !data.cert_end_date) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '证件非长期有效时缺少 certEndDate' }, buildTag: BUILD_TAG };
    }
    if (data.cert_validity_type === '1' && data.cert_end_date) delete data.cert_end_date;

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_USER_INDV_OPEN_PATH);
    const resp = await callSigned({ pathName, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  if (action === 'user_busi_open') {
    const data = {
      huifu_id: pickStr(event.userHuifuId),
      req_seq_id: pickStr(event.reqSeqId, `UB${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: yyyymmdd(new Date()),
      upper_huifu_id: pickStr(event.upperHuifuId, process.env.HUIFU_UPPER_HUIFU_ID, cfg.huifuId),
    };
    const cashType = pickStr(event.cashType, event.cash_type).toUpperCase();
    const cardInfo = safeJsonStringify(event.cardInfo);
    const cashConfig = safeJsonStringify(
      event.cashConfig || (cashType
        ? [{
          cash_type: cashType,
          fix_amt: pickStr(event.fixAmt, event.fix_amt, '0.00'),
          fee_rate: pickStr(event.feeRate, event.fee_rate, '0.00'),
        }]
        : null)
    );
    if (cashConfig) data.cash_config = cashConfig;
    if (cardInfo) data.card_info = cardInfo;

    if (!data.huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 userHuifuId（用户汇付ID）' }, buildTag: BUILD_TAG };
    if (!data.upper_huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 upperHuifuId' }, buildTag: BUILD_TAG };

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_USER_BUSI_OPEN_PATH);
    const resp = await callSigned({ pathName, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  if (action === 'user_busi_modify') {
    const data = {
      huifu_id: pickStr(event.userHuifuId),
      req_seq_id: pickStr(event.reqSeqId, `UM${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: pickStr(event.reqDate, yyyymmdd(new Date())),
      upper_huifu_id: pickStr(event.upperHuifuId, process.env.HUIFU_UPPER_HUIFU_ID, cfg.huifuId),
    };

    const cardInfo = safeJsonStringify(event.cardInfo);
    const settleConfigList = safeJsonStringify(event.settleConfigList);
    const cashConfig = safeJsonStringify(event.cashConfig);
    const fileList = safeJsonStringify(event.fileList);
    const asyncReturnUrlRaw = pickStr(
      event.asyncReturnUrl,
      event.async_return_url,
      process.env.HUIFU_USER_BUSI_NOTIFY_URL,
      process.env.HUIFU_NOTIFY_URL
    );
    const asyncReturnUrlTooLong = !!(asyncReturnUrlRaw && asyncReturnUrlRaw.length > 128);
    const asyncReturnUrl = asyncReturnUrlTooLong ? '' : asyncReturnUrlRaw;

    if (cardInfo) data.card_info = cardInfo;
    if (settleConfigList) data.settle_config_list = settleConfigList;
    if (cashConfig) data.cash_config = cashConfig;
    if (fileList) data.file_list = fileList;
    if (asyncReturnUrl) data.async_return_url = asyncReturnUrl;

    if (!data.huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 userHuifuId（用户汇付ID）' }, buildTag: BUILD_TAG };
    if (!data.upper_huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 upperHuifuId' }, buildTag: BUILD_TAG };
    if (!data.card_info && !data.settle_config_list && !data.cash_config && !data.file_list) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '用户业务入驻修改至少需要一项配置(cardInfo/settleConfigList/cashConfig/fileList)' }, buildTag: BUILD_TAG };
    }

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_USER_BUSI_MODIFY_PATH);
    const resp = await callSigned({ pathName, data });
    const { okHttp, respData } = unwrapHuifuResp(resp);
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return {
      ok: true,
      apiPath: pathName,
      reqSeqId: data.req_seq_id,
      reqDate: data.req_date,
      huifuResp: respData,
      warn: asyncReturnUrlTooLong
        ? {
          code: 'ASYNC_RETURN_URL_OMITTED',
          msg: 'HUIFU_USER_BUSI_NOTIFY_URL/HUIFU_NOTIFY_URL 超过 128 字符，本次未上传 async_return_url',
        }
        : null,
      buildTag: BUILD_TAG
    };
  }

  if (action === 'user_info_query') {
    const data = {
      huifu_id: pickStr(event.userHuifuId),
      req_seq_id: pickStr(event.reqSeqId, `UQ${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: pickStr(event.reqDate, yyyymmdd(new Date())),
    };
    if (!data.huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 userHuifuId（用户汇付ID）' }, buildTag: BUILD_TAG };

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_USER_INFO_QUERY_PATH);
    const resp = await callSigned({ pathName, data });
    const { okHttp, respData } = unwrapHuifuResp(resp);
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  if (action === 'acct_balance_query') {
    const data = {
      huifu_id: pickStr(event.userHuifuId, event.huifuIdToQuery),
      req_seq_id: pickStr(event.reqSeqId, `AQ${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: pickStr(event.reqDate, yyyymmdd(new Date())),
      acct_date: pickStr(event.acctDate),
    };
    if (!data.huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 userHuifuId（用户汇付ID）' }, buildTag: BUILD_TAG };
    if (!data.acct_date) delete data.acct_date;

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_ACCT_BALANCE_QUERY_PATH);
    const resp = await callSigned({ pathName, data });
    const { okHttp, respData } = unwrapHuifuResp(resp);
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  if (action === 'withdraw_apply') {
    const cashAmt = formatYuan2(pickStr(event.cashAmt, event.amount));
    if (!cashAmt) return { ok: false, err: { code: 'INVALID_CASH_AMT', msg: '提现金额不合法' }, buildTag: BUILD_TAG };
    const notifyUrlRaw = pickStr(
      event.notifyUrl,
      event.notify_url,
      process.env.HUIFU_WITHDRAW_NOTIFY_URL,
      process.env.HUIFU_NOTIFY_URL
    );
    const notifyUrlTooLong = !!(notifyUrlRaw && notifyUrlRaw.length > 128);
    const notifyUrl = notifyUrlTooLong ? '' : notifyUrlRaw;

    const data = {
      req_seq_id: pickStr(event.reqSeqId, `WD${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: pickStr(event.reqDate, yyyymmdd(new Date())),
      cash_amt: cashAmt,
      huifu_id: pickStr(event.userHuifuId),
      acct_id: pickStr(event.acctId),
      into_acct_date_type: pickStr(event.intoAcctDateType, 'D1').toUpperCase(),
      token_no: pickStr(event.tokenNo),
      enchashment_channel: pickStr(event.enchashmentChannel),
      fee_type: pickStr(event.feeType),
      remark: clampStr(event.remark || '钱包提现', 100),
      notify_url: notifyUrl,
    };

    if (!data.huifu_id || !data.into_acct_date_type || !data.token_no) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '提现缺少 userHuifuId / intoAcctDateType / tokenNo' }, buildTag: BUILD_TAG };
    }
    if (!data.acct_id) delete data.acct_id;
    if (!data.enchashment_channel) delete data.enchashment_channel;
    if (!data.fee_type) delete data.fee_type;
    if (!data.notify_url) delete data.notify_url;

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_WITHDRAW_PATH);
    const resp = await callSigned({ pathName, data, copyLogLabel: 'withdraw_apply' });
    const { okHttp, respData } = unwrapHuifuResp(resp);
    const copyableRequest = resp && resp.requestMeta ? resp.requestMeta : {
      host: hostName,
      path: pathName,
      body: {
        sys_id: cfg.sysId,
        product_id: cfg.productId,
        data,
      }
    };
    const copyableResponse = {
      statusCode: resp && resp.statusCode,
      body: resp && resp.json ? resp.json : (resp && resp.raw),
    };
    if (!okHttp) {
      return {
        ok: false,
        err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw },
        reqSeqId: data.req_seq_id,
        reqDate: data.req_date,
        copyableRequest,
        copyableResponse,
        buildTag: BUILD_TAG
      };
    }
    return {
      ok: true,
      apiPath: pathName,
      reqSeqId: data.req_seq_id,
      reqDate: data.req_date,
      huifuResp: respData,
      copyableRequest,
      copyableResponse,
      warn: notifyUrlTooLong
        ? {
          code: 'NOTIFY_URL_OMITTED',
          msg: 'HUIFU_WITHDRAW_NOTIFY_URL/HUIFU_NOTIFY_URL 超过 128 字符，本次未上传 notify_url',
        }
        : null,
      buildTag: BUILD_TAG
    };
  }

  if (action === 'withdraw_query') {
    const data = {
      req_seq_id: pickStr(event.queryReqSeqId, event.reqSeqId, `WQ${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: pickStr(event.queryReqDate, event.reqDate, yyyymmdd(new Date())),
      huifu_id: pickStr(event.userHuifuId, event.huifuIdToQuery),
      org_req_seq_id: pickStr(event.orgReqSeqId, event.withdrawReqSeqId, event.reqSeqIdToQuery),
      org_req_date: pickStr(event.orgReqDate, event.withdrawReqDate, event.reqDateToQuery),
      org_hf_seq_id: pickStr(event.orgHfSeqId, event.hfSeqId, event.withdrawHfSeqId),
    };
    if (!data.huifu_id) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '提现查询缺少 userHuifuId' }, buildTag: BUILD_TAG };
    }
    if (!data.org_hf_seq_id && !(data.org_req_seq_id && data.org_req_date)) {
      return {
        ok: false,
        err: { code: 'MISSING_PARAM', msg: '提现查询缺少 orgHfSeqId 或 orgReqSeqId+orgReqDate' },
        buildTag: BUILD_TAG
      };
    }
    if (!data.org_hf_seq_id) delete data.org_hf_seq_id;
    if (!data.org_req_seq_id) delete data.org_req_seq_id;
    if (!data.org_req_date) delete data.org_req_date;

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_WITHDRAW_QUERY_PATH);
    const resp = await callSigned({ pathName, data, copyLogLabel: 'withdraw_query' });
    const { okHttp, respData } = unwrapHuifuResp(resp);
    const copyableRequest = resp && resp.requestMeta ? resp.requestMeta : {
      host: hostName,
      path: pathName,
      body: {
        sys_id: cfg.sysId,
        product_id: cfg.productId,
        data,
      }
    };
    const copyableResponse = {
      statusCode: resp && resp.statusCode,
      body: resp && resp.json ? resp.json : (resp && resp.raw),
    };
    if (!okHttp) {
      return {
        ok: false,
        err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw },
        reqSeqId: data.req_seq_id,
        reqDate: data.req_date,
        copyableRequest,
        copyableResponse,
        buildTag: BUILD_TAG
      };
    }
    return {
      ok: true,
      apiPath: pathName,
      reqSeqId: data.req_seq_id,
      reqDate: data.req_date,
      huifuResp: respData,
      copyableRequest,
      copyableResponse,
      buildTag: BUILD_TAG
    };
  }

  if (action === 'delay_confirm') {
    const acctSplitBunchObj = pickObj(event.acctSplitBunch);
    const acctSplitBunchStr = pickStr(event.acctSplitBunch);
    const acctSplitBunch = acctSplitBunchObj ? JSON.stringify(acctSplitBunchObj) : acctSplitBunchStr;

    const data = {
      req_seq_id: pickStr(event.reqSeqId, `DC${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: yyyymmdd(new Date()),
      huifu_id: cfg.huifuId,
      org_req_date: pickStr(event.orgReqDate),
      org_req_seq_id: pickStr(event.orgReqSeqId),
      org_hf_seq_id: pickStr(event.orgHfSeqId),
    };
    if (acctSplitBunch) data.acct_split_bunch = acctSplitBunch;

    if (!data.org_req_date || (!data.org_req_seq_id && !data.org_hf_seq_id)) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 orgReqDate + (orgReqSeqId 或 orgHfSeqId)' }, buildTag: BUILD_TAG };
    }

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_DELAY_CONFIRM_PATH);
    const resp = await callSigned({ pathName, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  if (action === 'scanpay_refund') {
    const ordAmt = formatYuan2(event.ordAmtYuan);
    if (!ordAmt) return { ok: false, err: { code: 'INVALID_ORD_AMT', msg: '退款金额不合法' }, buildTag: BUILD_TAG };
    const notifyUrlRaw = pickStr(
      event.notifyUrl,
      event.notify_url,
      process.env.HUIFU_NOTIFY_URL
    );
    const notifyUrlTooLong = !!(notifyUrlRaw && notifyUrlRaw.length > 512);
    const notifyUrl = notifyUrlTooLong ? '' : notifyUrlRaw;

    const data = {
      req_seq_id: pickStr(event.reqSeqId, `RF${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: pickStr(event.reqDate, yyyymmdd(new Date())),
      huifu_id: cfg.huifuId,
      ord_amt: ordAmt,
      org_req_date: pickStr(event.orgReqDate),
      org_req_seq_id: pickStr(event.orgReqSeqId),
      org_hf_seq_id: pickStr(event.orgHfSeqId),
      refund_desc: clampStr(event.refundDesc || '订单退款', 180),
      notify_url: notifyUrl,
    };

    if (!data.org_req_date || (!data.org_req_seq_id && !data.org_hf_seq_id)) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 orgReqDate + (orgReqSeqId 或 orgHfSeqId)' }, buildTag: BUILD_TAG };
    }
    if (!data.notify_url) delete data.notify_url;

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_SCANPAY_REFUND_PATH);
    const resp = await callSigned({ pathName, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return {
      ok: true,
      apiPath: pathName,
      reqSeqId: data.req_seq_id,
      reqDate: data.req_date,
      huifuResp: respData,
      warn: notifyUrlTooLong
        ? {
          code: 'NOTIFY_URL_OMITTED',
          msg: 'HUIFU_NOTIFY_URL 超过 512 字符，本次未上传 notify_url',
        }
        : null,
      buildTag: BUILD_TAG
    };
  }

  if (action === 'scanpay_refund_query') {
    const data = {
      huifu_id: pickStr(event.huifuIdToQuery, event.userHuifuId, cfg.huifuId),
      // 汇付 v3 退款查询接口里的 org_* 字段，查询的是“退款请求”本身，不是原支付单。
      org_req_date: pickStr(event.refundReqDate, event.reqDateToQuery, event.orgReqDate),
      org_req_seq_id: pickStr(event.refundReqSeqId, event.reqSeqIdToQuery, event.orgReqSeqId),
      org_hf_seq_id: pickStr(event.refundHfSeqId, event.hfSeqIdToQuery, event.orgHfSeqId),
      mer_ord_id: pickStr(event.merOrdId, event.mer_ord_id),
    };
    if (!data.huifu_id) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '退款查询缺少 huifu_id' }, buildTag: BUILD_TAG };
    }
    if (!data.org_hf_seq_id && !(data.org_req_seq_id && data.org_req_date)) {
      return {
        ok: false,
        err: { code: 'MISSING_PARAM', msg: '退款查询缺少 refundHfSeqId 或 refundReqSeqId+refundReqDate' },
        buildTag: BUILD_TAG
      };
    }
    if (!data.org_hf_seq_id) delete data.org_hf_seq_id;
    if (!data.org_req_seq_id) delete data.org_req_seq_id;
    if (!data.org_req_date) delete data.org_req_date;
    if (!data.mer_ord_id) delete data.mer_ord_id;

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_SCANPAY_REFUND_QUERY_PATH);
    const resp = await callSigned({ pathName, data, copyLogLabel: 'refund_query' });
    const { okHttp, respData } = unwrapHuifuResp(resp);
    if (!okHttp) {
      return {
        ok: false,
        err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw },
        buildTag: BUILD_TAG
      };
    }
    return {
      ok: true,
      apiPath: pathName,
      huifuResp: respData,
      buildTag: BUILD_TAG
    };
  }

  return { ok: false, err: `unsupported_action: ${action}`, buildTag: BUILD_TAG };
};
