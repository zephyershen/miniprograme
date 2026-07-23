const { randomUUID } = require('node:crypto');
const { COLUMN_LESSONS } = require('../content/column-lessons');
const { TREND_DOSSIERS } = require('../content/trend-dossiers');

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MULTI_PART_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'com.tw', 'co.jp', 'co.kr',
  'co.uk', 'org.uk', 'com.au', 'com.sg'
]);

function shanghaiDateKey(timestamp) {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function shanghaiMidnight(timestamp) {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  return Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()
  ) - SHANGHAI_OFFSET_MS;
}

function weeklyColumnPeriod(timestamp) {
  const today = shanghaiMidnight(timestamp);
  const shanghaiDay = new Date(today + SHANGHAI_OFFSET_MS).getUTCDay();
  const daysSinceMonday = (shanghaiDay + 6) % 7;
  const end = today - (daysSinceMonday * DAY_MS);
  const start = end - (7 * DAY_MS);
  return {
    periodKey: `${shanghaiDateKey(start)}_${shanghaiDateKey(end - DAY_MS)}`,
    windowStart: new Date(start),
    windowEnd: new Date(end)
  };
}

function titleFingerprint(value) {
  return String(value || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 56);
}

function registrableDomain(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const suffix = parts.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(suffix) ? parts.slice(-3).join('.') : suffix;
}

function sourceDomain(item) {
  try {
    return registrableDomain(new URL(item && item.url || '').hostname);
  } catch (error) {
    return String(item && item.source || '').trim().toLowerCase();
  }
}

function selectCandidates(items, config) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.publicState === 'active' && item.qualityTier === 'curated')
    .filter((item) => Number(item.curationScore) >= Number(config.minimumCurationScore))
    .filter((item) => {
      const fingerprint = titleFingerprint(item.title);
      if (!fingerprint || seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .slice(0, Number(config.sourceLimit) || 24);
}

function evidenceIsSufficient(result, candidates, config) {
  if (!result || result.publish === false) return false;
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const selected = (result.sourceItemIds || []).map((id) => byId.get(id)).filter(Boolean);
  if (!selected.length) return false;
  const domains = new Set(selected.map(sourceDomain).filter(Boolean));
  const strongest = Math.max(...selected.map((item) => Number(item.curationScore) || 0));
  return domains.size >= 2 || strongest >= Number(config.singleSourceMinimumScore);
}

function createColumnEditorialService({
  provider,
  repository,
  itemRepository,
  config,
  now = () => Date.now()
}) {
  async function loadCandidates(period) {
    const collected = [];
    const seenIds = new Set();
    let cursor = '';
    const pageLimit = Math.max(3, Number(config.sourceLimit) || 24);
    const maxPages = Math.max(1, Number(config.sourceScanPages) || 3);
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await itemRepository.queryPage({
        since: period.windowStart.toISOString(),
        until: period.windowEnd.toISOString(),
        channel: 'all',
        topicKeys: [],
        qualityTier: 'curated',
        sort: 'importance',
        offset: 0,
        cursor,
        limit: pageLimit,
        includeCount: false
      });
      for (const item of (page.items || [])) {
        if (!item || !item.id || seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        collected.push(item);
      }
      const selected = selectCandidates(collected, config);
      if (selected.length >= pageLimit || !page.hasMore || !page.nextCursor) return selected;
      cursor = page.nextCursor;
    }
    return selectCandidates(collected, config);
  }

  async function run({ force = false } = {}) {
    const currentTimeMs = now();
    const currentTime = new Date(currentTimeMs);
    const period = weeklyColumnPeriod(currentTimeMs);
    const caseId = `column_case_${period.periodKey}`;
    const existing = await repository.getCase(caseId);
    if (existing && existing.status === 'published' && !force) {
      await repository.ensureTrendProjection(existing);
      return { status: 'current', caseId, periodKey: period.periodKey };
    }
    if (existing && existing.status === 'skipped' && !force) {
      return { status: 'insufficient-evidence', caseId, periodKey: period.periodKey };
    }
    if (!provider || provider.enabled !== true || typeof provider.generateColumnCase !== 'function') {
      return { status: 'provider-unavailable', periodKey: period.periodKey };
    }

    const candidates = await loadCandidates(period);
    if (candidates.length < Number(config.minimumCandidates)) {
      return {
        status: 'insufficient-sources',
        periodKey: period.periodKey,
        sourceCount: candidates.length
      };
    }

    const owner = randomUUID();
    const claim = await repository.claimCase({
      _id: caseId,
      periodKey: period.periodKey,
      windowStart: period.windowStart,
      windowEnd: period.windowEnd
    }, {
      force,
      owner,
      currentTime,
      leaseMs: config.generationLeaseMs
    });
    if (!claim.acquired) {
      if (claim.reason === 'published') {
        await repository.ensureTrendProjection(claim.document);
        return { status: 'current', caseId, periodKey: period.periodKey };
      }
      return {
        status: claim.reason === 'skipped' ? 'insufficient-evidence' : 'in-progress',
        caseId,
        periodKey: period.periodKey
      };
    }

    try {
      const context = {
        periodKey: period.periodKey,
        windowStart: period.windowStart.toISOString(),
        windowEnd: period.windowEnd.toISOString(),
        audience: '普通职场人',
        allowedDossierKeys: TREND_DOSSIERS.map((item) => item.key),
        allowedLessonIds: COLUMN_LESSONS.map((item) => item.id),
        evidenceRule: '优先引用两个独立来源；只有极高可信度的一手变化才可引用一个来源。'
      };
      const generated = await provider.generateColumnCase(context, candidates);
      if (!generated || generated.publish === false
        || !evidenceIsSufficient(generated, candidates, config)) {
        await repository.markCaseSkipped(
          caseId,
          owner,
          generated && generated.reason || 'insufficient-evidence',
          currentTime
        );
        return {
          status: 'insufficient-evidence',
          periodKey: period.periodKey,
          sourceCount: candidates.length
        };
      }

      const byId = new Map(candidates.map((item) => [item.id, item]));
      const sourceItemIds = generated.sourceItemIds.filter((itemId) => byId.has(itemId));
      const document = await repository.publishCaseWithTrend({
        _id: caseId,
        periodKey: period.periodKey,
        windowStart: period.windowStart,
        windowEnd: period.windowEnd,
        title: generated.title,
        conclusion: generated.conclusion,
        happened: generated.happened,
        impact: generated.impact,
        tryNow: generated.tryNow,
        noNeedToWorry: generated.noNeedToWorry,
        dossierKey: generated.dossierKey,
        relatedLessonIds: generated.relatedLessonIds,
        sourceItemIds,
        sources: sourceItemIds.map((itemId) => {
          const item = byId.get(itemId);
          return {
            itemId,
            title: item.title || '',
            source: item.source || '',
            publishedAt: item.publishedAt || null
          };
        }),
        publishedAt: currentTime,
        updatedAt: currentTime,
        intelligenceProvider: generated.provider || '',
        model: generated.model || '',
        usage: generated.usage || null
      }, owner);
      return {
        status: 'generated',
        caseId,
        periodKey: period.periodKey,
        sourceCount: sourceItemIds.length,
        dossierKey: document.dossierKey
      };
    } catch (error) {
      await repository.markCaseFailed(
        caseId,
        owner,
        error && (error.code || error.message) || 'COLUMN_GENERATION_FAILED',
        new Date(now())
      ).catch(() => {});
      throw error;
    }
  }

  return { run };
}

module.exports = {
  weeklyColumnPeriod,
  titleFingerprint,
  registrableDomain,
  sourceDomain,
  selectCandidates,
  evidenceIsSufficient,
  createColumnEditorialService
};
