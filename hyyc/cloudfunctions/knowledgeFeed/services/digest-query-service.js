const { AppError } = require('../lib/errors');
const { DIGEST_FEATURES, requireFeature } = require('./feed-entitlement-service');
const { assertWindowKey } = require('../repositories/feed-digest');

function publicDigest(document) {
  if (!document) return null;
  return {
    digestId: document._id,
    windowKey: document.windowKey,
    windowStart: document.windowStart || null,
    windowEnd: document.windowEnd || null,
    generatedAt: document.generatedAt || null,
    coverage: document.coverage || { state: 'partial', ratio: 0 },
    executiveSummary: document.executiveSummary || '',
    mustKnow: Array.isArray(document.mustKnow) ? document.mustKnow : [],
    radar: Array.isArray(document.radar) ? document.radar : [],
    followUps: Array.isArray(document.followUps) ? document.followUps : [],
    sourceIndex: Array.isArray(document.sourceIndex) ? document.sourceIndex : []
  };
}

function snapshotFor(document, itemId) {
  return ((document && document.references) || []).find((reference) => reference.itemId === itemId) || null;
}

function createDigestQueryService({ digestRepository, itemFeedQueryService, liveEnabled = true }) {
  async function getDigest(windowKey, entitlement) {
    const key = assertWindowKey(windowKey);
    requireFeature(entitlement, DIGEST_FEATURES[key], '知识简报为 Pro 会员权益');
    if (!liveEnabled) return { status: 'pending', windowKey: key, digest: null };
    const digest = await digestRepository.latest(key);
    return digest
      ? { status: 'ready', digest: publicDigest(digest) }
      : { status: 'pending', windowKey: key, digest: null };
  }

  async function getReference(digestId, itemId, entitlement) {
    if (!liveEnabled) throw new AppError('ITEM_NOT_FOUND', '这条简报引用不存在');
    const digest = await digestRepository.get(digestId);
    if (!digest || digest.status !== 'published') {
      throw new AppError('ITEM_NOT_FOUND', '这条简报引用不存在');
    }
    requireFeature(entitlement, DIGEST_FEATURES[digest.windowKey], '知识简报为 Pro 会员权益');
    const snapshot = snapshotFor(digest, itemId);
    if (!snapshot) throw new AppError('ITEM_NOT_FOUND', '这条简报引用不存在');
    try {
      return { mode: 'live', item: await itemFeedQueryService.getItem(itemId, entitlement) };
    } catch (error) {
      if (!['ITEM_NOT_FOUND', 'ENTITLEMENT_REQUIRED'].includes(error && error.code)) throw error;
      return {
        mode: 'snapshot',
        item: {
          id: snapshot.itemId,
          title: snapshot.title || '',
          summary: snapshot.summary || '',
          source: snapshot.source || '',
          publishedAt: snapshot.publishedAt || null,
          url: snapshot.url || ''
        }
      };
    }
  }

  return { getDigest, getReference };
}

module.exports = { publicDigest, snapshotFor, createDigestQueryService };
