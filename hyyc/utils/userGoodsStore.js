const db = wx.cloud.database();
const { getStoredUser, patchStoredUser, setStoredUser } = require('./userIdentity');

const USER_COLLECTION = 'userInfo';
const GOODS_FAVORITES_MAX = 60;
const GOODS_HISTORY_MAX = 100;

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
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function toMoneyValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isFunctionNotFoundError(err = {}) {
  const text = pickStr(
    err && err.errMsg,
    err && err.message,
    err
  );
  return text.includes('FunctionName parameter could not be found')
    || text.includes('FUNCTION_NOT_FOUND')
    || text.includes('-501000');
}

function buildGoodsSnapshot(goods = {}) {
  const images = Array.isArray(goods.images) ? goods.images.filter(Boolean) : [];
  const coverImage = pickStr(goods.coverImage, goods.image, images[0]);

  return {
    goodsId: pickStr(goods.goodsId, goods.id, goods._id),
    title: pickStr(goods.title, goods.desc, '未命名商品'),
    desc: pickStr(goods.desc),
    price: toMoneyValue(goods.price),
    originalPrice: toMoneyValue(goods.originalPrice),
    category: pickStr(goods.category),
    condition: pickStr(goods.condition),
    tradeType: pickStr(goods.tradeType),
    community: pickStr(goods.community),
    building: pickStr(goods.building),
    status: pickStr(goods.status, 'posted'),
    coverImage,
    images: images.length ? images : (coverImage ? [coverImage] : []),
    coverRatio: toMoneyValue(goods.coverRatio),
    ownerId: pickStr(goods.ownerId),
    ownerOpenid: pickStr(goods._openid, goods.ownerOpenid),
    ownerName: pickStr(goods.ownerNickname, goods.sellerName, goods.ownerName, goods.name),
    ownerAvatarFileID: pickStr(goods.ownerAvatarFileID, goods.ownerAvatarUrl),
    isOwner: goods.isOwner === true,
    isBuyer: goods.isBuyer === true,
    canView: goods.canView !== false,
    favoritedAtTs: toTimeMs(goods.favoritedAtTs),
    viewedAtTs: toTimeMs(goods.viewedAtTs),
    updatedAtTs: toTimeMs(goods.updatedAtTs || goods.updatedAt || goods.createdAt || goods._createTime)
  };
}

async function fetchLatestGoodsSnapshotMap(goodsIds = []) {
  const ids = [];
  const seen = {};
  (Array.isArray(goodsIds) ? goodsIds : []).forEach((item) => {
    const goodsId = pickStr(item);
    if (!goodsId || seen[goodsId]) return;
    seen[goodsId] = true;
    ids.push(goodsId);
  });

  if (!ids.length) return {};

  try {
    const res = await wx.cloud.callFunction({
      name: 'getGoodsProfile',
      data: {
        action: 'get_goods_snapshots',
        ids
      }
    });
    const result = (res && res.result) || {};
    if (result && result.ok === false) {
      return {};
    }
    const list = Array.isArray(result.items) ? result.items : [];
    const map = {};
    list.forEach((item) => {
      const goodsId = pickStr(item && (item.goodsId || item._id || item.id));
      if (goodsId) map[goodsId] = item;
    });
    return map;
  } catch (err) {
    if (!isFunctionNotFoundError(err)) {
      console.warn('获取最新商品快照失败，回退本地缓存', err);
    }
    return {};
  }
}

function normalizeGoodsList(list = [], maxCount = 0, timeField = '') {
  const out = [];
  const seen = {};

  (Array.isArray(list) ? list : []).forEach((item) => {
    const snapshot = buildGoodsSnapshot(item);
    const goodsId = pickStr(snapshot.goodsId);
    if (!goodsId || seen[goodsId]) return;
    seen[goodsId] = true;

    if (timeField) {
      snapshot[timeField] = toTimeMs(item && item[timeField]);
    }
    out.push(snapshot);
  });

  if (timeField) {
    out.sort((a, b) => toTimeMs(b[timeField]) - toTimeMs(a[timeField]));
  }

  if (maxCount > 0) return out.slice(0, maxCount);
  return out;
}

function mergeGoodsList(list = [], goods = {}, timeField = '', maxCount = 0) {
  const snapshot = buildGoodsSnapshot(goods);
  const goodsId = pickStr(snapshot.goodsId);
  if (!goodsId) return normalizeGoodsList(list, maxCount, timeField);

  if (timeField) {
    snapshot[timeField] = toTimeMs(goods[timeField]) || Date.now();
  }

  const next = [snapshot].concat((Array.isArray(list) ? list : []).filter((item) => {
    return pickStr(item && item.goodsId, item && item.id, item && item._id) !== goodsId;
  }));

  return normalizeGoodsList(next, maxCount, timeField);
}

function mergeLatestSnapshotList(list = [], latestMap = {}, timeField = '', maxCount = 0) {
  const source = Array.isArray(list) ? list : [];
  const next = source.map((item) => {
    const goodsId = pickStr(item && item.goodsId, item && item.id, item && item._id);
    const latest = latestMap && latestMap[goodsId];
    if (!latest) return buildGoodsSnapshot(item);

    const merged = buildGoodsSnapshot({
      ...item,
      ...latest,
      goodsId
    });
    if (timeField) {
      merged[timeField] = toTimeMs(item && item[timeField]);
    }
    return merged;
  });
  return normalizeGoodsList(next, maxCount, timeField);
}

async function ensureOpenid() {
  const cached = getStoredUser();
  let openid = pickStr(cached._openid, cached.openid, cached.openId);
  if (openid) return openid;

  try {
    const res = await wx.cloud.callFunction({ name: 'login' });
    openid = pickStr(res && res.result && res.result.openid);
    if (openid) {
      patchStoredUser({ _openid: openid });
    }
  } catch (e) {
    openid = '';
  }

  return openid;
}

async function resolveUserDoc() {
  const cachedUser = getStoredUser();
  const cachedDocId = pickStr(cachedUser.id, cachedUser._id);
  const openid = await ensureOpenid();

  if (!openid) {
    return {
      openid: '',
      docId: cachedDocId,
      userDoc: cachedDocId ? { ...cachedUser, _id: cachedDocId } : null,
      cachedUser
    };
  }

  try {
    const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
    const list = (res && res.data) || [];
    const userDoc = list[0] || null;
    const docId = pickStr(userDoc && userDoc._id, userDoc && userDoc.id, cachedDocId);

    if (userDoc && docId) {
      setStoredUser({ ...cachedUser, ...userDoc, id: docId });
    }

    return { openid, docId, userDoc, cachedUser };
  } catch (err) {
    console.warn('读取用户商品偏好失败，回退本地缓存', err);
    return {
      openid,
      docId: cachedDocId,
      userDoc: cachedDocId ? { ...cachedUser, _id: cachedDocId } : null,
      cachedUser
    };
  }
}

function saveCachedUserPatch(docId = '', patch = {}) {
  try {
    const cached = getStoredUser();
    const next = { ...cached, ...patch };
    if (docId) next.id = docId;
    setStoredUser(next);
  } catch (e) {
    // ignore
  }
}

async function loadGoodsCollections(options = {}) {
  const { docId, userDoc, cachedUser } = await resolveUserDoc();
  const source = userDoc || cachedUser || {};
  const favorites = normalizeGoodsList(source.goodsFavorites, GOODS_FAVORITES_MAX, 'favoritedAtTs');
  const history = normalizeGoodsList(source.goodsBrowseHistory, GOODS_HISTORY_MAX, 'viewedAtTs');
  const refreshLatest = !!(options && options.refreshLatest);

  if (!refreshLatest) {
    return { docId, favorites, history, userDoc, cachedUser };
  }

  const goodsIds = favorites
    .concat(history)
    .map((item) => pickStr(item && item.goodsId))
    .filter(Boolean);
  const latestMap = await fetchLatestGoodsSnapshotMap(goodsIds);
  if (!Object.keys(latestMap).length) {
    return { docId, favorites, history, userDoc, cachedUser };
  }

  const nextFavorites = mergeLatestSnapshotList(favorites, latestMap, 'favoritedAtTs', GOODS_FAVORITES_MAX);
  const nextHistory = mergeLatestSnapshotList(history, latestMap, 'viewedAtTs', GOODS_HISTORY_MAX);
  const favoritesChanged = JSON.stringify(nextFavorites) !== JSON.stringify(favorites);
  const historyChanged = JSON.stringify(nextHistory) !== JSON.stringify(history);

  if (docId && (favoritesChanged || historyChanged)) {
    const patch = {};
    if (favoritesChanged) patch.goodsFavorites = nextFavorites;
    if (historyChanged) patch.goodsBrowseHistory = nextHistory;
    await db.collection(USER_COLLECTION).doc(docId).update({ data: patch });
    saveCachedUserPatch(docId, patch);
  } else if (favoritesChanged || historyChanged) {
    const patch = {};
    if (favoritesChanged) patch.goodsFavorites = nextFavorites;
    if (historyChanged) patch.goodsBrowseHistory = nextHistory;
    saveCachedUserPatch(docId, patch);
  }

  return {
    docId,
    favorites: nextFavorites,
    history: nextHistory,
    userDoc,
    cachedUser
  };
}

async function syncGoodsBrowseState(goods = {}) {
  const { docId, favorites, history } = await loadGoodsCollections();
  const nextHistory = mergeGoodsList(history, {
    ...goods,
    viewedAtTs: Date.now()
  }, 'viewedAtTs', GOODS_HISTORY_MAX);

  if (docId) {
    await db.collection(USER_COLLECTION).doc(docId).update({
      data: {
        goodsBrowseHistory: nextHistory
      }
    });
  }

  saveCachedUserPatch(docId, { goodsBrowseHistory: nextHistory });

  const goodsId = pickStr(goods.goodsId, goods.id, goods._id);
  const isFavorite = favorites.some((item) => pickStr(item.goodsId) === goodsId);
  return { isFavorite, favorites, history: nextHistory };
}

async function setGoodsFavorite(goods = {}, nextState = false) {
  const { docId, favorites, history } = await loadGoodsCollections();
  const goodsId = pickStr(goods.goodsId, goods.id, goods._id);

  const nextFavorites = nextState
    ? mergeGoodsList(favorites, { ...goods, favoritedAtTs: Date.now() }, 'favoritedAtTs', GOODS_FAVORITES_MAX)
    : normalizeGoodsList((favorites || []).filter((item) => {
      return pickStr(item && item.goodsId) !== goodsId;
    }), GOODS_FAVORITES_MAX, 'favoritedAtTs');

  const hasHistoryItem = (history || []).some((item) => pickStr(item && item.goodsId) === goodsId);
  const nextHistory = hasHistoryItem
    ? history
    : mergeGoodsList(history, {
      ...goods,
      viewedAtTs: Date.now()
    }, 'viewedAtTs', GOODS_HISTORY_MAX);

  const patch = {
    goodsFavorites: nextFavorites,
    goodsBrowseHistory: nextHistory
  };

  if (docId) {
    await db.collection(USER_COLLECTION).doc(docId).update({ data: patch });
  }

  saveCachedUserPatch(docId, patch);

  return {
    isFavorite: !!nextState,
    favorites: nextFavorites,
    history: nextHistory
  };
}

module.exports = {
  buildGoodsSnapshot,
  ensureOpenid,
  loadGoodsCollections,
  setGoodsFavorite,
  syncGoodsBrowseState
};
