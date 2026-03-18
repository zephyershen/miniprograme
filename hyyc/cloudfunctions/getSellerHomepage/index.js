const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USER_COLLECTION = 'userInfo';
const GOODS_COLLECTION = 'goods';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function toTs(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && Number.isFinite(value.$date)) return value.$date;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function buildDisplayName(user = {}) {
  return pickStr(user.nickname, user.nickName, user.name, '卖家');
}

function getLogicalUserId(user = {}) {
  return pickStr(user && user.id, user && user._id);
}

async function getUserByOpenid(openid = '') {
  const targetOpenid = pickStr(openid);
  if (!targetOpenid) return null;
  const res = await db.collection(USER_COLLECTION)
    .where({ _openid: targetOpenid })
    .limit(1)
    .get();
  return ((res && res.data) || [])[0] || null;
}

async function getUserById(userId = '') {
  const targetUserId = pickStr(userId);
  if (!targetUserId) return null;
  const res = await db.collection(USER_COLLECTION)
    .where({ id: targetUserId })
    .limit(1)
    .get();
  const matched = ((res && res.data) || [])[0] || null;
  if (matched) return matched;

  try {
    const docRes = await db.collection(USER_COLLECTION).doc(targetUserId).get();
    return (docRes && docRes.data) || null;
  } catch (err) {
    return null;
  }
}

function mapGoods(doc = {}) {
  return {
    id: pickStr(doc._id),
    title: pickStr(doc.title, doc.desc, '闲置商品'),
    price: Number(doc.price || 0),
    coverImage: pickStr(Array.isArray(doc.images) ? doc.images[0] : ''),
    community: pickStr(doc.community),
    status: pickStr(doc.status, 'posted'),
    createdAt: toTs(doc.createdAt || doc.updatedAt || doc._createTime),
    updatedAt: toTs(doc.updatedAt || doc.createdAt || doc._updateTime || doc._createTime),
  };
}

exports.main = async (event = {}) => {
  const sellerOpenidFromEvent = pickStr(event.openid, event._openid, event.openId);
  const sellerUserIdFromEvent = pickStr(event.userId, event.id);

  try {
    let seller = null;
    if (sellerOpenidFromEvent) {
      seller = await getUserByOpenid(sellerOpenidFromEvent);
    }
    if (!seller && sellerUserIdFromEvent) {
      seller = await getUserById(sellerUserIdFromEvent);
    }
    if (!seller) {
      return { ok: false, code: 'SELLER_NOT_FOUND', msg: '卖家不存在' };
    }

    const sellerOpenid = pickStr(seller._openid);
    const sellerUserId = getLogicalUserId(seller);
    if (!sellerOpenid) {
      return { ok: false, code: 'SELLER_OPENID_MISSING', msg: '卖家信息不完整' };
    }

    const goodsRes = await db.collection(GOODS_COLLECTION)
      .where({ _openid: sellerOpenid })
      .limit(100)
      .get();
    const goodsDocs = ((goodsRes && goodsRes.data) || [])
      .filter((doc) => !doc.sellerDeletedAt)
      .sort((a, b) => (
        toTs(b.updatedAt || b.createdAt || b._createTime) - toTs(a.updatedAt || a.createdAt || a._createTime)
      ));

    const onSaleDocs = goodsDocs.filter((doc) => pickStr(doc.status, 'posted') === 'posted');
    const onSaleList = onSaleDocs
      .map((doc) => mapGoods(doc))
      .slice(0, 30);

    const soldCount = goodsDocs.filter((doc) => pickStr(doc.status) === 'sold').length;
    const offShelfCount = goodsDocs.filter((doc) => pickStr(doc.status) === 'off_shelf').length;

    return {
      ok: true,
      seller: {
        openid: sellerOpenid,
        userId: sellerUserId,
        displayName: buildDisplayName(seller),
        nickname: pickStr(seller.nickname, seller.nickName),
        avatarFileID: pickStr(seller.avatarFileID),
        avatarUrl: pickStr(seller.avatarUrl),
        community: pickStr(seller.community),
        building: pickStr(seller.building),
        realname: !!seller.realname,
        onSaleCount: onSaleDocs.length,
        soldCount,
        offShelfCount,
        totalGoodsCount: goodsDocs.length,
      },
      goodsList: onSaleList,
    };
  } catch (err) {
    console.error('getSellerHomepage failed', err);
    return {
      ok: false,
      code: 'GET_SELLER_HOMEPAGE_ERROR',
      msg: pickStr(err && (err.errMsg || err.message), '卖家主页加载失败'),
    };
  }
};
