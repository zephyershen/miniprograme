const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const TASK_COLLECTION = 'tasks';
const GOODS_COLLECTION = 'goods';
const MSG_COLLECTION = 'messages';

const BUILD_TAG = 'adminRepairUserIdentity@2026-03-18.1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'adminhyyc';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hyyc2026';
const PAGE_SIZE = 100;
const MAX_SCAN_LIMIT = 5000;
const SAMPLE_LIMIT = 40;

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function clampInt(v, fallback = 500, min = 1, max = MAX_SCAN_LIMIT) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function firstImage(doc = {}) {
  const list = Array.isArray(doc.images) ? doc.images : [];
  return pickStr(list[0], doc.coverImage, doc.image);
}

function shallowEqualPatch(doc = {}, patch = {}) {
  const keys = Object.keys(patch || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (pickStr(doc && doc[key]) !== pickStr(patch[key])) return false;
  }
  return true;
}

function pushSample(bucket = [], item = {}) {
  if (!Array.isArray(bucket) || bucket.length >= SAMPLE_LIMIT) return;
  bucket.push(item);
}

async function getCollectionCount(name = '') {
  try {
    const ret = await db.collection(name).count();
    return Number(ret && ret.total) || 0;
  } catch (err) {
    return 0;
  }
}

async function scanCollection(name = '', limit = 500) {
  const list = [];
  let skip = 0;
  const total = await getCollectionCount(name);
  const cappedLimit = Math.min(clampInt(limit, 500), total || limit);

  while (list.length < cappedLimit) {
    const currentLimit = Math.min(PAGE_SIZE, cappedLimit - list.length);
    if (currentLimit <= 0) break;
    const res = await db.collection(name)
      .skip(skip)
      .limit(currentLimit)
      .get();
    const part = (res && res.data) || [];
    if (!part.length) break;
    list.push(...part);
    skip += part.length;
    if (part.length < currentLimit) break;
  }

  return {
    total,
    scanned: list.length,
    truncated: total > list.length,
    list,
  };
}

function buildUserIndex(users = []) {
  const byOpenid = {};
  const byId = {};
  const duplicateOpenids = {};

  (Array.isArray(users) ? users : []).forEach((user) => {
    const docId = pickStr(user && user._id);
    const openid = pickStr(user && user._openid);
    const storedId = pickStr(user && user.id, docId);
    if (docId) {
      byId[docId] = {
        ...(byId[docId] || {}),
        ...user,
        id: storedId,
      };
    }
    if (!openid) return;
    if (byOpenid[openid] && byOpenid[openid] !== docId) {
      duplicateOpenids[openid] = true;
      return;
    }
    byOpenid[openid] = docId;
  });

  Object.keys(duplicateOpenids).forEach((openid) => {
    delete byOpenid[openid];
  });

  return {
    byOpenid,
    byId,
    duplicateOpenids: Object.keys(duplicateOpenids),
  };
}

function buildRepairsForUsers(users = []) {
  const repairs = [];
  const samples = [];

  (Array.isArray(users) ? users : []).forEach((user) => {
    const docId = pickStr(user && user._id);
    if (!docId) return;
    const patch = {};
    const reasons = [];

    if (pickStr(user && user.id) !== docId) {
      patch.id = docId;
      reasons.push('id <- _id');
    }

    if (!Object.keys(patch).length || shallowEqualPatch(user, patch)) return;
    repairs.push({ docId, patch, reasons });
    pushSample(samples, { docId, patch, reasons });
  });

  return { repairs, samples };
}

function buildRepairsForTasks(tasks = [], userIndex = {}) {
  const repairs = [];
  const samples = [];
  const byOpenid = userIndex && userIndex.byOpenid ? userIndex.byOpenid : {};

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const docId = pickStr(task && task._id);
    if (!docId) return;
    const patch = {};
    const reasons = [];

    const ownerOpenid = pickStr(task && task._openid);
    const expectedOwnerId = pickStr(byOpenid[ownerOpenid]);
    if (expectedOwnerId && pickStr(task && task.ownerId) !== expectedOwnerId) {
      patch.ownerId = expectedOwnerId;
      reasons.push('ownerId <- ownerOpenid');
    }

    const workerOpenid = pickStr(task && task.workerOpenid, task && task.worker_openid);
    const expectedWorkerId = pickStr(byOpenid[workerOpenid]);
    if (expectedWorkerId && pickStr(task && task.workerId) !== expectedWorkerId) {
      patch.workerId = expectedWorkerId;
      reasons.push('workerId <- workerOpenid');
    }

    if (!Object.keys(patch).length || shallowEqualPatch(task, patch)) return;
    repairs.push({ docId, patch, reasons });
    pushSample(samples, { docId, patch, reasons });
  });

  return { repairs, samples };
}

function buildRepairsForGoods(goodsList = [], userIndex = {}) {
  const repairs = [];
  const samples = [];
  const byOpenid = userIndex && userIndex.byOpenid ? userIndex.byOpenid : {};

  (Array.isArray(goodsList) ? goodsList : []).forEach((goods) => {
    const docId = pickStr(goods && goods._id);
    if (!docId) return;
    const patch = {};
    const reasons = [];

    const ownerOpenid = pickStr(goods && goods._openid, goods && goods.ownerOpenid);
    const expectedOwnerId = pickStr(byOpenid[ownerOpenid]);
    if (ownerOpenid && pickStr(goods && goods.ownerOpenid) !== ownerOpenid) {
      patch.ownerOpenid = ownerOpenid;
      reasons.push('ownerOpenid <- _openid');
    }
    if (expectedOwnerId && pickStr(goods && goods.ownerId) !== expectedOwnerId) {
      patch.ownerId = expectedOwnerId;
      reasons.push('ownerId <- ownerOpenid');
    }

    const buyerOpenid = pickStr(goods && goods.buyerOpenid, goods && goods.buyer_openid, goods && goods.buyerOpenId);
    const expectedBuyerId = pickStr(byOpenid[buyerOpenid]);
    if (expectedBuyerId && pickStr(goods && goods.buyerId) !== expectedBuyerId) {
      patch.buyerId = expectedBuyerId;
      reasons.push('buyerId <- buyerOpenid');
    }

    if (!Object.keys(patch).length || shallowEqualPatch(goods, patch)) return;
    repairs.push({ docId, patch, reasons });
    pushSample(samples, { docId, patch, reasons });
  });

  return { repairs, samples };
}

function applyRepairMap(list = [], repairs = []) {
  const patchMap = {};
  (Array.isArray(repairs) ? repairs : []).forEach((item) => {
    const docId = pickStr(item && item.docId);
    if (!docId) return;
    patchMap[docId] = item.patch || {};
  });
  return (Array.isArray(list) ? list : []).map((doc) => {
    const docId = pickStr(doc && doc._id);
    return docId && patchMap[docId] ? { ...doc, ...patchMap[docId] } : doc;
  });
}

function buildTaskMap(tasks = []) {
  const map = {};
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const docId = pickStr(task && task._id);
    if (docId) map[docId] = task;
  });
  return map;
}

function buildGoodsMap(goodsList = []) {
  const map = {};
  (Array.isArray(goodsList) ? goodsList : []).forEach((goods) => {
    const docId = pickStr(goods && goods._id);
    if (docId) map[docId] = goods;
  });
  return map;
}

function buildRepairsForMessages(messages = [], ctx = {}) {
  const repairs = [];
  const samples = [];
  const byOpenid = ctx && ctx.userByOpenid ? ctx.userByOpenid : {};
  const byId = ctx && ctx.userById ? ctx.userById : {};
  const taskMap = ctx && ctx.taskMap ? ctx.taskMap : {};
  const goodsMap = ctx && ctx.goodsMap ? ctx.goodsMap : {};

  (Array.isArray(messages) ? messages : []).forEach((doc) => {
    const docId = pickStr(doc && doc._id);
    if (!docId) return;

    const patch = {};
    const reasons = [];
    const isGoodsMsg = pickStr(doc && doc.bizType) === 'goods' || !!pickStr(doc && doc.gid, doc && doc.goodsId);

    if (isGoodsMsg) {
      const gid = pickStr(doc && doc.gid, doc && doc.goodsId);
      const goods = goodsMap[gid] || {};
      const sellerOpenid = pickStr(doc && doc.sellerOpenid, goods && goods._openid, goods && goods.ownerOpenid);
      const sellerId = pickStr(
        sellerOpenid && byOpenid[sellerOpenid],
        goods && goods.ownerId,
        doc && doc.sellerId
      );
      const peerOpenid = pickStr(doc && doc.peerOpenid);
      const peerId = pickStr(
        peerOpenid && byOpenid[peerOpenid],
        doc && doc.peerUserId
      );
      const fromOpenid = pickStr(doc && doc.fromOpenid);
      const fromId = pickStr(
        fromOpenid && byOpenid[fromOpenid],
        doc && doc.fromUserId
      );

      if (gid && pickStr(doc && doc.gid) !== gid) {
        patch.gid = gid;
        reasons.push('gid <- goodsId');
      }
      if (pickStr(doc && doc.bizType) !== 'goods') {
        patch.bizType = 'goods';
        reasons.push('bizType <- goods');
      }
      if (sellerOpenid && pickStr(doc && doc.sellerOpenid) !== sellerOpenid) {
        patch.sellerOpenid = sellerOpenid;
        reasons.push('sellerOpenid <- goods/user');
      }
      if (sellerId && pickStr(doc && doc.sellerId) !== sellerId) {
        patch.sellerId = sellerId;
        reasons.push('sellerId <- sellerOpenid');
      }
      if (peerId && pickStr(doc && doc.peerUserId) !== peerId) {
        patch.peerUserId = peerId;
        reasons.push('peerUserId <- peerOpenid');
      }
      if (peerId && !pickStr(doc && doc.peerOpenid)) {
        const user = byId[peerId] || {};
        const normalizedPeerOpenid = pickStr(user && user._openid);
        if (normalizedPeerOpenid) {
          patch.peerOpenid = normalizedPeerOpenid;
          reasons.push('peerOpenid <- peerUserId');
        }
      }
      if (fromId && pickStr(doc && doc.fromUserId) !== fromId) {
        patch.fromUserId = fromId;
        reasons.push('fromUserId <- fromOpenid');
      }
      if (fromId && !pickStr(doc && doc.fromOpenid)) {
        const user = byId[fromId] || {};
        const normalizedFromOpenid = pickStr(user && user._openid);
        if (normalizedFromOpenid) {
          patch.fromOpenid = normalizedFromOpenid;
          reasons.push('fromOpenid <- fromUserId');
        }
      }
      if (!pickStr(doc && doc.goodsTitle)) {
        const goodsTitle = pickStr(goods && goods.title, goods && goods.desc);
        if (goodsTitle) {
          patch.goodsTitle = goodsTitle;
          reasons.push('goodsTitle <- goods');
        }
      }
      if (!pickStr(doc && doc.goodsImage)) {
        const goodsImage = firstImage(goods);
        if (goodsImage) {
          patch.goodsImage = goodsImage;
          reasons.push('goodsImage <- goods');
        }
      }
    } else {
      const tid = pickStr(doc && doc.tid);
      const task = taskMap[tid] || {};
      const ownerId = pickStr(task && task.ownerId, doc && doc.ownerId);
      const fromOpenid = pickStr(doc && doc.fromOpenid);
      const fromId = pickStr(fromOpenid && byOpenid[fromOpenid], doc && doc.fromUserId);
      const workerId = pickStr(task && task.workerId);
      const inferredPeerId = pickStr(
        workerId,
        (fromId && ownerId && fromId !== ownerId) ? fromId : '',
        doc && doc.peerUserId
      );

      if (ownerId && pickStr(doc && doc.ownerId) !== ownerId) {
        patch.ownerId = ownerId;
        reasons.push('ownerId <- task');
      }
      if (inferredPeerId && pickStr(doc && doc.peerUserId) !== inferredPeerId) {
        patch.peerUserId = inferredPeerId;
        reasons.push('peerUserId <- task/fromOpenid');
      }
      if (fromId && pickStr(doc && doc.fromUserId) !== fromId) {
        patch.fromUserId = fromId;
        reasons.push('fromUserId <- fromOpenid');
      }
      if (fromId && !pickStr(doc && doc.fromOpenid)) {
        const user = byId[fromId] || {};
        const normalizedFromOpenid = pickStr(user && user._openid);
        if (normalizedFromOpenid) {
          patch.fromOpenid = normalizedFromOpenid;
          reasons.push('fromOpenid <- fromUserId');
        }
      }
    }

    if (!Object.keys(patch).length || shallowEqualPatch(doc, patch)) return;
    repairs.push({ docId, patch, reasons });
    pushSample(samples, { docId, patch, reasons });
  });

  return { repairs, samples };
}

async function applyRepairs(collectionName = '', repairs = [], dryRun = true) {
  const result = {
    collectionName,
    matched: Array.isArray(repairs) ? repairs.length : 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  if (dryRun || !Array.isArray(repairs) || !repairs.length) return result;

  for (let i = 0; i < repairs.length; i += 1) {
    const item = repairs[i] || {};
    const docId = pickStr(item.docId);
    const patch = item.patch && typeof item.patch === 'object' ? item.patch : null;
    if (!docId || !patch || !Object.keys(patch).length) continue;

    try {
      await db.collection(collectionName).doc(docId).update({ data: patch });
      result.updated += 1;
    } catch (err) {
      result.failed += 1;
      pushSample(result.errors, {
        docId,
        msg: pickStr(err && (err.errMsg || err.message), 'update failed'),
      });
    }
  }

  return result;
}

exports.main = async (event = {}) => {
  const username = pickStr(event.username);
  const password = pickStr(event.password);
  const dryRun = event.dryRun !== false;
  const scanLimit = clampInt(event.scanLimit || event.limit, 500);

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return { ok: false, code: 'AUTH_FAIL', msg: '管理员认证失败', buildTag: BUILD_TAG };
  }

  const [userScan, taskScan, goodsScan, msgScan] = await Promise.all([
    scanCollection(USER_COLLECTION, scanLimit),
    scanCollection(TASK_COLLECTION, scanLimit),
    scanCollection(GOODS_COLLECTION, scanLimit),
    scanCollection(MSG_COLLECTION, scanLimit),
  ]);

  const userIndex = buildUserIndex(userScan.list);
  const userRepair = buildRepairsForUsers(userScan.list);
  const taskRepair = buildRepairsForTasks(taskScan.list, userIndex);
  const goodsRepair = buildRepairsForGoods(goodsScan.list, userIndex);

  const normalizedTasks = applyRepairMap(taskScan.list, taskRepair.repairs);
  const normalizedGoods = applyRepairMap(goodsScan.list, goodsRepair.repairs);
  const msgRepair = buildRepairsForMessages(msgScan.list, {
    userByOpenid: userIndex.byOpenid,
    userById: userIndex.byId,
    taskMap: buildTaskMap(normalizedTasks),
    goodsMap: buildGoodsMap(normalizedGoods),
  });

  const [userApply, taskApply, goodsApply, msgApply] = await Promise.all([
    applyRepairs(USER_COLLECTION, userRepair.repairs, dryRun),
    applyRepairs(TASK_COLLECTION, taskRepair.repairs, dryRun),
    applyRepairs(GOODS_COLLECTION, goodsRepair.repairs, dryRun),
    applyRepairs(MSG_COLLECTION, msgRepair.repairs, dryRun),
  ]);

  const scanned = {
    userInfo: { total: userScan.total, scanned: userScan.scanned, truncated: userScan.truncated },
    tasks: { total: taskScan.total, scanned: taskScan.scanned, truncated: taskScan.truncated },
    goods: { total: goodsScan.total, scanned: goodsScan.scanned, truncated: goodsScan.truncated },
    messages: { total: msgScan.total, scanned: msgScan.scanned, truncated: msgScan.truncated },
  };
  const hasDuplicateOpenids = userIndex.duplicateOpenids.length > 0;
  const hasTruncatedScan = userScan.truncated || taskScan.truncated || goodsScan.truncated || msgScan.truncated;

  const summary = {
    dryRun,
    scanLimit,
    duplicateOpenids: userIndex.duplicateOpenids,
    hasTruncatedScan,
    matched: {
      userInfo: userApply.matched,
      tasks: taskApply.matched,
      goods: goodsApply.matched,
      messages: msgApply.matched,
      total: userApply.matched + taskApply.matched + goodsApply.matched + msgApply.matched,
    },
    updated: {
      userInfo: userApply.updated,
      tasks: taskApply.updated,
      goods: goodsApply.updated,
      messages: msgApply.updated,
      total: userApply.updated + taskApply.updated + goodsApply.updated + msgApply.updated,
    },
    failed: {
      userInfo: userApply.failed,
      tasks: taskApply.failed,
      goods: goodsApply.failed,
      messages: msgApply.failed,
      total: userApply.failed + taskApply.failed + goodsApply.failed + msgApply.failed,
    },
  };
  const ok = summary.failed.total === 0 && !hasDuplicateOpenids && !hasTruncatedScan;
  const code = !ok
    ? (hasDuplicateOpenids ? 'DUPLICATE_OPENID' : (hasTruncatedScan ? 'SCAN_LIMIT_TOO_SMALL' : 'PARTIAL_FAIL'))
    : 'OK';
  const msg = hasDuplicateOpenids
    ? '发现重复 openid，请先人工处理 userInfo 重复记录'
    : (hasTruncatedScan
      ? '扫描数量上限过小，未覆盖全库，请调大 scanLimit 后重试'
      : (dryRun ? '身份数据预检查完成' : '身份数据修复执行完成'));

  return {
    ok,
    code,
    msg,
    buildTag: BUILD_TAG,
    scanned,
    summary,
    samples: {
      userInfo: userRepair.samples,
      tasks: taskRepair.samples,
      goods: goodsRepair.samples,
      messages: msgRepair.samples,
    },
    applyErrors: {
      userInfo: userApply.errors,
      tasks: taskApply.errors,
      goods: goodsApply.errors,
      messages: msgApply.errors,
    },
  };
};
