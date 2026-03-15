// 云函数：taskPaySuccess
// 作用：
// - 发布者支付完成后，把任务从 pay_pending -> posted
// - 最小闭环：不做支付验真（生产建议接入 notify / 订单查询）

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TASK_COLLECTION = 'tasks';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
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
        createdAt,
        updatedAt: createdAt,
      }
    });

    return { ok: true, balanceAfter: nextBalance };
  });
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID' };

  const taskId = pickStr(event.taskId || event.tid || event.id);
  if (!taskId) return { ok: false, code: 'MISSING_TASK_ID' };

  const now = new Date();

  try {
    const txResult = await db.runTransaction(async (tx) => {
      const docRes = await tx.collection(TASK_COLLECTION).doc(taskId).get();
      const task = docRes && docRes.data ? docRes.data : null;
      if (!task) return { ok: false, code: 'TASK_NOT_FOUND' };

      const ownerOpenid = pickStr(task._openid);
      if (!ownerOpenid || ownerOpenid !== OPENID) return { ok: false, code: 'NOT_OWNER' };

      const status = pickStr(task.status) || '';
      if (status === 'posted') {
        return {
          ok: true,
          status: 'posted',
          already: true,
          ownerOpenid,
          title: pickStr(task.title, task.desc, '任务付款'),
          amount: Number(task.amount || 0),
          payReqSeqId: pickStr(task.pay && task.pay.reqSeqId),
        };
      }
      if (status && status !== 'pay_pending') return { ok: false, code: 'INVALID_STATUS', status };

      await tx.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'posted',
          paidAt: now,
          updatedAt: now,
          pay: {
            ...(task.pay || {}),
            status: 'paid',
            paidAt: now,
          }
        }
      });

      return {
        ok: true,
        status: 'posted',
        ownerOpenid,
        title: pickStr(task.title, task.desc, '任务付款'),
        amount: Number(task.amount || 0),
        payReqSeqId: pickStr(task.pay && task.pay.reqSeqId),
      };
    });

    if (txResult && txResult.ok) {
      const amount = roundMoney(txResult.amount);
      const bizReqSeqId = pickStr(event.reqSeqId, txResult.payReqSeqId, taskId);
      if (txResult.ownerOpenid && amount > 0) {
        try {
          await recordWalletTransaction({
            openid: txResult.ownerOpenid,
            amount: -amount,
            balanceDelta: 0,
            type: 'task_expense',
            bizKey: `task_expense:${taskId}:${bizReqSeqId}`,
            title: pickStr(txResult.title, '任务付款'),
            summary: `通过微信支付发布任务 ¥${amount.toFixed(2)}，不扣汇付余额`,
            relatedId: taskId,
            affectsBalance: false,
            fundChannel: 'wechat_pay',
            createdAt: now,
          });
        } catch (ledgerErr) {
          console.error('[taskPaySuccess] wallet mirror failed', ledgerErr);
        }
      }
    }

    return txResult;
  } catch (e) {
    console.error('[taskPaySuccess] tx error', e);
    return { ok: false, code: 'TX_ERROR', err: String(e && e.message ? e.message : e) };
  }
};
