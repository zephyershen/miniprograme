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
const DEFAULT_HUIFU_DELAY_CONFIRM_PATH = '/v2/trade/payment/delaytrans/confirm';
const DEFAULT_HUIFU_SCANPAY_REFUND_PATH = '/v3/trade/payment/scanpay/refund';

const USER_COLLECTION = 'userInfo';
const GOODS_COLLECTION = 'goods';
const TASK_COLLECTION = 'tasks';
const BUILD_TAG = 'huifuMiniappPay@2026-02-26.1';

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
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
  return Math.round(n * 100);
}

function centsToYuanStr(cents) {
  const c = Number(cents);
  if (!Number.isFinite(c) || c < 0) return '';
  return (c / 100).toFixed(2);
}

function calcPlatformFeeCents({ totalCents, feeRate = 0.03 }) {
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
  if (!s) return true; // 兼容旧数据：没字段时先当作成功（仍会校验 huifu_id 是否存在）
  return s === 'success';
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

async function getTaskById(taskId) {
  const db = cloud.database();
  const res = await db.collection(TASK_COLLECTION).doc(taskId).get();
  return (res && res.data) ? res.data : null;
}

async function huifuCallSignedJson({ hostName, pathName, cfg, data }) {
  const signPayload = buildSortedJsonStringForSign(data);
  const sign = rsaSha256SignBase64({ message: signPayload, privateKeyPem: cfg.privateKey });
  const body = {
    sys_id: cfg.sysId,
    product_id: cfg.productId,
    data,
    sign,
  };
  return await huifuRequest({ hostName, pathName, body });
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const cfg = resolveHuifuConfig(event);

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
  const action = pickStr(event.action, 'jspay');

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
    const resp = await huifuCallSignedJson({ hostName, pathName, cfg, data });
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

    const sellerUser = await getUserInfoByOpenid(sellerOpenid);
    const sellerHuifuUserId = getHuifuUserIdFromUserDoc(sellerUser || {});
    if (!sellerHuifuUserId || !isHuifuOpenSuccess(sellerUser || {})) {
      return {
        ok: false,
        err: {
          code: 'SELLER_NOT_ONBOARDED',
          msg: '卖家暂未开通收款（未绑定汇付账户），无法完成分账',
          hint: '需要卖家先完成“个人用户开户”（注册会自动开户；如失败可重试开户）。'
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

    return await doJspay({
      transAmtYuan: totalCents / 100,
      goodsDesc: pickStr(goods.title, goods.desc, '商品购买'),
      reqSeqIdInput: event.reqSeqId,
      delayAcctFlag: 'N',
      acctSplitBunch: split.acctSplitBunch,
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

    const sellerUser = await getUserInfoByOpenid(sellerOpenid);
    const sellerHuifuUserId = getHuifuUserIdFromUserDoc(sellerUser || {});
    if (!sellerHuifuUserId || !isHuifuOpenSuccess(sellerUser || {})) {
      return {
        ok: false,
        err: {
          code: 'SELLER_NOT_ONBOARDED',
          msg: '卖家暂未开通收款（未绑定汇付账户），无法完成分账',
          hint: '需要卖家先完成“个人用户开户”（注册会自动开户；如失败可重试开户）。'
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
      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          pay: {
            ...(existingPay || {}),
            status: 'created',
            delayAcctFlag: 'Y',
            reqDate: ret.reqDate,
            reqSeqId: ret.reqSeqId,
            orgHfSeqId: orgHfSeqId || pickStr(existingPay.orgHfSeqId),
            transAmtYuan: Number(task.amount),
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

    const task = await getTaskById(taskId);
    if (!task) return { ok: false, err: { code: 'TASK_NOT_FOUND', msg: '任务不存在' }, buildTag: BUILD_TAG };

    if (pickStr(task._openid) !== pickStr(OPENID)) {
      return { ok: false, err: { code: 'NOT_OWNER', msg: '只有发布者可以确认完成' }, buildTag: BUILD_TAG };
    }

    const status = pickStr(task.status) || '';
    if (status === 'completed') return { ok: true, status: 'completed', already: true, buildTag: BUILD_TAG };
    if (status !== 'submitted') {
      return { ok: false, err: { code: 'INVALID_STATUS', msg: '当前任务还不能确认完成', status }, buildTag: BUILD_TAG };
    }

    const payObj = (task.pay && typeof task.pay === 'object') ? task.pay : {};
    const orgReqDate = pickStr(payObj.reqDate);
    const orgReqSeqId = pickStr(payObj.reqSeqId);
    const orgHfSeqId = pickStr(payObj.orgHfSeqId);
    if (!orgReqDate || (!orgReqSeqId && !orgHfSeqId)) {
      return { ok: false, err: { code: 'MISSING_ORG_TRADE', msg: '缺少原交易信息（无法延时分账确认）' }, buildTag: BUILD_TAG };
    }

    const totalCents = yuanToCents(task.amount);
    if (!totalCents) return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '任务佣金不合法' }, buildTag: BUILD_TAG };

    const workerHuifuId = pickStr(task.workerHuifuId);
    const workerOpenid = pickStr(task.workerOpenid || task.worker_openid);

    let finalWorkerHuifuId = workerHuifuId;
    let workerUser = null;
    if (!finalWorkerHuifuId && workerOpenid) {
      workerUser = await getUserInfoByOpenid(workerOpenid);
      finalWorkerHuifuId = getHuifuUserIdFromUserDoc(workerUser || {});
    }

    if (!finalWorkerHuifuId || (workerUser && !isHuifuOpenSuccess(workerUser || {}))) {
      return {
        ok: false,
        err: { code: 'WORKER_NOT_HUIFU_READY', msg: '接单人暂未开通收款（汇付开户未成功），无法打款' },
        buildTag: BUILD_TAG
      };
    }

    const feeRate = resolvePlatformFeeRate(event);
    const split = buildSplitBunch({
      totalCents,
      feeRate,
      platformHuifuId: cfg.huifuId,
      sellerHuifuId: finalWorkerHuifuId,
    });
    if (!split.ok) return { ok: false, err: split.err, buildTag: BUILD_TAG };

    const data = {
      req_seq_id: pickStr(event.reqSeqId, `DC${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: yyyymmdd(new Date()),
      huifu_id: cfg.huifuId,
      org_req_date: orgReqDate,
      org_req_seq_id: orgReqSeqId,
      org_hf_seq_id: orgHfSeqId,
      acct_split_bunch: split.acctSplitBunch,
    };

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_DELAY_CONFIRM_PATH);
    const resp = await huifuCallSignedJson({ hostName, pathName, cfg, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };

    const respCode = pickStr(respData && (respData.resp_code || respData.return_code || respData.code || respData.respCode));
    const respDesc = pickStr(respData && (respData.resp_desc || respData.resp_msg || respData.return_msg || respData.message || respData.respDesc));
    if (respCode && respCode !== '00000000') {
      // 最佳努力记录失败原因，方便排查；不把任务标记为 completed
      try {
        const db = cloud.database();
        await db.collection(TASK_COLLECTION).doc(taskId).update({
          data: {
            updatedAt: new Date(),
            split: {
              ...(task.split || {}),
              mode: 'delay',
              lastError: {
                respCode,
                respDesc,
                at: new Date(),
              },
            }
          }
        });
      } catch (e) {
        console.error('[delay_confirm_task] save split error failed', e);
      }

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
            feeRate,
            totalCents,
            feeCents: split.feeCents,
            workerCents: split.sellerCents,
            platformHuifuId: cfg.huifuId,
            workerHuifuId: finalWorkerHuifuId,
            delayConfirm: {
              reqDate: data.req_date,
              reqSeqId: data.req_seq_id,
              orgReqDate,
              orgReqSeqId,
              orgHfSeqId,
            },
            huifuResp: respData,
          }
        }
      });
    } catch (e) {
      console.error('[delay_confirm_task] update task failed', e);
    }

    return {
      ok: true,
      apiPath: pathName,
      reqSeqId: data.req_seq_id,
      reqDate: data.req_date,
      huifuResp: respData,
      splitPreview: {
        totalCents,
        feeRate,
        feeCents: split.feeCents,
        workerCents: split.sellerCents,
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
      cert_validity_type: pickStr(event.certValidityType, '1'),
      cert_begin_date: pickStr(event.certBeginDate, '20000101'),
      cert_end_date: pickStr(event.certEndDate),
      mobile_no: pickStr(event.mobileNo),
    };
    if (!data.name || !data.cert_no || !data.mobile_no) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 name/certNo/mobileNo' }, buildTag: BUILD_TAG };
    }

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_USER_INDV_OPEN_PATH);
    const resp = await huifuCallSignedJson({ hostName, pathName, cfg, data });
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
      upper_huifu_id: pickStr(event.upperHuifuId, cfg.huifuId),
    };

    const settleConfigList = event.settleConfigList;
    const cardInfo = event.cardInfo;
    const cashConfig = event.cashConfig;
    const elecAcctConfig = event.elecAcctConfig;

    if (!data.huifu_id) return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 userHuifuId（用户汇付ID）' }, buildTag: BUILD_TAG };

    if (Array.isArray(settleConfigList) && settleConfigList.length) {
      data.settle_config_list = JSON.stringify(settleConfigList);
    }
    if (cardInfo && typeof cardInfo === 'object') {
      data.card_info = JSON.stringify(cardInfo);
    }
    if (Array.isArray(cashConfig) && cashConfig.length) {
      data.cash_config = JSON.stringify(cashConfig);
    }
    if (elecAcctConfig && typeof elecAcctConfig === 'object') {
      data.elec_acct_config = elecAcctConfig;
    }

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_USER_BUSI_OPEN_PATH);
    const resp = await huifuCallSignedJson({ hostName, pathName, cfg, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
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
    const resp = await huifuCallSignedJson({ hostName, pathName, cfg, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  if (action === 'scanpay_refund') {
    const ordAmt = formatYuan2(event.ordAmtYuan);
    if (!ordAmt) return { ok: false, err: { code: 'INVALID_ORD_AMT', msg: '退款金额不合法' }, buildTag: BUILD_TAG };

    const data = {
      req_seq_id: pickStr(event.reqSeqId, `RF${yyyymmdd(new Date())}${randomId(20)}`),
      req_date: yyyymmdd(new Date()),
      huifu_id: cfg.huifuId,
      ord_amt: ordAmt,
      org_req_date: pickStr(event.orgReqDate),
      org_req_seq_id: pickStr(event.orgReqSeqId),
      org_hf_seq_id: pickStr(event.orgHfSeqId),
      refund_desc: clampStr(event.refundDesc || '订单退款', 180),
    };

    if (!data.org_req_date || (!data.org_req_seq_id && !data.org_hf_seq_id)) {
      return { ok: false, err: { code: 'MISSING_PARAM', msg: '缺少 orgReqDate + (orgReqSeqId 或 orgHfSeqId)' }, buildTag: BUILD_TAG };
    }

    const pathName = pickStr(event.apiPath, DEFAULT_HUIFU_SCANPAY_REFUND_PATH);
    const resp = await huifuCallSignedJson({ hostName, pathName, cfg, data });
    const okHttp = resp.statusCode >= 200 && resp.statusCode < 300;
    const rawTop = resp.json || {};
    const respData = (rawTop && typeof rawTop === 'object' && rawTop.data) ? rawTop.data : rawTop;
    if (!okHttp) return { ok: false, err: { code: 'HTTP_ERROR', statusCode: resp.statusCode, raw: resp.raw }, buildTag: BUILD_TAG };
    return { ok: true, apiPath: pathName, reqSeqId: data.req_seq_id, reqDate: data.req_date, huifuResp: respData, buildTag: BUILD_TAG };
  }

  return { ok: false, err: `unsupported_action: ${action}`, buildTag: BUILD_TAG };
};
