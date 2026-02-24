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

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    return await db.runTransaction(async (tx) => {
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
          return { ok: true, status: 'sold', alreadySold: true };
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

      return { ok: true, status: 'sold' };
    });
  } catch (e) {
    console.error('[goodsPurchase] transaction error', e);
    return { ok: false, code: 'TX_ERROR', err: String(e && e.message ? e.message : e) };
  }
};

