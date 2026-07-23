const { randomUUID } = require('node:crypto');
const { analysisInput, analysisInputHash, evaluateAnalysis } = require('../policies/feed-curation');

function intelligenceErrorCode(error) {
  if (error && /^[A-Z0-9_]{3,80}$/.test(error.code || '')) return error.code;
  if (error && error.status === 429) return 'INTELLIGENCE_RATE_LIMITED';
  return 'INTELLIGENCE_FAILURE';
}

function retryDelay(attempts) {
  return Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** Math.max(0, attempts - 1)));
}

function workerDue(currentTime, intervalMinutes) {
  const interval = Math.max(1, Number(intervalMinutes) || 1);
  return Math.floor(currentTime / (60 * 1000)) % interval === 0;
}

function shanghaiDayStart(currentTime) {
  const shifted = new Date(currentTime + (8 * 60 * 60 * 1000));
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ) - (8 * 60 * 60 * 1000));
}

function createFeedAnalysisWorkerService({
  provider,
  jobRepository,
  itemRepository,
  analysisRepository,
  config,
  now = () => Date.now(),
  createOwner = randomUUID,
  logger = console
}) {
  async function retryClaim(claim, error) {
    const { job, owner } = claim;
    const attempts = Math.max(0, Number(job.attempts) || 0) + 1;
    const blocked = attempts >= config.maxAttempts;
    await jobRepository.retry(
      job._id,
      owner,
      intelligenceErrorCode(error),
      new Date(now() + retryDelay(attempts)),
      attempts,
      blocked
    );
    logger.warn('Knowledge intelligence analysis failed', {
      itemId: job.itemId,
      code: intelligenceErrorCode(error)
    });
    return { status: blocked ? 'blocked' : 'retry', itemId: job.itemId };
  }

  async function publishClaim(claim, item, raw) {
    const { job, owner } = claim;
    try {
      const evaluated = evaluateAnalysis(raw, job.policyVersion);
      const applied = await analysisRepository.publish(item, {
        ...evaluated,
        inputHash: job.expectedInputHash,
        intelligenceProvider: raw && raw.provider || provider.name || '',
        model: raw && raw.model || provider.model || provider.name || '',
        usage: raw && raw.usage || null
      }, new Date(now()));
      await jobRepository.complete(job._id, owner, new Date(now()));
      return { status: applied.applied ? 'ready' : 'stale', itemId: job.itemId };
    } catch (error) {
      return retryClaim(claim, error);
    }
  }

  async function processBatch(claims) {
    const results = [];
    const valid = [];
    for (const claim of claims) {
      try {
        const item = await itemRepository.getByItemId(claim.job.itemId);
        if (!item || item.publicState !== 'active'
          || analysisInputHash(item) !== claim.job.expectedInputHash) {
          await jobRepository.complete(claim.job._id, claim.owner, new Date(now()));
          results.push({ status: 'stale', itemId: claim.job.itemId });
        } else {
          valid.push({ ...claim, item });
        }
      } catch (error) {
        results.push(await retryClaim(claim, error));
      }
    }
    if (!valid.length) return results;

    let analyses;
    try {
      if (valid.length > 1 && typeof provider.analyzeItems === 'function') {
        analyses = await provider.analyzeItems(valid.map(({ job, item }) => ({
          itemId: job.itemId,
          ...analysisInput(item)
        })));
      } else {
        analyses = [];
        for (const entry of valid) {
          analyses.push({
            itemId: entry.job.itemId,
            ...await provider.analyzeItem(analysisInput(entry.item))
          });
        }
      }
      if (!Array.isArray(analyses) || analyses.length !== valid.length) {
        const error = new Error('INTELLIGENCE_BATCH_INVALID');
        error.code = 'INTELLIGENCE_BATCH_INVALID';
        throw error;
      }
    } catch (error) {
      for (const entry of valid) results.push(await retryClaim(entry, error));
      return results;
    }

    const byItemId = new Map(analyses.map((analysis) => [analysis.itemId, analysis]));
    for (const entry of valid) {
      const raw = byItemId.get(entry.job.itemId);
      if (!raw) {
        const error = new Error('INTELLIGENCE_BATCH_INVALID');
        error.code = 'INTELLIGENCE_BATCH_INVALID';
        results.push(await retryClaim(entry, error));
      } else {
        results.push(await publishClaim(entry, entry.item, raw));
      }
    }
    return results;
  }

  async function processJob(job, owner) {
    const results = await processBatch([{ job, owner }]);
    return results[0];
  }

  async function run({ maxJobs = config.jobsPerCycle, force = false } = {}) {
    if (!provider || provider.enabled !== true) {
      return { status: 'disabled', attempted: 0, results: [] };
    }
    if (!force && !workerDue(now(), config.workerIntervalMinutes)) {
      return { status: 'idle', attempted: 0, results: [] };
    }
    const dailyLimit = Math.max(1, Number(config.maxAnalysisJobsPerDay) || 1);
    const usedToday = typeof analysisRepository.countSince === 'function'
      ? await analysisRepository.countSince(shanghaiDayStart(now()))
      : 0;
    if (!force && usedToday >= dailyLimit) {
      return { status: 'daily-cap', attempted: 0, results: [], usedToday, dailyLimit };
    }
    const allowedJobs = force ? maxJobs : Math.min(maxJobs, dailyLimit - usedToday);
    const due = await jobRepository.listDue(new Date(now()), allowedJobs);
    const claims = [];
    for (const candidate of due) {
      const owner = createOwner();
      const claim = await jobRepository.claim(candidate._id, owner, new Date(now()));
      if (claim.acquired) claims.push({ job: claim.job, owner });
    }
    const results = [];
    for (let offset = 0; offset < claims.length; offset += 5) {
      results.push(...await processBatch(claims.slice(offset, offset + 5)));
    }
    return { status: 'ready', attempted: results.length, results, usedToday, dailyLimit };
  }

  return { run, processJob, processBatch };
}

module.exports = {
  intelligenceErrorCode,
  retryDelay,
  workerDue,
  shanghaiDayStart,
  createFeedAnalysisWorkerService
};
