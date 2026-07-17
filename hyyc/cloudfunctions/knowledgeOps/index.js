const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = Object.freeze({
  memberships: 'knowledge_memberships',
  access: 'knowledge_feed_access_grants',
  items: 'knowledge_feed_items',
  analysis: 'knowledge_feed_item_analysis',
  analysisJobs: 'knowledge_feed_analysis_jobs',
  digests: 'knowledge_feed_digests'
});

function localRuntimeConfig() {
  try {
    return require('./config.local');
  } catch (error) {
    return {};
  }
}

const runtime = localRuntimeConfig();
const maintenanceToken = process.env.KNOWLEDGE_FEED_MAINTENANCE_TOKEN
  || runtime.knowledgeFeedMaintenanceToken
  || '';

class OpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function authorize(provided) {
  if (typeof provided !== 'string' || maintenanceToken.length < 32) {
    throw new OpsError('AUTH_REQUIRED', '该操作仅供云端维护');
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(maintenanceToken);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new OpsError('AUTH_REQUIRED', '该操作仅供云端维护');
  }
}

function ownerKeyForOpenId(openId) {
  if (typeof openId !== 'string' || !openId.trim()) throw new OpsError('INVALID_REQUEST', '缺少目标身份');
  return crypto.createHash('sha256').update(openId.trim()).digest('hex');
}

function resolveOwnerKey(event) {
  if (/^[a-f0-9]{64}$/.test(event && event.ownerKey || '')) return event.ownerKey;
  return ownerKeyForOpenId(event && event.targetOpenId);
}

function parseDate(value, fallback) {
  const date = value ? new Date(value) : fallback;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new OpsError('INVALID_REQUEST', '到期时间无效');
  }
  return date;
}

function analysisInputHash(item) {
  const input = {
    title: item && item.title || '',
    titleEn: item && item.titleEn || '',
    summary: item && item.summary || '',
    url: item && item.url || '',
    source: item && item.source || '',
    category: item && item.category || '',
    channelKey: item && item.channelKey || '',
    topicKeys: Array.isArray(item && item.topicKeys) ? [...item.topicKeys].sort() : []
  };
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function analysisJobId(provider, itemId, inputHash, policyVersion) {
  return crypto.createHash('sha256')
    .update(`${provider}\n${itemId}\n${inputHash}\n${policyVersion}`)
    .digest('hex');
}

async function ensureCollections(names) {
  await Promise.all(names.map((name) => db.createCollection(name).catch((error) => {
    if (!/already exists|exist|DATABASE_COLLECTION_EXIST/i.test(
      `${error.errCode || ''} ${error.code || ''} ${error.message || ''}`
    )) throw error;
  })));
}

async function grantMembership(event) {
  authorize(event.token);
  await ensureCollections([COLLECTIONS.memberships]);
  const ownerKey = resolveOwnerKey(event);
  const now = new Date();
  const currentPeriodEnd = parseDate(
    event.currentPeriodEnd || event.expiresAt,
    new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000))
  );
  const document = {
    ownerKey,
    planCode: 'pro',
    status: event.status === 'grace' ? 'grace' : 'active',
    startsAt: parseDate(event.startsAt, now),
    currentPeriodEnd,
    graceUntil: event.graceUntil ? parseDate(event.graceUntil) : null,
    renewalState: ['auto_renew', 'cancel_at_period_end'].includes(event.renewalState)
      ? event.renewalState
      : 'none',
    source: 'manual',
    version: 1,
    updatedAt: now
  };
  await db.collection(COLLECTIONS.memberships).doc(ownerKey).set({ data: document });
  return document;
}

async function revokeMembership(event) {
  authorize(event.token);
  await ensureCollections([COLLECTIONS.memberships]);
  const ownerKey = resolveOwnerKey(event);
  const updatedAt = new Date();
  await db.collection(COLLECTIONS.memberships).doc(ownerKey).update({
    data: { status: 'revoked', renewalState: 'none', updatedAt }
  });
  return { ownerKey, status: 'revoked', updatedAt };
}

async function grantAdmin(event) {
  authorize(event.token);
  await ensureCollections([COLLECTIONS.access]);
  const ownerKey = resolveOwnerKey(event);
  const updatedAt = new Date();
  const expiresAt = event.expiresAt ? parseDate(event.expiresAt) : null;
  const document = {
    ownerKey, role: 'admin', status: 'active', expiresAt,
    source: 'maintenance', updatedAt
  };
  await db.collection(COLLECTIONS.access).doc(ownerKey).set({ data: document });
  return document;
}

async function seedAnalysis(event) {
  authorize(event.token);
  await ensureCollections([COLLECTIONS.items, COLLECTIONS.analysisJobs]);
  const limit = Math.max(1, Math.min(200, Number(event.limit) || 100));
  const afterId = typeof event.afterId === 'string' ? event.afterId : '';
  const where = { publicState: 'active' };
  if (afterId) where._id = db.command.gt(afterId);
  const response = await db.collection(COLLECTIONS.items).where(where)
    .orderBy('_id', 'asc').limit(limit).get();
  const items = (response && response.data) || [];
  const now = new Date();
  const jobs = items.map((item) => {
    const inputHash = item.analysisInputHash || analysisInputHash(item);
    return {
      _id: analysisJobId(item.provider || 'aihot', item.id, inputHash, 1),
      provider: item.provider || 'aihot', itemId: item.id,
      expectedInputHash: inputHash, policyVersion: 1, priority: 100,
      status: 'pending', attempts: 0, nextAttemptAt: now,
      leaseOwner: '', leaseUntil: null, lastErrorCode: '',
      createdAt: now, updatedAt: now
    };
  });
  const existing = new Set();
  for (let offset = 0; offset < jobs.length; offset += 50) {
    const batch = jobs.slice(offset, offset + 50);
    if (!batch.length) continue;
    const found = await db.collection(COLLECTIONS.analysisJobs)
      .where({ _id: db.command.in(batch.map((job) => job._id)) })
      .field({ _id: true }).limit(batch.length).get();
    ((found && found.data) || []).forEach((document) => existing.add(document._id));
  }
  const inserts = jobs.filter((job) => !existing.has(job._id));
  for (let offset = 0; offset < inserts.length; offset += 50) {
    const batch = inserts.slice(offset, offset + 50);
    if (batch.length) await db.collection(COLLECTIONS.analysisJobs).add({ data: batch });
  }
  return {
    scanned: items.length,
    inserted: inserts.length,
    retained: jobs.length - inserts.length,
    nextAfterId: items.length ? items[items.length - 1]._id : '',
    done: items.length < limit
  };
}

async function count(collectionName, where = null) {
  await ensureCollections([collectionName]);
  const query = where ? db.collection(collectionName).where(where) : db.collection(collectionName);
  return Number((await query.count()).total) || 0;
}

async function status(event) {
  authorize(event.token);
  const [items, analyzed, jobs, pendingJobs, digests, memberships] = await Promise.all([
    count(COLLECTIONS.items),
    count(COLLECTIONS.analysis, { status: 'ready' }),
    count(COLLECTIONS.analysisJobs),
    count(COLLECTIONS.analysisJobs, { status: 'pending' }),
    count(COLLECTIONS.digests, { status: 'published' }),
    count(COLLECTIONS.memberships, { status: db.command.in(['active', 'grace']) })
  ]);
  return { items, analyzed, jobs, pendingJobs, digests, memberships };
}

const HANDLERS = Object.freeze({
  grantMembership,
  revokeMembership,
  grantAdmin,
  seedAnalysis,
  status
});

async function main(event = {}) {
  try {
    const handler = HANDLERS[event.action];
    if (!handler) throw new OpsError('INVALID_REQUEST', '不支持的操作');
    return { ok: true, data: await handler(event) };
  } catch (error) {
    const known = error instanceof OpsError;
    if (!known) console.error(error);
    return {
      ok: false,
      error: {
        code: known ? error.code : 'TEMPORARY_FAILURE',
        message: known ? error.message : '维护服务暂时不可用'
      }
    };
  }
}

exports.main = main;
exports.ownerKeyForOpenId = ownerKeyForOpenId;
exports.analysisInputHash = analysisInputHash;
exports.analysisJobId = analysisJobId;
