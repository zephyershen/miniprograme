const { AppError } = require('../lib/errors');
const { requireFeature } = require('./feed-entitlement-service');

function publicProgress(document) {
  if (!document) return null;
  const posterIndex = Number(document.lastPosterIndex);
  return {
    entryId: document.entryId,
    entryType: document.entryType,
    progressPercent: Math.min(100, Math.max(0, Math.floor(Number(document.progressPercent) || 0))),
    lastPosterIndex: Number.isFinite(posterIndex) ? Math.max(0, Math.floor(posterIndex)) : 0,
    publishedRevision: Math.max(0, Math.floor(Number(document.publishedRevision) || 0)),
    completed: Boolean(document.completedAt) || Number(document.progressPercent) >= 100,
    lastReadAt: document.lastReadAt || null,
    completedAt: document.completedAt || null
  };
}

function normalizeMutationId(value) {
  const mutationId = String(value || '').trim();
  if (!/^[a-z0-9_-]{8,128}$/i.test(mutationId)) {
    throw new AppError('INVALID_REQUEST', '阅读进度请求已失效，请重新打开后再试');
  }
  return mutationId;
}

function normalizeProgressInput(input) {
  const entryType = input && input.entryType;
  const entryId = String(input && input.entryId || '').trim();
  if (!['lesson', 'practical'].includes(entryType)
    || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(entryId)) {
    throw new AppError('ITEM_NOT_FOUND', '这节内容不存在');
  }
  const posterIndex = Number(input.lastPosterIndex);
  return {
    entryType,
    entryId,
    progressPercent: Math.min(
      100,
      Math.max(5, Math.floor(Number(input.progressPercent) || 5))
    ),
    lastPosterIndex: Number.isFinite(posterIndex) ? Math.max(0, Math.floor(posterIndex)) : 0,
    mutationId: normalizeMutationId(input.mutationId)
  };
}

function createColumnProgressService({
  repository,
  catalogService,
  now = () => Date.now()
}) {
  async function list(actor, entitlement) {
    requireFeature(entitlement, 'ai_column', '阅读进度需要 Pro 会员');
    const rows = await repository.list(actor.ownerKey);
    return {
      items: rows.map(publicProgress).filter(Boolean)
    };
  }

  async function save(input, actor, entitlement) {
    requireFeature(entitlement, 'ai_column', '阅读进度需要 Pro 会员');
    const value = normalizeProgressInput(input);
    const kind = value.entryType === 'lesson' ? 'course' : 'practical';
    const published = await catalogService.publishedEntry(value.entryId, kind);
    if (!published) throw new AppError('ITEM_NOT_FOUND', '这节内容不存在');
    const document = await repository.save(actor.ownerKey, {
      ...value,
      publishedRevision: Math.max(0, Math.floor(Number(published.revision) || 0))
    }, new Date(now()).toISOString());
    return { item: publicProgress(document) };
  }

  return {
    list,
    save
  };
}

module.exports = {
  publicProgress,
  normalizeMutationId,
  normalizeProgressInput,
  createColumnProgressService
};
