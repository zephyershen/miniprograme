const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const GOODS_COLLECTION = 'goods';
const TASK_COLLECTION = 'tasks';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';
const WITHDRAW_COLLECTION = 'wallet_withdraw_requests';
const LOG_COLLECTION = 'finance_compensate_logs';
const NOTIFY_LOG_COLLECTION = 'huifu_notify_logs';
const BUILD_TAG = 'financeCompensate@2026-03-16.2';
const DEFAULT_LOG_RETENTION_DAYS = clampInt(process.env.FINANCE_LOG_RETENTION_DAYS, 7, 1, 365);

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function clampInt(v, fallback = 50, min = 1, max = 200) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isAuthorized(event = {}) {
  const token = pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);
  return !!(token && pickStr(event.compensateToken) === token);
}

async function ensureCollectionExists(name) {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (e) {
    // ignore
  }
}

async function writeRunLog(payload = {}) {
  try {
    await ensureCollectionExists(LOG_COLLECTION);
    await db.collection(LOG_COLLECTION).add({
      data: {
        ...payload,
        buildTag: BUILD_TAG,
        createdAt: new Date(),
      }
    });
  } catch (e) {
    console.error('[financeCompensate] write log failed', e);
  }
}

async function cleanupCollectionOlderThan({ collectionName = '', cutoffDate, dryRun = false }) {
  const name = pickStr(collectionName);
  if (!name || !(cutoffDate instanceof Date)) {
    return { ok: false, code: 'INVALID_LOG_CLEANUP_INPUT', msg: '缺少日志清理参数' };
  }
  try {
    const query = db.collection(name).where({ createdAt: _.lt(cutoffDate) });
    const countRes = await query.count();
    const matchedCount = Number(countRes && countRes.total) || 0;
    if (dryRun || matchedCount <= 0) {
      return {
        ok: true,
        collection: name,
        matchedCount,
        removedCount: 0,
        dryRun,
      };
    }
    const removeRes = await query.remove();
    const removedCount = Number(
      removeRes && removeRes.stats && (
        removeRes.stats.removed
        || removeRes.stats.deleted
        || removeRes.stats.count
      )
    ) || matchedCount;
    return {
      ok: true,
      collection: name,
      matchedCount,
      removedCount,
      dryRun,
    };
  } catch (err) {
    const msg = pickStr(err && err.message, err);
    if (/collection.*not exists/i.test(msg) || /does not exist/i.test(msg)) {
      return {
        ok: true,
        collection: name,
        matchedCount: 0,
        removedCount: 0,
        missing: true,
        dryRun,
      };
    }
    return {
      ok: false,
      collection: name,
      code: 'LOG_CLEANUP_FAILED',
      msg,
      dryRun,
    };
  }
}

async function cleanupLogCollections({ retentionDays = DEFAULT_LOG_RETENTION_DAYS, dryRun = false }) {
  const days = clampInt(retentionDays, DEFAULT_LOG_RETENTION_DAYS, 1, 365);
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const financeLogs = await cleanupCollectionOlderThan({
    collectionName: LOG_COLLECTION,
    cutoffDate,
    dryRun,
  });
  const notifyLogs = await cleanupCollectionOlderThan({
    collectionName: NOTIFY_LOG_COLLECTION,
    cutoffDate,
    dryRun,
  });
  return {
    ok: [financeLogs, notifyLogs].every((item) => item && item.ok !== false),
    retentionDays: days,
    cutoffDate,
    dryRun,
    results: {
      financeCompensateLogs: financeLogs,
      huifuNotifyLogs: notifyLogs,
    },
  };
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

async function ensurePrimaryWalletByOpenid(openid) {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return null;
  await ensureCollectionExists(WALLET_COLLECTION);
  return db.runTransaction(async (tx) => {
    const walletState = await ensurePrimaryWalletDoc(tx, ownerOpenid, new Date());
    return walletState && walletState.wallet ? walletState.wallet : null;
  });
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

  await ensureCollectionExists(WALLET_COLLECTION);
  await ensureCollectionExists(TRANSACTIONS_COLLECTION);

  return db.runTransaction(async (tx) => {
    const existsRes = await tx.collection(TRANSACTIONS_COLLECTION)
      .where({ _openid: ownerOpenid, bizKey: key })
      .limit(1)
      .get();
    const existsList = (existsRes && existsRes.data) || [];
    if (existsList.length) return { ok: true, existed: true };

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

function resolvePlatformFeeRate() {
  const raw = pickStr(process.env.HUIFU_PLATFORM_FEE_RATE);
  if (!raw) return 0.04;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.04;
  if (n > 0 && n < 1) return n;
  if (n > 1 && n < 100) return n / 100;
  return 0.04;
}

function getGoodsPaymentLock(goods = {}) {
  return goods && goods.paymentLock && typeof goods.paymentLock === 'object'
    ? goods.paymentLock
    : {};
}

async function callSystemFunction(name, data = {}, dryRun = false) {
  if (dryRun) return { ok: true, dryRun: true, name, data };
  const ret = await cloud.callFunction({
    name,
    data: {
      ...data,
      systemCompensate: true,
      compensateToken: pickStr(process.env.SYSTEM_COMPENSATE_TOKEN),
    },
  });
  return (ret && ret.result) || ret || null;
}

async function fetchRecentDocs(collectionName, limit = 50, orderField = 'updatedAt') {
  const take = clampInt(limit, 50, 1, 500);
  const res = await db.collection(collectionName)
    .orderBy(orderField, 'desc')
    .limit(take)
    .get();
  return (res && res.data) || [];
}

async function repairWalletDocs({ limit = 200, dryRun = false }) {
  const take = clampInt(limit, 200, 1, 500);
  const batchSize = Math.min(100, take);
  const docs = [];
  for (let skip = 0; docs.length < take; skip += batchSize) {
    const fetchLimit = Math.min(batchSize, take - docs.length);
    const res = await db.collection(WALLET_COLLECTION)
      .orderBy('updatedAt', 'desc')
      .skip(skip)
      .limit(fetchLimit)
      .get();
    const list = (res && res.data) || [];
    docs.push(...list);
    if (list.length < fetchLimit) break;
  }

  const grouped = new Map();
  docs.forEach((item) => {
    const ownerOpenid = pickStr(item && item._openid);
    if (!ownerOpenid) return;
    if (!grouped.has(ownerOpenid)) grouped.set(ownerOpenid, []);
    grouped.get(ownerOpenid).push(item);
  });

  const repaired = [];
  for (const [openid, walletDocs] of grouped.entries()) {
    const primaryId = getPrimaryWalletId(openid);
    const hasPrimary = walletDocs.some((item) => pickStr(item && item._id) === primaryId);
    const hasActionableLegacy = walletDocs.some((item) => {
      const walletId = pickStr(item && item._id);
      if (!walletId || walletId === primaryId) return false;
      return !isLegacyShadowWallet(item) || pickStr(item && item.shadowOf) !== primaryId;
    });
    if (hasPrimary && !hasActionableLegacy) continue;
    repaired.push({ openid, docs: walletDocs.length, primaryId });
    if (!dryRun) {
      await ensurePrimaryWalletByOpenid(openid);
    }
  }

  return {
    ok: true,
    scanned: docs.length,
    repairedCount: repaired.length,
    repaired: repaired.slice(0, 50),
    dryRun,
  };
}

async function releaseExpiredGoodsLocks({ limit = 50, dryRun = false }) {
  const now = new Date();
  const nowMs = now.getTime();
  const docs = await fetchRecentDocs(GOODS_COLLECTION, limit * 6, 'updatedAt');
  const candidates = docs.filter((item) => {
    if (pickStr(item && item.status, 'posted') !== 'posted') return false;
    const lock = getGoodsPaymentLock(item);
    const status = pickStr(lock.status).toLowerCase();
    if (!['locked', 'request_sent'].includes(status)) return false;
    return toDateMs(lock.expiresAt) > 0 && toDateMs(lock.expiresAt) <= nowMs;
  }).slice(0, clampInt(limit, 50));

  if (!dryRun) {
    for (const goods of candidates) {
      const lock = getGoodsPaymentLock(goods);
      await db.collection(GOODS_COLLECTION).doc(goods._id).update({
        data: {
          paymentLock: {
            ...lock,
            status: 'expired',
            releaseReason: 'compensate_timeout_release',
            releasedAt: now,
            expiresAt: now,
            updatedAt: now,
          },
          updatedAt: now,
        }
      });
    }
  }

  return {
    ok: true,
    scanned: docs.length,
    releasedCount: candidates.length,
    goodsIds: candidates.map((item) => pickStr(item && item._id)).slice(0, 50),
    dryRun,
  };
}

async function syncTaskRefunds({ limit = 30, dryRun = false }) {
  const docs = await fetchRecentDocs(TASK_COLLECTION, limit * 8, 'updatedAt');
  const candidates = docs.filter((item) => pickStr(item && item.pay && item.pay.status) === 'refund_pending')
    .slice(0, clampInt(limit, 30));

  const results = [];
  for (const task of candidates) {
    let result = null;
    try {
      result = await callSystemFunction('taskCancelFlow', {
        action: 'sync_refund_status',
        taskId: pickStr(task && task._id),
      }, dryRun);
    } catch (err) {
      result = {
        ok: false,
        code: 'SYNC_REFUND_CALL_FAILED',
        msg: pickStr(err && err.message, err),
      };
    }
    results.push({
      taskId: pickStr(task && task._id),
      ok: !!(result && result.ok),
      code: pickStr(result && result.code, result && result.err && result.err.code),
      msg: pickStr(result && result.msg, result && result.err && result.err.msg),
    });
  }

  return {
    ok: results.every((item) => item.ok || dryRun),
    scanned: docs.length,
    syncedCount: results.filter((item) => item.ok).length,
    errorCount: results.filter((item) => !item.ok).length,
    results: results.slice(0, 50),
    dryRun,
  };
}

async function syncWithdraws({ limit = 30, dryRun = false }) {
  const docs = await fetchRecentDocs(WITHDRAW_COLLECTION, limit * 8, 'updatedAt');
  const candidates = docs.filter((item) => ['processing', 'pending', 'submitting', 'request_sent'].includes(pickStr(item && item.status)))
    .slice(0, clampInt(limit, 30));

  const results = [];
  for (const withdraw of candidates) {
    let result = null;
    try {
      result = await callSystemFunction('walletWithdraw', {
        action: 'sync_active_withdraw',
        targetOpenid: pickStr(withdraw && withdraw._openid),
        reqDate: pickStr(withdraw && withdraw.reqDate),
        reqSeqId: pickStr(withdraw && withdraw.reqSeqId),
        hfSeqId: pickStr(withdraw && withdraw.hfSeqId),
      }, dryRun);
    } catch (err) {
      result = {
        ok: false,
        code: 'SYNC_WITHDRAW_CALL_FAILED',
        msg: pickStr(err && err.message, err),
      };
    }
    results.push({
      openid: pickStr(withdraw && withdraw._openid),
      reqDate: pickStr(withdraw && withdraw.reqDate),
      reqSeqId: pickStr(withdraw && withdraw.reqSeqId),
      ok: !!(result && result.ok),
      code: pickStr(result && result.code, result && result.err && result.err.code),
      msg: pickStr(result && result.msg, result && result.err && result.err.msg),
    });
  }

  return {
    ok: results.every((item) => item.ok || dryRun),
    scanned: docs.length,
    syncedCount: results.filter((item) => item.ok).length,
    errorCount: results.filter((item) => !item.ok).length,
    results: results.slice(0, 50),
    dryRun,
  };
}

async function retryDelayConfirms({ limit = 20, dryRun = false }) {
  const nowMs = Date.now();
  const docs = await fetchRecentDocs(TASK_COLLECTION, limit * 12, 'updatedAt');
  const candidates = docs.filter((task) => {
    if (pickStr(task && task.status) !== 'submitted') return false;
    const split = task && task.split && typeof task.split === 'object' ? task.split : {};
    const delayConfirm = split.delayConfirm && typeof split.delayConfirm === 'object' ? split.delayConfirm : {};
    if (pickStr(split.status) !== 'confirming') return false;
    if (!pickStr(delayConfirm.reqDate) || !pickStr(delayConfirm.reqSeqId)) return false;
    const lockExpiresAtMs = toDateMs(delayConfirm.lockExpiresAt);
    return !!lockExpiresAtMs && lockExpiresAtMs <= nowMs;
  }).slice(0, clampInt(limit, 20));

  const results = [];
  for (const task of candidates) {
    let result = null;
    try {
      result = await callSystemFunction('huifuMiniappPay', {
        action: 'delay_confirm_task',
        taskId: pickStr(task && task._id),
        ownerOpenid: pickStr(task && task._openid),
      }, dryRun);
    } catch (err) {
      result = {
        ok: false,
        code: 'RETRY_DELAY_CONFIRM_CALL_FAILED',
        msg: pickStr(err && err.message, err),
      };
    }
    results.push({
      taskId: pickStr(task && task._id),
      ok: !!(result && result.ok),
      pending: !!(result && result.pending),
      code: pickStr(result && result.code, result && result.err && result.err.code),
      msg: pickStr(result && result.msg, result && result.err && result.err.msg),
    });
  }

  return {
    ok: results.every((item) => item.ok || dryRun),
    scanned: docs.length,
    retriedCount: results.filter((item) => item.ok).length,
    errorCount: results.filter((item) => !item.ok).length,
    results: results.slice(0, 50),
    dryRun,
  };
}

async function repairGoodsLedgers(goodsDocs = []) {
  const feeRate = resolvePlatformFeeRate();
  const results = [];
  for (const goods of goodsDocs) {
    const goodsId = pickStr(goods && goods._id);
    const reqSeqId = pickStr(goods && goods.payReqSeqId);
    const buyerOpenid = pickStr(goods && (goods.buyerOpenid || goods.buyer_openid || goods.buyerOpenId));
    const sellerOpenid = pickStr(goods && goods._openid);
    const totalAmount = roundMoney(safeNumber(goods && (goods.payTransAmtYuan || goods.price || goods.amount)));
    const sellerIncome = roundMoney(totalAmount * (1 - feeRate));
    const feeAmount = roundMoney(totalAmount - sellerIncome);
    const createdAt = goods && (goods.soldAt || goods.updatedAt) ? (goods.soldAt || goods.updatedAt) : new Date();
    const title = pickStr(goods && goods.title, goods && goods.desc, '商品购买');

    if (buyerOpenid && totalAmount > 0 && reqSeqId) {
      try {
        results.push(await recordWalletTransaction({
          openid: buyerOpenid,
          amount: -totalAmount,
          balanceDelta: 0,
          type: 'goods_expense',
          bizKey: `goods_expense:${goodsId}:${reqSeqId}`,
          title,
          summary: `通过微信支付购买商品 ¥${totalAmount.toFixed(2)}，不扣汇付余额`,
          relatedId: goodsId,
          counterpartOpenid: sellerOpenid,
          affectsBalance: false,
          fundChannel: 'wechat_pay',
          createdAt,
        }));
      } catch (err) {
        results.push({ ok: false, code: 'GOODS_EXPENSE_LEDGER_FAILED', msg: pickStr(err && err.message, err), goodsId, reqSeqId });
      }
    }

    if (sellerOpenid && sellerIncome > 0 && reqSeqId) {
      try {
        results.push(await recordWalletTransaction({
          openid: sellerOpenid,
          amount: sellerIncome,
          type: 'goods_income',
          bizKey: `goods_income:${goodsId}:${reqSeqId}`,
          title,
          summary: `商品售出到账 ¥${sellerIncome.toFixed(2)}，已计入汇付余额，平台费 ¥${feeAmount.toFixed(2)}`,
          relatedId: goodsId,
          counterpartOpenid: buyerOpenid,
          createdAt,
        }));
      } catch (err) {
        results.push({ ok: false, code: 'GOODS_INCOME_LEDGER_FAILED', msg: pickStr(err && err.message, err), goodsId, reqSeqId });
      }
    }
  }
  return results;
}

async function repairTaskLedgers(taskDocs = []) {
  const results = [];
  for (const task of taskDocs) {
    const taskId = pickStr(task && task._id);
    const title = pickStr(task && task.title, task && task.desc, '任务');
    const amount = roundMoney(safeNumber(task && task.amount));
    const ownerOpenid = pickStr(task && task._openid);
    const workerOpenid = pickStr(task && (task.workerOpenid || task.worker_openid));
    const pay = task && task.pay && typeof task.pay === 'object' ? task.pay : {};
    const split = task && task.split && typeof task.split === 'object' ? task.split : {};
    const delayConfirm = split.delayConfirm && typeof split.delayConfirm === 'object' ? split.delayConfirm : {};
    const refund = pay.refund && typeof pay.refund === 'object' ? pay.refund : {};
    const payStatus = pickStr(pay.status);
    const taskStatus = pickStr(task && task.status);

    const payReqSeqId = pickStr(pay.reqSeqId);
    if (
      ownerOpenid
      && amount > 0
      && payReqSeqId
      && (['paid', 'refund_pending', 'refunded'].includes(payStatus) || (taskStatus && taskStatus !== 'pay_pending'))
    ) {
      try {
        results.push(await recordWalletTransaction({
          openid: ownerOpenid,
          amount: -amount,
          balanceDelta: 0,
          type: 'task_expense',
          bizKey: `task_expense:${taskId}:${payReqSeqId}`,
          title: pickStr(title, '任务付款'),
          summary: `通过微信支付发布任务 ¥${amount.toFixed(2)}，不扣汇付余额`,
          relatedId: taskId,
          affectsBalance: false,
          fundChannel: 'wechat_pay',
          createdAt: pay.paidAt || task.paidAt || task.updatedAt || new Date(),
        }));
      } catch (err) {
        results.push({ ok: false, code: 'TASK_EXPENSE_LEDGER_FAILED', msg: pickStr(err && err.message, err), taskId, payReqSeqId });
      }
    }

    const refundReqSeqId = pickStr(refund.reqSeqId);
    if (ownerOpenid && amount > 0 && payStatus === 'refunded' && refundReqSeqId) {
      try {
        results.push(await recordWalletTransaction({
          openid: ownerOpenid,
          amount,
          balanceDelta: 0,
          type: 'refund',
          bizKey: `task_refund:${taskId}:${refundReqSeqId}`,
          title: pickStr(title, '任务退款'),
          summary: `任务取消退款 ¥${amount.toFixed(2)}，原路退回支付账户`,
          relatedId: taskId,
          counterpartOpenid: workerOpenid,
          affectsBalance: false,
          fundChannel: 'wechat_pay_refund',
          createdAt: refund.queriedAt || refund.updatedAt || task.updatedAt || new Date(),
        }));
      } catch (err) {
        results.push({ ok: false, code: 'TASK_REFUND_LEDGER_FAILED', msg: pickStr(err && err.message, err), taskId, refundReqSeqId });
      }
    }

    const workerCents = Number(split.workerCents || 0);
    const incomeReqSeqId = pickStr(delayConfirm.reqSeqId);
    const workerIncome = roundMoney(workerCents / 100);
    if (taskStatus === 'completed' && workerOpenid && workerIncome > 0 && incomeReqSeqId) {
      try {
        results.push(await recordWalletTransaction({
          openid: workerOpenid,
          amount: workerIncome,
          type: 'task_income',
          bizKey: `task_income:${taskId}:${incomeReqSeqId}`,
          title: pickStr(title, '任务收入'),
          summary: `任务完成到账 ¥${workerIncome.toFixed(2)}，已计入汇付余额`,
          relatedId: taskId,
          counterpartOpenid: ownerOpenid,
          createdAt: task.completedAt || task.updatedAt || new Date(),
        }));
      } catch (err) {
        results.push({ ok: false, code: 'TASK_INCOME_LEDGER_FAILED', msg: pickStr(err && err.message, err), taskId, incomeReqSeqId });
      }
    }
  }
  return results;
}

async function repairMissingLedgers({ limit = 50, dryRun = false }) {
  const recentGoods = await fetchRecentDocs(GOODS_COLLECTION, clampInt(limit, 50) * 8, 'updatedAt');
  const goodsDocs = recentGoods
    .filter((item) => pickStr(item && item.status) === 'sold')
    .filter((item) => pickStr(item && item.payReqSeqId))
    .slice(0, clampInt(limit, 50));

  const recentTasks = await fetchRecentDocs(TASK_COLLECTION, clampInt(limit, 50) * 8, 'updatedAt');
  const taskDocs = recentTasks.filter((item) => {
    const pay = item && item.pay && typeof item.pay === 'object' ? item.pay : {};
    const split = item && item.split && typeof item.split === 'object' ? item.split : {};
    const delayConfirm = split.delayConfirm && typeof split.delayConfirm === 'object' ? split.delayConfirm : {};
    return !!(
      pickStr(pay.reqSeqId)
      || (pickStr(pay.status) === 'refunded' && pickStr(pay.refund && pay.refund.reqSeqId))
      || (pickStr(item && item.status) === 'completed' && pickStr(delayConfirm.reqSeqId))
    );
  }).slice(0, clampInt(limit, 50));

  let results = [];
  if (!dryRun) {
    results = [
      ...(await repairGoodsLedgers(goodsDocs)),
      ...(await repairTaskLedgers(taskDocs)),
    ];
  }

  const existedCount = results.filter((item) => item && item.existed).length;
  const createdCount = results.filter((item) => item && item.ok && !item.existed).length;
  const failedCount = results.filter((item) => !item || item.ok === false).length;
  return {
    ok: failedCount === 0,
    scannedGoods: goodsDocs.length,
    scannedTasks: taskDocs.length,
    createdCount,
    existedCount,
    failedCount,
    dryRun,
  };
}

async function runSafeStep(step, handler) {
  try {
    return await handler();
  } catch (err) {
    console.error(`[financeCompensate] ${step} failed`, err);
    return {
      ok: false,
      code: 'STEP_FAILED',
      msg: pickStr(err && err.message, err),
      step,
    };
  }
}

async function runAll({ limit = 50, dryRun = false, retentionDays = DEFAULT_LOG_RETENTION_DAYS }) {
  const results = {};
  results.repairWalletDocs = await runSafeStep('repair_wallet_docs', () => repairWalletDocs({ limit: Math.max(limit * 2, 100), dryRun }));
  results.releaseExpiredGoodsLocks = await runSafeStep('release_expired_goods_locks', () => releaseExpiredGoodsLocks({ limit, dryRun }));
  results.syncTaskRefunds = await runSafeStep('sync_task_refunds', () => syncTaskRefunds({ limit: Math.max(10, Math.floor(limit / 2)), dryRun }));
  results.syncWithdraws = await runSafeStep('sync_withdraws', () => syncWithdraws({ limit: Math.max(10, Math.floor(limit / 2)), dryRun }));
  results.retryDelayConfirms = await runSafeStep('retry_delay_confirms', () => retryDelayConfirms({ limit: Math.max(10, Math.floor(limit / 2)), dryRun }));
  results.repairMissingLedgers = await runSafeStep('repair_missing_ledgers', () => repairMissingLedgers({ limit, dryRun }));
  results.cleanupLogCollections = await runSafeStep('cleanup_log_collections', () => cleanupLogCollections({ retentionDays, dryRun }));
  return {
    ok: Object.values(results).every((item) => !item || item.ok !== false),
    results,
    dryRun,
  };
}

exports.main = async (event = {}) => {
  const action = pickStr(event.action, 'run_all');
  const limit = clampInt(event.limit, 50, 1, 200);
  const dryRun = event.dryRun === true;
  const retentionDays = clampInt(event.retentionDays, DEFAULT_LOG_RETENTION_DAYS, 1, 365);

  console.log('[financeCompensate] start', JSON.stringify({
    action,
    dryRun,
    limit,
    retentionDays,
    buildTag: BUILD_TAG,
  }));

  if (!isAuthorized(event)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      msg: '缺少有效的补偿令牌',
      buildTag: BUILD_TAG,
    };
  }

  try {
    await ensureCollectionExists(WALLET_COLLECTION);
    await ensureCollectionExists(TRANSACTIONS_COLLECTION);
    await ensureCollectionExists(WITHDRAW_COLLECTION);

    let result = null;
    if (action === 'repair_wallet_docs') {
      result = await repairWalletDocs({ limit, dryRun });
    } else if (action === 'release_expired_goods_locks') {
      result = await releaseExpiredGoodsLocks({ limit, dryRun });
    } else if (action === 'sync_task_refunds') {
      result = await syncTaskRefunds({ limit, dryRun });
    } else if (action === 'sync_withdraws') {
      result = await syncWithdraws({ limit, dryRun });
    } else if (action === 'retry_delay_confirms') {
      result = await retryDelayConfirms({ limit, dryRun });
    } else if (action === 'repair_missing_ledgers') {
      result = await repairMissingLedgers({ limit, dryRun });
    } else if (action === 'cleanup_logs') {
      result = await cleanupLogCollections({ retentionDays, dryRun });
    } else if (action === 'run_all') {
      result = await runAll({ limit, dryRun, retentionDays });
    } else {
      return {
        ok: false,
        code: 'UNSUPPORTED_ACTION',
        msg: `unsupported_action: ${action}`,
        buildTag: BUILD_TAG,
      };
    }

    await writeRunLog({
      action,
      dryRun,
      limit,
      retentionDays,
      ok: !!(result && result.ok),
      resultBrief: result,
    });

    console.log('[financeCompensate] done', JSON.stringify({
      action,
      dryRun,
      limit,
      retentionDays,
      ok: !!(result && result.ok),
      buildTag: BUILD_TAG,
      result,
    }));

    return {
      ok: !!(result && result.ok),
      action,
      dryRun,
      limit,
      retentionDays,
      buildTag: BUILD_TAG,
      result,
    };
  } catch (err) {
    console.error('[financeCompensate] failed', err);
    await writeRunLog({
      action,
      dryRun,
      limit,
      retentionDays,
      ok: false,
      error: pickStr(err && err.message, err),
    });
    return {
      ok: false,
      action,
      dryRun,
      limit,
      retentionDays,
      buildTag: BUILD_TAG,
      code: 'FINANCE_COMPENSATE_FAILED',
      msg: err && err.message ? err.message : '补偿任务执行失败',
    };
  }
};
