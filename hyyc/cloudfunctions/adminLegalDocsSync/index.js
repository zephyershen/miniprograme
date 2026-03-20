const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { buildDefaultLegalDocs, VERSION, EFFECTIVE_DATE } = require('./legalTemplates');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const BUILD_TAG = 'adminLegalDocsSync@2026-03-19.1';
const LEGAL_COLLECTION = 'legal_docs';
const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = typeof vals[i] === 'string' ? vals[i] : (vals[i] == null ? '' : String(vals[i]));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function md5(text = '') {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

async function ensureCollectionExists(name = '') {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (err) {
    // ignore
  }
}

function buildDocPayload(source = {}, now = new Date(), openid = '') {
  const content = pickStr(source.content);
  const title = pickStr(source.title);
  const version = pickStr(source.version, VERSION);
  const effectiveDate = pickStr(source.effectiveDate, EFFECTIVE_DATE);
  const digest = md5(JSON.stringify({
    type: pickStr(source.type),
    title,
    version,
    effectiveDate,
    content,
  }));
  return {
    type: pickStr(source.type),
    title,
    version,
    effectiveDate,
    status: 'active',
    content,
    hash: digest,
    updatedAt: now,
    effectiveAt: now,
    source: 'admin_sync',
    sourceLabel: '管理员同步默认协议',
    updatedByOpenid: pickStr(openid),
    archivedAt: null,
    archivedReason: '',
  };
}

async function queryDocsByType(type = '') {
  const res = await db.collection(LEGAL_COLLECTION).where({ type }).limit(100).get();
  return (res && res.data) || [];
}

exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  const openid = pickStr(wxContext.OPENID, wxContext.openId);
  const action = pickStr(event.action, 'sync_default_docs');

  console.log('[adminLegalDocsSync] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid,
  }));

  if (openid !== PLATFORM_ADMIN_OPENID) {
    return { ok: false, code: 'AUTH_FAIL', msg: '仅管理员可操作', buildTag: BUILD_TAG };
  }
  if (action !== 'sync_default_docs') {
    return { ok: false, code: 'UNSUPPORTED_ACTION', msg: `unsupported_action:${action}`, buildTag: BUILD_TAG };
  }

  await ensureCollectionExists(LEGAL_COLLECTION);

  const now = new Date();
  const templates = buildDefaultLegalDocs();
  const summary = [];

  for (let i = 0; i < templates.length; i += 1) {
    const template = templates[i] || {};
    const type = pickStr(template.type);
    const docId = pickStr(template._id);
    if (!type || !docId) continue;

    const currentList = await queryDocsByType(type);
    const targetPayload = buildDocPayload(template, now, openid);
    const existingTarget = currentList.find((item) => pickStr(item && item._id) === docId) || null;

    for (let j = 0; j < currentList.length; j += 1) {
      const item = currentList[j] || {};
      const itemId = pickStr(item._id);
      if (!itemId || itemId === docId) continue;
      if (pickStr(item.status) !== 'archived') {
        await db.collection(LEGAL_COLLECTION).doc(itemId).update({
          data: {
            status: 'archived',
            archivedAt: now,
            archivedReason: `被 ${docId} 替换`,
            updatedAt: now,
            updatedByOpenid: openid,
          }
        }).catch(() => null);
      }
    }

    if (existingTarget) {
      await db.collection(LEGAL_COLLECTION).doc(docId).set({
        data: {
          ...targetPayload,
          createdAt: existingTarget.createdAt || now,
        }
      });
    } else {
      await db.collection(LEGAL_COLLECTION).doc(docId).set({
        data: {
          ...targetPayload,
          createdAt: now,
        }
      });
    }

    summary.push({
      type,
      docId,
      title: targetPayload.title,
      version: targetPayload.version,
      effectiveDate: targetPayload.effectiveDate,
      hash: targetPayload.hash,
      replacedCount: currentList.filter((item) => pickStr(item && item._id) && pickStr(item._id) !== docId).length,
      created: !existingTarget,
      updated: !!existingTarget,
    });
  }

  return {
    ok: true,
    action,
    buildTag: BUILD_TAG,
    syncedAt: now,
    version: VERSION,
    effectiveDate: EFFECTIVE_DATE,
    docs: summary,
  };
};
