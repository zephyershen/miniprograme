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
  async function processJob(job, owner) {
    const item = await itemRepository.getByItemId(job.itemId);
    if (!item || item.publicState !== 'active'
      || analysisInputHash(item) !== job.expectedInputHash) {
      await jobRepository.complete(job._id, owner, new Date(now()));
      return { status: 'stale', itemId: job.itemId };
    }
    try {
      const raw = await provider.analyzeItem(analysisInput(item));
      const evaluated = evaluateAnalysis(raw, job.policyVersion);
      const applied = await analysisRepository.publish(item, {
        ...evaluated,
        inputHash: job.expectedInputHash,
        model: raw && raw.model || provider.name || ''
      }, new Date(now()));
      await jobRepository.complete(job._id, owner, new Date(now()));
      return { status: applied.applied ? 'ready' : 'stale', itemId: job.itemId };
    } catch (error) {
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
  }

  async function run({ maxJobs = config.jobsPerCycle } = {}) {
    if (!provider || provider.enabled !== true) {
      return { status: 'disabled', attempted: 0, results: [] };
    }
    const due = await jobRepository.listDue(new Date(now()), maxJobs);
    const results = [];
    for (const candidate of due) {
      const owner = createOwner();
      const claim = await jobRepository.claim(candidate._id, owner, new Date(now()));
      if (claim.acquired) results.push(await processJob(claim.job, owner));
    }
    return { status: 'ready', attempted: results.length, results };
  }

  return { run, processJob };
}

module.exports = { intelligenceErrorCode, retryDelay, createFeedAnalysisWorkerService };
