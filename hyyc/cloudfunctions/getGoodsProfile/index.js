const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const GOODS_COLLECTION = 'goods';
const MAX_SNAPSHOT_IDS = 100;
const MAX_QUERY_LIMIT = 100;
const SNAPSHOT_BATCH_SIZE = 50;

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function toTimeMs(v) {
  if (!v) return 0;
  if (typeof v.getTime === 'function') return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && Number.isFinite(v.$date)) return v.$date;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function clampLimit(v, fallback = MAX_QUERY_LIMIT) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(n)));
}

function safeMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isGoodsPaymentLockActive(lock = {}, nowMs = Date.now()) {
  const data = lock && typeof lock === 'object' ? lock : {};
  const status = pickStr(data.status).toLowerCase();
  const reqSeqId = pickStr(data.reqSeqId);
  if (!reqSeqId) return false;
  if (['paid', 'released', 'failed', 'expired'].includes(status)) return false;
  return toTimeMs(data.expiresAt) > nowMs;
}

function buildGoodsSnapshot(doc = {}, openid = '') {
  const images = Array.isArray(doc.images) ? doc.images.filter(Boolean) : [];
  const coverImage = pickStr(doc.coverImage, doc.image, images[0]);
  const ownerOpenid = pickStr(doc._openid, doc.ownerOpenid);
  const buyerOpenid = pickStr(doc.buyerOpenid, doc.buyer_openid, doc.buyerOpenId);
  const status = pickStr(doc.status, 'posted');
  const isOwner = !!(openid && ownerOpenid && ownerOpenid === openid);
  const isBuyer = !!(openid && buyerOpenid && buyerOpenid === openid);
  const sellerDeleted = !!doc.sellerDeletedAt;
  const buyerDeleted = !!doc.buyerDeletedAt;

  return {
    _id: pickStr(doc._id, doc.id),
    goodsId: pickStr(doc._id, doc.id),
    title: pickStr(doc.title, doc.desc, '未命名商品'),
    desc: pickStr(doc.desc),
    price: safeMoney(doc.price),
    originalPrice: safeMoney(doc.originalPrice),
    category: pickStr(doc.category),
    condition: pickStr(doc.condition),
    tradeType: pickStr(doc.tradeType),
    community: pickStr(doc.community),
    building: pickStr(doc.building),
    status,
    coverImage,
    images: images.length ? images : (coverImage ? [coverImage] : []),
    coverRatio: safeMoney(doc.coverRatio),
    ownerId: pickStr(doc.ownerId),
    _openid: ownerOpenid,
    ownerOpenid,
    ownerNickname: pickStr(doc.ownerNickname),
    ownerName: pickStr(doc.ownerName),
    ownerAvatarFileID: pickStr(doc.ownerAvatarFileID, doc.ownerAvatarUrl),
    buyerId: pickStr(doc.buyerId),
    auditNeedFixIdx: Array.isArray(doc.auditNeedFixIdx) ? doc.auditNeedFixIdx : [],
    auditError: pickStr(doc.auditError),
    soldAt: doc.soldAt || null,
    createdAt: doc.createdAt || doc._createTime || null,
    updatedAt: doc.updatedAt || null,
    sellerDeletedAt: doc.sellerDeletedAt || null,
    buyerDeletedAt: doc.buyerDeletedAt || null,
    sellerDeleted,
    buyerDeleted,
    paymentLock: doc && doc.paymentLock && typeof doc.paymentLock === 'object' ? doc.paymentLock : {},
    isOwner,
    isBuyer,
    canView: (isOwner && !sellerDeleted) || (isBuyer && !sellerDeleted && !buyerDeleted) || (!sellerDeleted && status === 'posted')
  };
}

function canAccessGoodsDetail(doc = {}, openid = '') {
  const ownerOpenid = pickStr(doc._openid, doc.ownerOpenid);
  const buyerOpenid = pickStr(doc.buyerOpenid, doc.buyer_openid, doc.buyerOpenId);
  const status = pickStr(doc.status, 'posted');
  const sellerDeleted = !!doc.sellerDeletedAt;
  const buyerDeleted = !!doc.buyerDeletedAt;
  const isOwner = !!(openid && ownerOpenid && ownerOpenid === openid);
  const isBuyer = !!(openid && buyerOpenid && buyerOpenid === openid);

  if (isOwner && !sellerDeleted) return { ok: true, role: 'owner' };
  if (isBuyer && !sellerDeleted && !buyerDeleted) return { ok: true, role: 'buyer' };
  if (!sellerDeleted && status === 'posted') return { ok: true, role: 'public' };
  if (sellerDeleted) return { ok: false, code: 'GOODS_HIDDEN' };
  return { ok: false, code: 'GOODS_NOT_FOUND' };
}

function sortDocsByTime(list = [], fields = []) {
  const keys = Array.isArray(fields) ? fields : [];
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    let bTs = 0;
    let aTs = 0;
    keys.some((key) => {
      bTs = toTimeMs(b && b[key]);
      return bTs > 0;
    });
    keys.some((key) => {
      aTs = toTimeMs(a && a[key]);
      return aTs > 0;
    });
    return bTs - aTs;
  });
}

async function getGoodsSnapshots(ids = [], openid = '') {
  const uniq = [];
  const seen = {};

  (Array.isArray(ids) ? ids : []).forEach((item) => {
    const goodsId = pickStr(item);
    if (!goodsId || seen[goodsId]) return;
    seen[goodsId] = true;
    if (uniq.length < MAX_SNAPSHOT_IDS) uniq.push(goodsId);
  });

  if (!uniq.length) return [];

  const docMap = {};
  for (let i = 0; i < uniq.length; i += SNAPSHOT_BATCH_SIZE) {
    const batchIds = uniq.slice(i, i + SNAPSHOT_BATCH_SIZE);
    const res = await db.collection(GOODS_COLLECTION)
      .where({ _id: _.in(batchIds) })
      .limit(batchIds.length)
      .get();
    const list = (res && res.data) || [];
    list.forEach((doc) => {
      const goodsId = pickStr(doc && doc._id, doc && doc.id);
      if (goodsId) docMap[goodsId] = doc;
    });
  }

  return uniq
    .map((goodsId) => {
      const doc = docMap[goodsId];
      return doc ? buildGoodsSnapshot(doc, openid) : null;
    })
    .filter(Boolean);
}

async function listMyGoods(openid = '', limitRaw = MAX_QUERY_LIMIT) {
  const limit = clampLimit(limitRaw);
  const [publishedRes, purchasedRes] = await Promise.all([
    db.collection(GOODS_COLLECTION)
      .where({ _openid: openid })
      .limit(limit)
      .get(),
    db.collection(GOODS_COLLECTION)
      .where({ buyerOpenid: openid, status: 'sold' })
      .limit(limit)
      .get()
  ]);

  const publishedDocs = sortDocsByTime(
    ((publishedRes && publishedRes.data) || []).filter((doc) => !doc.sellerDeletedAt),
    ['createdAt', 'updatedAt', '_createTime']
  );
  const purchasedDocs = sortDocsByTime(
    ((purchasedRes && purchasedRes.data) || []).filter((doc) => !doc.buyerDeletedAt),
    ['soldAt', 'updatedAt', 'createdAt', '_createTime']
  );

  return {
    published: publishedDocs.map((doc) => buildGoodsSnapshot(doc, openid)),
    purchased: purchasedDocs.map((doc) => buildGoodsSnapshot(doc, openid))
  };
}

async function getGoodsDetail(goodsId = '', openid = '') {
  const id = pickStr(goodsId);
  if (!id) return { ok: false, code: 'MISSING_GOODS_ID', message: '缺少商品信息' };

  const docRes = await db.collection(GOODS_COLLECTION).doc(id).get();
  const doc = docRes && docRes.data ? docRes.data : null;
  if (!doc) return { ok: false, code: 'GOODS_NOT_FOUND', message: '商品不存在或已下架' };

  const access = canAccessGoodsDetail(doc, openid);
  if (!access.ok) {
    return {
      ok: false,
      code: access.code,
      message: '商品不存在或已下架'
    };
  }

  return {
    ok: true,
    doc
  };
}

async function deleteMyGoodsRecord(goodsId = '', role = '', openid = '') {
  const id = pickStr(goodsId);
  const targetRole = pickStr(role);
  if (!id) return { ok: false, code: 'MISSING_GOODS_ID', message: '缺少商品信息' };
  if (!['published', 'purchased'].includes(targetRole)) {
    return { ok: false, code: 'INVALID_ROLE', message: '删除角色不合法' };
  }

  const docRes = await db.collection(GOODS_COLLECTION).doc(id).get();
  const doc = docRes && docRes.data ? docRes.data : null;
  if (!doc) return { ok: false, code: 'GOODS_NOT_FOUND', message: '商品不存在或已删除' };

  const ownerOpenid = pickStr(doc._openid, doc.ownerOpenid);
  const buyerOpenid = pickStr(doc.buyerOpenid, doc.buyer_openid, doc.buyerOpenId);
  const status = pickStr(doc.status, 'posted');
  const now = db.serverDate();

  if (targetRole === 'published') {
    if (!ownerOpenid || ownerOpenid !== openid) {
      return { ok: false, code: 'NO_PERMISSION', message: '只有发布者可以删除该记录' };
    }
    if (doc.sellerDeletedAt) {
      return { ok: true, already: true, role: 'published' };
    }
    if (isGoodsPaymentLockActive(doc.paymentLock)) {
      return { ok: false, code: 'PAY_LOCKED', message: '当前有买家正在支付，暂时不能删除' };
    }

    const updateData = {
      sellerDeletedAt: now,
      updatedAt: now
    };
    if (status === 'posted') {
      updateData.status = 'off_shelf';
      updateData.offShelfAt = now;
    }
    await db.collection(GOODS_COLLECTION).doc(id).update({ data: updateData });
    return { ok: true, role: 'published', nextStatus: pickStr(updateData.status, status) };
  }

  if (!buyerOpenid || buyerOpenid !== openid || status !== 'sold') {
    return { ok: false, code: 'NO_PERMISSION', message: '只有买家可以删除该购买记录' };
  }
  if (doc.buyerDeletedAt) {
    return { ok: true, already: true, role: 'purchased' };
  }

  await db.collection(GOODS_COLLECTION).doc(id).update({
    data: {
      buyerDeletedAt: now,
      updatedAt: now
    }
  });
  return { ok: true, role: 'purchased' };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = pickStr(event.action);

  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID' };
  }

  try {
    if (action === 'get_goods_snapshots') {
      const items = await getGoodsSnapshots(event.ids, OPENID);
      return { ok: true, items };
    }

    if (action === 'list_my_goods') {
      const data = await listMyGoods(OPENID, event.limit);
      return { ok: true, ...data };
    }

    if (action === 'delete_my_goods_record') {
      return deleteMyGoodsRecord(event.goodsId, event.role, OPENID);
    }

    if (action === 'get_goods_detail') {
      return getGoodsDetail(event.goodsId, OPENID);
    }

    return { ok: false, code: 'INVALID_ACTION' };
  } catch (err) {
    console.error('[getGoodsProfile] failed', action, err);
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: pickStr(err && err.message, '服务异常')
    };
  }
};
