const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');
const {
  createModerationBackfillProxy
} = require('./services/moderation-backfill-proxy');
const {
  createVisualRepairService
} = require('./services/visual-repair-service');
const {
  createSearchBackfillStatusService
} = require('./services/search-backfill-status-service');
const { logUnexpectedError } = require('./services/safe-log');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTIONS = Object.freeze({
  memberships: 'knowledge_memberships',
  access: 'knowledge_feed_access_grants',
  items: 'knowledge_feed_items',
  visualJobs: 'knowledge_feed_visual_jobs',
  cache: 'knowledge_feed_cache',
  analysis: 'knowledge_feed_item_analysis',
  analysisJobs: 'knowledge_feed_analysis_jobs',
  digests: 'knowledge_feed_digests',
  syncState: 'knowledge_feed_sync_state'
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

const visualRepairService = createVisualRepairService({
  db,
  authorize,
  createError: (code, message) => new OpsError(code, message),
  config: {
    provider: 'aihot',
    itemsCollectionName: COLLECTIONS.items,
    jobsCollectionName: COLLECTIONS.visualJobs,
    cacheCollectionName: COLLECTIONS.cache,
    cacheDocumentId: 'aihot_selected',
    previewFileIdPrefix: process.env.KNOWLEDGE_PREVIEW_FILE_ID_PREFIX
      || runtime.knowledgePreviewFileIdPrefix
      || 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-previews/source/',
    listThumbnailFileIdPrefix: process.env.KNOWLEDGE_LIST_THUMBNAIL_FILE_ID_PREFIX
      || runtime.knowledgeListThumbnailFileIdPrefix
      || 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-thumbnails/list/',
    captureVersion: Number(process.env.KNOWLEDGE_PREVIEW_CAPTURE_VERSION
      || runtime.knowledgePreviewCaptureVersion
      || 3),
    captureProfile: 'focus-v1',
    thumbnailVersion: 1,
    priority: 1000000,
    batchDeadlineMs: 45000
  }
});

const moderationBackfillProxy = createModerationBackfillProxy({
  authorize,
  callFunction: (options) => cloud.callFunction(options)
});
const searchBackfillStatusService = createSearchBackfillStatusService({
  db,
  collectionName: COLLECTIONS.syncState,
  documentId: 'aihot_all'
});

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
  const limit = Math.max(1, Math.min(200, Number(event.limit) || 20));
  const windowDays = Math.max(1, Math.min(90, Number(event.windowDays) || 30));
  const offset = Math.max(0, Math.min(12000, Number(event.offset) || 0));
  const cutoff = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000)).toISOString();
  const response = await db.collection(COLLECTIONS.items)
    .where({ publishedAt: db.command.gte(cutoff) })
    .orderBy('publishedAt', 'desc')
    .skip(offset)
    .limit(limit)
    .get();
  const scanned = (response && response.data) || [];
  const items = scanned.filter((item) => item.publicState === 'active');
  const now = new Date();
  const jobs = items.map((item, index) => {
    const inputHash = item.analysisInputHash || analysisInputHash(item);
    return {
      _id: analysisJobId(item.provider || 'aihot', item.id, inputHash, 1),
      provider: item.provider || 'aihot', itemId: item.id,
      expectedInputHash: inputHash, policyVersion: 1, priority: 1000000 - index,
      status: 'pending', attempts: 0, nextAttemptAt: now,
      leaseOwner: '', leaseUntil: null, lastErrorCode: '',
      createdAt: now, updatedAt: now
    };
  });
  const existing = new Map();
  for (let offset = 0; offset < jobs.length; offset += 50) {
    const batch = jobs.slice(offset, offset + 50);
    if (!batch.length) continue;
    const found = await db.collection(COLLECTIONS.analysisJobs)
      .where({ _id: db.command.in(batch.map((job) => job._id)) })
      .field({ _id: true, status: true }).limit(batch.length).get();
    ((found && found.data) || []).forEach((document) => existing.set(document._id, document));
  }
  const inserts = jobs.filter((job) => !existing.has(job._id));
  for (let offset = 0; offset < inserts.length; offset += 50) {
    const batch = inserts.slice(offset, offset + 50);
    if (batch.length) await db.collection(COLLECTIONS.analysisJobs).add({ data: batch });
  }
  const prioritized = jobs.filter((job) => {
    const current = existing.get(job._id);
    return current && ['pending', 'retry'].includes(current.status);
  });
  for (let start = 0; start < prioritized.length; start += 20) {
    await Promise.all(prioritized.slice(start, start + 20).map((job) => (
      db.collection(COLLECTIONS.analysisJobs).doc(job._id).update({
        data: { priority: job.priority, nextAttemptAt: now, updatedAt: now }
      })
    )));
  }
  return {
    scanned: scanned.length,
    eligible: items.length,
    inserted: inserts.length,
    retained: jobs.length - inserts.length,
    prioritized: prioritized.length,
    windowDays,
    nextOffset: offset + scanned.length,
    done: scanned.length < limit
  };
}

async function count(collectionName, where = null) {
  await ensureCollections([collectionName]);
  const query = where ? db.collection(collectionName).where(where) : db.collection(collectionName);
  return Number((await query.count()).total) || 0;
}

async function recentAnalysisCoverage(windowDays = 30, maxItems = 12000) {
  await ensureCollections([COLLECTIONS.items]);
  const cutoff = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000)).toISOString();
  let scanned = 0;
  let total = 0;
  let ready = 0;
  let exhausted = false;
  while (scanned < maxItems) {
    const batchSize = Math.min(1000, maxItems - scanned);
    const response = await db.collection(COLLECTIONS.items)
      .where({ publishedAt: db.command.gte(cutoff) })
      .field({ _id: true, publicState: true, analysisStatus: true })
      .orderBy('publishedAt', 'desc')
      .skip(scanned)
      .limit(batchSize)
      .get();
    const page = (response && response.data) || [];
    for (const item of page) {
      if (item.publicState !== 'active') continue;
      total += 1;
      if (item.analysisStatus === 'ready') ready += 1;
    }
    scanned += page.length;
    if (page.length < batchSize) {
      exhausted = true;
      break;
    }
  }
  return {
    windowDays,
    total,
    ready,
    ratio: total ? Math.round((ready / total) * 10000) / 10000 : 0,
    truncated: !exhausted && scanned >= maxItems
  };
}

async function recentIntelligenceUsage(windowDays = 30, maxItems = 12000) {
  await ensureCollections([COLLECTIONS.analysis]);
  const cutoff = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000));
  let scanned = 0;
  let exhausted = false;
  const totals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUsdTicks: 0,
    scoreCount: 0,
    scoreTotal: 0,
    scoreMax: 0,
    scoreAtLeast60: 0,
    scoreAtLeast65: 0,
    scoreAtLeast70: 0
  };
  while (scanned < maxItems) {
    const batchSize = Math.min(1000, maxItems - scanned);
    const response = await db.collection(COLLECTIONS.analysis)
      .where({ analyzedAt: db.command.gte(cutoff) })
      .field({ _id: true, analyzedAt: true, usage: true, curationScore: true })
      .orderBy('analyzedAt', 'desc')
      .skip(scanned)
      .limit(batchSize)
      .get();
    const page = (response && response.data) || [];
    for (const document of page) {
      const usage = document.usage || {};
      totals.calls += 1;
      for (const key of [
        'inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'costUsdTicks'
      ]) totals[key] += Math.max(0, Number(usage[key]) || 0);
      const score = Number(document.curationScore);
      if (Number.isFinite(score)) {
        totals.scoreCount += 1;
        totals.scoreTotal += score;
        totals.scoreMax = Math.max(totals.scoreMax, score);
        if (score >= 60) totals.scoreAtLeast60 += 1;
        if (score >= 65) totals.scoreAtLeast65 += 1;
        if (score >= 70) totals.scoreAtLeast70 += 1;
      }
    }
    scanned += page.length;
    if (page.length < batchSize) {
      exhausted = true;
      break;
    }
  }
  return {
    windowDays,
    ...totals,
    scoreAverage: totals.scoreCount
      ? Math.round((totals.scoreTotal / totals.scoreCount) * 100) / 100
      : 0,
    truncated: !exhausted && scanned >= maxItems
  };
}

async function status(event) {
  authorize(event.token);
  const [
    items, analyzed, jobs, pendingJobs, retryJobs, leasedJobs,
    blockedJobs, completedJobs, curatedItems, digests, memberships, recent30d,
    intelligenceUsage30d, searchBackfill
  ] = await Promise.all([
    count(COLLECTIONS.items),
    count(COLLECTIONS.analysis, { status: 'ready' }),
    count(COLLECTIONS.analysisJobs),
    count(COLLECTIONS.analysisJobs, { status: 'pending' }),
    count(COLLECTIONS.analysisJobs, { status: 'retry' }),
    count(COLLECTIONS.analysisJobs, { status: 'leased' }),
    count(COLLECTIONS.analysisJobs, { status: 'blocked' }),
    count(COLLECTIONS.analysisJobs, { status: 'completed' }),
    count(COLLECTIONS.items, { publicState: 'active', qualityTier: 'curated' }),
    count(COLLECTIONS.digests, { status: 'published' }),
    count(COLLECTIONS.memberships, { status: db.command.in(['active', 'grace']) }),
    recentAnalysisCoverage(30),
    recentIntelligenceUsage(30),
    searchBackfillStatusService.get()
  ]);
  return {
    items,
    analyzed,
    jobs: {
      total: jobs,
      pending: pendingJobs,
      retry: retryJobs,
      leased: leasedJobs,
      blocked: blockedJobs,
      completed: completedJobs
    },
    recent30d,
    intelligenceUsage30d,
    searchBackfill,
    curatedItems,
    digests,
    memberships
  };
}

async function moderationBackfill(event) {
  try {
    return await moderationBackfillProxy.run(event);
  } catch (error) {
    if (error instanceof OpsError) throw error;
    throw new OpsError(
      /^[A-Z0-9_]{3,80}$/.test(error && error.code || '')
        ? error.code
        : 'MODERATION_BACKFILL_FAILED',
      '存量内容补审暂时未完成，请稍后重试'
    );
  }
}

async function repairVisual(event) {
  authorize(event.token);
  await ensureCollections([COLLECTIONS.visualJobs]);
  return visualRepairService.run(event);
}

const HANDLERS = Object.freeze({
  grantMembership,
  revokeMembership,
  grantAdmin,
  seedAnalysis,
  moderationBackfill,
  repairVisual,
  status
});

async function main(event = {}) {
  try {
    const handler = HANDLERS[event.action];
    if (!handler) throw new OpsError('INVALID_REQUEST', '不支持的操作');
    return { ok: true, data: await handler(event) };
  } catch (error) {
    const known = error instanceof OpsError;
    if (!known) logUnexpectedError('Knowledge operations request failed', error);
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
