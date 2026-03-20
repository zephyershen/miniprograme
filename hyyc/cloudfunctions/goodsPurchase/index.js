// 云函数：goodsPurchase
// 作用：
// - 买家完成支付后，把 goods 状态从 posted -> sold
// - 避免商品继续出现在商品列表（列表只展示 status=posted）
//
// 注意：
// - 这是“支付完成后落库”的最小闭环。更严谨的生产方案需要接入支付回调/订单查询验真。
// - 本云函数使用事务做幂等和并发保护：同一时间只能有一个买家把商品置为 sold。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const GOODS_COLLECTION = 'goods';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
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

function getGoodsPaymentLock(goods = {}) {
  return goods && goods.paymentLock && typeof goods.paymentLock === 'object'
    ? goods.paymentLock
    : {};
}

function isGoodsPaymentLockActive(lock = {}, nowMs = Date.now()) {
  const status = pickStr(lock.status).toLowerCase();
  if (['paid', 'released', 'failed', 'expired'].includes(status)) return false;
  return !!pickStr(lock.reqSeqId) && toDateMs(lock.expiresAt) > nowMs;
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

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();

  const goodsId = pickStr(event.goodsId || event.id);
  if (!goodsId) return { ok: false, code: 'MISSING_GOODS_ID' };
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID' };

  const buyerId = pickStr(event.buyerId);
  const transAmtYuan = safeNumber(event.transAmtYuan);
  const reqDate = pickStr(event.reqDate);
  const reqSeqId = pickStr(event.reqSeqId);

  const now = new Date();
  const nowMs = now.getTime();

  try {
    const txResult = await db.runTransaction(async (tx) => {
      const docRes = await tx.collection(GOODS_COLLECTION).doc(goodsId).get();
      const goods = docRes && docRes.data ? docRes.data : null;
      if (!goods) return { ok: false, code: 'GOODS_NOT_FOUND' };

      const status = pickStr(goods.status) || 'posted';
      const paymentLock = getGoodsPaymentLock(goods);
      const lockedBuyerOpenid = pickStr(paymentLock.buyerOpenid);
      const lockedReqDate = pickStr(paymentLock.reqDate);
      const lockedReqSeqId = pickStr(paymentLock.reqSeqId);

      // 不能购买自己的商品（按 _openid 判断更可靠）
      if (pickStr(goods._openid) && pickStr(goods._openid) === OPENID) {
        return { ok: false, code: 'CANNOT_BUY_SELF' };
      }

      // 幂等：如果已 sold，且买家就是当前用户，则当作成功（防止网络重试导致前端误报失败）
      if (status === 'sold') {
        const soldBuyerOpenid = pickStr(goods.buyerOpenid || goods.buyer_openid || goods.buyerOpenId);
        const soldReqSeqId = pickStr(goods.payReqSeqId);
        if (soldBuyerOpenid && soldBuyerOpenid === OPENID && (!reqSeqId || !soldReqSeqId || soldReqSeqId === reqSeqId)) {
          return {
            ok: true,
            status: 'sold',
            alreadySold: true,
            sellerOpenid: pickStr(goods._openid),
            title: pickStr(goods.title, goods.desc, '商品购买'),
          };
        }
        return { ok: false, code: 'ALREADY_SOLD', status: 'sold' };
      }

      // 仅允许从 posted -> sold（兼容旧数据 status 为空时也认为 posted）
      if (status && status !== 'posted') {
        return { ok: false, code: 'NOT_FOR_SALE', status };
      }

      if (lockedReqSeqId) {
        if (lockedBuyerOpenid && lockedBuyerOpenid !== OPENID) {
          return { ok: false, code: 'GOODS_LOCKED', status: 'locked' };
        }
        if (reqSeqId && lockedReqSeqId !== reqSeqId) {
          return { ok: false, code: 'PAY_REQ_MISMATCH', status: 'locked' };
        }
        if (reqDate && lockedReqDate && lockedReqDate !== reqDate) {
          return { ok: false, code: 'PAY_REQDATE_MISMATCH', status: 'locked' };
        }
        if (!isGoodsPaymentLockActive(paymentLock, nowMs)) {
          return { ok: false, code: 'PAY_LOCK_EXPIRED', status: 'locked' };
        }
      }

      await tx.collection(GOODS_COLLECTION).doc(goodsId).update({
        data: {
          status: 'sold',
          buyerOpenid: OPENID,
          buyerId: buyerId || '',
          soldAt: now,
          payReqDate: reqDate || lockedReqDate || '',
          payReqSeqId: reqSeqId || '',
          payTransAmtYuan: transAmtYuan,
          paymentLock: {
            ...paymentLock,
            buyerOpenid: OPENID,
            reqDate: reqDate || lockedReqDate || '',
            reqSeqId: reqSeqId || lockedReqSeqId || '',
            status: 'paid',
            paidAt: now,
            updatedAt: now,
          },
          updatedAt: now
        }
      });

      return {
        ok: true,
        status: 'sold',
        sellerOpenid: pickStr(goods._openid),
        title: pickStr(goods.title, goods.desc, '商品购买'),
      };
    });

    if (txResult && txResult.ok) {
      const title = pickStr(txResult.title, '商品购买');
      const sellerOpenid = pickStr(txResult.sellerOpenid);
      const totalAmount = roundMoney(transAmtYuan);
      const feeRate = resolvePlatformFeeRate();
      const sellerIncome = roundMoney(totalAmount * (1 - feeRate));
      const feeAmount = roundMoney(totalAmount - sellerIncome);
      const createdAt = now;

      const ledgerTasks = [
        recordWalletTransaction({
          openid: OPENID,
          amount: -totalAmount,
          balanceDelta: 0,
          type: 'goods_expense',
          bizKey: `goods_expense:${goodsId}:${pickStr(reqSeqId) || 'paid'}`,
          title,
          summary: `通过微信支付购买商品 ¥${roundMoney(totalAmount).toFixed(2)}`,
          relatedId: goodsId,
          counterpartOpenid: sellerOpenid,
          affectsBalance: false,
          fundChannel: 'wechat_pay',
          createdAt,
        })
      ];

      if (sellerOpenid && sellerIncome > 0) {
        ledgerTasks.push(recordWalletTransaction({
          openid: sellerOpenid,
          amount: sellerIncome,
          type: 'goods_income',
          bizKey: `goods_income:${goodsId}:${pickStr(reqSeqId) || 'paid'}`,
          title,
          summary: `商品售出到账 ¥${sellerIncome.toFixed(2)}，服务费 ¥${feeAmount.toFixed(2)}`,
          relatedId: goodsId,
          counterpartOpenid: OPENID,
          createdAt,
        }));
      }

      const ledgerResults = await Promise.allSettled(ledgerTasks);
      ledgerResults.forEach((item) => {
        if (item.status === 'rejected') {
          console.error('[goodsPurchase] wallet mirror failed', item.reason);
        }
      });
    }

    return txResult;
  } catch (e) {
    console.error('[goodsPurchase] transaction error', e);
    return { ok: false, code: 'TX_ERROR', err: String(e && e.message ? e.message : e) };
  }
};
