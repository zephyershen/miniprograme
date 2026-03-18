const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const BUILD_TAG = 'adminResetTestData@2026-03-18.1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'adminhyyc';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hyyc2026';
const REQUIRED_CONFIRM_TEXT = 'CLEAR_TEST_DATA';
const PAGE_SIZE = 100;
const FILE_BATCH_SIZE = 50;
const SAMPLE_LIMIT = 40;
const MAX_SCAN_LIMIT = 20000;

const COLLECTIONS = [
  'userInfo',
  'goods',
  'tasks',
  'messages',
  'wallets',
  'wallet_transactions',
  'wallet_withdraw_requests',
  'image_audit_jobs',
  'huifu_notify_logs',
  'finance_compensate_logs',
];

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function clampInt(v, fallback = 2000, min = 1, max = MAX_SCAN_LIMIT) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function pushSample(bucket = [], item = {}) {
  if (!Array.isArray(bucket) || bucket.length >= SAMPLE_LIMIT) return;
  bucket.push(item);
}

function isCloudFileId(v = '') {
  return pickStr(v).indexOf('cloud://') === 0;
}

function uniqueList(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((item) => pickStr(item)).filter(Boolean)));
}

function appendCloudFileId(bucket = [], value = '') {
  if (!Array.isArray(bucket)) return;
  const fileId = pickStr(value);
  if (isCloudFileId(fileId)) bucket.push(fileId);
}

function appendCloudFileList(bucket = [], list = []) {
  (Array.isArray(list) ? list : []).forEach((item) => {
    appendCloudFileId(bucket, item);
  });
}

function collectFileIds(collectionName = '', doc = {}) {
  const fileIds = [];
  switch (collectionName) {
    case 'userInfo':
      appendCloudFileId(fileIds, doc.avatarFileID);
      appendCloudFileId(fileIds, doc.idCardFrontFileID);
      appendCloudFileId(fileIds, doc.idCardBackFileID);
      break;
    case 'goods':
      appendCloudFileId(fileIds, doc.ownerAvatarFileID);
      appendCloudFileList(fileIds, doc.images);
      break;
    case 'tasks':
      appendCloudFileId(fileIds, doc.ownerAvatarFileID);
      appendCloudFileId(fileIds, doc.workerAvatarFileID);
      appendCloudFileList(fileIds, doc.images);
      appendCloudFileList(fileIds, doc.submit && doc.submit.images);
      break;
    case 'messages':
      appendCloudFileId(fileIds, doc.imageUrl);
      appendCloudFileId(fileIds, doc.goodsImage);
      appendCloudFileId(fileIds, doc.sellerAvatarFileID);
      appendCloudFileId(fileIds, doc.peerAvatarFileID);
      appendCloudFileId(fileIds, doc.fromAvatarFileID);
      break;
    case 'image_audit_jobs':
      (Array.isArray(doc.images) ? doc.images : []).forEach((item) => {
        appendCloudFileId(fileIds, item && item.fileID);
      });
      break;
    default:
      break;
  }
  return uniqueList(fileIds);
}

async function getCollectionCount(name = '') {
  try {
    const ret = await db.collection(name).count();
    return Number(ret && ret.total) || 0;
  } catch (err) {
    return 0;
  }
}

async function scanCollection(name = '', limit = 2000) {
  const list = [];
  let skip = 0;
  const total = await getCollectionCount(name);
  const cappedLimit = Math.min(clampInt(limit, 2000), total || limit);

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

function buildResetPlan(collectionName = '', scan = {}) {
  const docIds = [];
  const fileIds = [];
  const samples = [];
  const docs = Array.isArray(scan.list) ? scan.list : [];

  docs.forEach((doc) => {
    const docId = pickStr(doc && doc._id);
    if (!docId) return;
    docIds.push(docId);
    const docFileIds = collectFileIds(collectionName, doc);
    docFileIds.forEach((fileId) => fileIds.push(fileId));
    pushSample(samples, {
      docId,
      fileIds: docFileIds.slice(0, 5),
    });
  });

  return {
    collectionName,
    docIds: uniqueList(docIds),
    fileIds: uniqueList(fileIds),
    samples,
  };
}

async function removeDocs(collectionName = '', docIds = [], dryRun = true) {
  const result = {
    collectionName,
    matched: Array.isArray(docIds) ? docIds.length : 0,
    removed: 0,
    failed: 0,
    errors: [],
  };
  if (dryRun || !Array.isArray(docIds) || !docIds.length) return result;

  for (let i = 0; i < docIds.length; i += 1) {
    const docId = pickStr(docIds[i]);
    if (!docId) continue;
    try {
      await db.collection(collectionName).doc(docId).remove();
      result.removed += 1;
    } catch (err) {
      result.failed += 1;
      pushSample(result.errors, {
        docId,
        msg: pickStr(err && (err.errMsg || err.message), 'remove failed'),
      });
    }
  }

  return result;
}

async function removeFiles(fileIds = [], dryRun = true) {
  const normalized = uniqueList(fileIds);
  const result = {
    matched: normalized.length,
    removed: 0,
    failed: 0,
    errors: [],
  };
  if (dryRun || !normalized.length) return result;

  for (let i = 0; i < normalized.length; i += FILE_BATCH_SIZE) {
    const batch = normalized.slice(i, i + FILE_BATCH_SIZE);
    if (!batch.length) continue;
    try {
      await cloud.deleteFile({ fileList: batch });
      result.removed += batch.length;
    } catch (err) {
      for (let j = 0; j < batch.length; j += 1) {
        const fileId = batch[j];
        try {
          await cloud.deleteFile({ fileList: [fileId] });
          result.removed += 1;
        } catch (singleErr) {
          result.failed += 1;
          pushSample(result.errors, {
            fileId,
            msg: pickStr(singleErr && (singleErr.errMsg || singleErr.message), 'delete file failed'),
          });
        }
      }
    }
  }

  return result;
}

exports.main = async (event = {}) => {
  const username = pickStr(event.username);
  const password = pickStr(event.password);
  const dryRun = event.dryRun !== false;
  const scanLimit = clampInt(event.scanLimit || event.limit, 2000);
  const includeFiles = event.includeFiles !== false;
  const confirmText = pickStr(event.confirmText);

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return { ok: false, code: 'AUTH_FAIL', msg: '管理员认证失败', buildTag: BUILD_TAG };
  }
  if (!dryRun && confirmText !== REQUIRED_CONFIRM_TEXT) {
    return {
      ok: false,
      code: 'CONFIRM_REQUIRED',
      msg: `执行清空前必须输入确认口令：${REQUIRED_CONFIRM_TEXT}`,
      buildTag: BUILD_TAG,
      requiredConfirmText: REQUIRED_CONFIRM_TEXT,
    };
  }

  const scanEntries = await Promise.all(COLLECTIONS.map(async (collectionName) => ({
    collectionName,
    scan: await scanCollection(collectionName, scanLimit),
  })));

  const scanned = {};
  const plans = [];
  let hasTruncatedScan = false;
  scanEntries.forEach((entry) => {
    const collectionName = entry.collectionName;
    const scan = entry.scan || {};
    scanned[collectionName] = {
      total: Number(scan.total) || 0,
      scanned: Number(scan.scanned) || 0,
      truncated: !!scan.truncated,
    };
    if (scan.truncated) hasTruncatedScan = true;
    plans.push(buildResetPlan(collectionName, scan));
  });

  const allFileIds = includeFiles
    ? uniqueList(plans.reduce((acc, item) => acc.concat(item.fileIds || []), []))
    : [];

  const collectionResults = [];
  let totalMatched = 0;
  let totalRemoved = 0;
  let totalFailed = 0;
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i] || {};
    const ret = await removeDocs(plan.collectionName, plan.docIds, dryRun || hasTruncatedScan);
    collectionResults.push(ret);
    totalMatched += ret.matched;
    totalRemoved += ret.removed;
    totalFailed += ret.failed;
  }

  const fileResult = await removeFiles(allFileIds, dryRun || hasTruncatedScan || !includeFiles);
  const ok = totalFailed === 0 && fileResult.failed === 0 && !hasTruncatedScan;
  const code = hasTruncatedScan ? 'SCAN_LIMIT_TOO_SMALL' : (ok ? 'OK' : 'PARTIAL_FAIL');
  const msg = hasTruncatedScan
    ? '扫描数量上限过小，未覆盖全库，请调大 scanLimit 后重试'
    : (dryRun ? '测试数据预检查完成' : '测试数据清空执行完成');

  const samples = {};
  plans.forEach((plan) => {
    samples[plan.collectionName] = plan.samples;
  });

  const errors = {
    collections: {},
    files: fileResult.errors,
  };
  collectionResults.forEach((item) => {
    errors.collections[item.collectionName] = item.errors;
  });

  return {
    ok,
    code,
    msg,
    buildTag: BUILD_TAG,
    requiredConfirmText: REQUIRED_CONFIRM_TEXT,
    preservedCollections: ['legal_docs'],
    scanned,
    summary: {
      dryRun,
      scanLimit,
      includeFiles,
      hasTruncatedScan,
      collections: collectionResults.reduce((acc, item) => {
        acc[item.collectionName] = {
          matched: item.matched,
          removed: item.removed,
          failed: item.failed,
        };
        return acc;
      }, {}),
      files: {
        matched: fileResult.matched,
        removed: fileResult.removed,
        failed: fileResult.failed,
      },
      totals: {
        matched: totalMatched,
        removed: totalRemoved,
        failed: totalFailed + fileResult.failed,
      },
    },
    samples,
    errors,
    notes: [
      'legal_docs 会被保留，不参与清空',
      'finance_compensate_logs 和 huifu_notify_logs 后续可能被定时器或回调重新写入',
      '清空数据库不会自动回滚汇付侧的开户、绑卡或支付外部状态',
    ],
  };
};
