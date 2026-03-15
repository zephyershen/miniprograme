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

    const walletRes = await tx.collection(WALLET_COLLECTION)
      .where({ _openid: ownerOpenid })
      .limit(1)
      .get();
    const walletList = (walletRes && walletRes.data) || [];
    const wallet = walletList[0] || null;
    const currentBalance = roundMoney(wallet && wallet.balance);
    const nextBalance = roundMoney(currentBalance + delta);
    const incomeDelta = delta > 0 ? delta : 0;
    const expenseDelta = delta < 0 ? Math.abs(delta) : 0;

    if (wallet && wallet._id) {
      await tx.collection(WALLET_COLLECTION).doc(wallet._id).update({
        data: {
          balance: nextBalance,
          incomeTotal: roundMoney(Number(wallet.incomeTotal || 0) + incomeDelta),
          expenseTotal: roundMoney(Number(wallet.expenseTotal || 0) + expenseDelta),
          updatedAt: createdAt,
        }
      });
    } else if (shouldAffectBalance) {
      await tx.collection(WALLET_COLLECTION).add({
        data: {
          _openid: ownerOpenid,
          balance: nextBalance,
          incomeTotal: incomeDelta,
          expenseTotal: expenseDelta,
          createdAt,
          updatedAt: createdAt,
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
  const reqSeqId = pickStr(event.reqSeqId);

  const now = new Date();

  try {
    const txResult = await db.runTransaction(async (tx) => {
      const docRes = await tx.collection(GOODS_COLLECTION).doc(goodsId).get();
      const goods = docRes && docRes.data ? docRes.data : null;
      if (!goods) return { ok: false, code: 'GOODS_NOT_FOUND' };

      const status = pickStr(goods.status) || 'posted';

      // 不能购买自己的商品（按 _openid 判断更可靠）
      if (pickStr(goods._openid) && pickStr(goods._openid) === OPENID) {
        return { ok: false, code: 'CANNOT_BUY_SELF' };
      }

      // 幂等：如果已 sold，且买家就是当前用户，则当作成功（防止网络重试导致前端误报失败）
      if (status === 'sold') {
        const soldBuyerOpenid = pickStr(goods.buyerOpenid || goods.buyer_openid || goods.buyerOpenId);
        if (soldBuyerOpenid && soldBuyerOpenid === OPENID) {
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

      await tx.collection(GOODS_COLLECTION).doc(goodsId).update({
        data: {
          status: 'sold',
          buyerOpenid: OPENID,
          buyerId: buyerId || '',
          soldAt: now,
          payReqSeqId: reqSeqId || '',
          payTransAmtYuan: transAmtYuan,
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
          summary: `通过微信支付购买商品 ¥${roundMoney(totalAmount).toFixed(2)}，不扣汇付余额`,
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
          summary: `商品售出到账 ¥${sellerIncome.toFixed(2)}，已计入汇付余额，平台费 ¥${feeAmount.toFixed(2)}`,
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
