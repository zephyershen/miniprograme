const DEFAULT_MODEL_POINT_RATES = Object.freeze({
  'qwen3.5-flash': Object.freeze({ inputPerMillion: 200, outputPerMillion: 2000 }),
  'qwen3.5-plus': Object.freeze({ inputPerMillion: 800, outputPerMillion: 4800 }),
  'glm-5v-turbo': Object.freeze({ inputPerMillion: 5000, outputPerMillion: 22000 }),
  'kimi-k2.6': Object.freeze({ inputPerMillion: 6500, outputPerMillion: 27000 })
});

function positiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function outputReserveMultiplier(value, fallback = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(8, parsed);
}

function shanghaiMonthKey(timestamp) {
  const shifted = new Date(timestamp + (8 * 60 * 60 * 1000));
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  if (!text) return 0;
  let ascii = 0;
  for (const character of text) {
    if (character.codePointAt(0) <= 0x7f) ascii += 1;
  }
  const nonAscii = text.length - ascii;
  return Math.max(1, Math.ceil((ascii / 4) + (nonAscii * 0.8)));
}

function conservativeInputTokens(value, imageCount = 0) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  const byteUpperBound = typeof Buffer !== 'undefined'
    ? Buffer.byteLength(text, 'utf8')
    : text.length * 3;
  const imageUpperBound = Math.max(0, Math.floor(Number(imageCount) || 0)) * 32768;
  return Math.max(1, estimateTokens(text), byteUpperBound + imageUpperBound);
}

function pointsForUsage(usage = {}, rate = {}) {
  const inputTokens = positiveNumber(usage.inputTokens ?? usage.prompt_tokens);
  const outputTokens = positiveNumber(usage.outputTokens ?? usage.completion_tokens);
  const inputRate = positiveNumber(rate.inputPerMillion);
  const outputRate = positiveNumber(rate.outputPerMillion);
  return Math.max(0, Math.ceil(
    ((inputTokens * inputRate) + (outputTokens * outputRate)) / 1000000
  ));
}

function createMemoryBudgetStore() {
  const points = new Map();
  const overruns = new Set();
  return {
    async tryReserve(monthKey, requestedPoints, limit) {
      if (overruns.has(monthKey)) return false;
      const current = points.get(monthKey) || 0;
      if (current + requestedPoints > limit) return false;
      points.set(monthKey, current + requestedPoints);
      return true;
    },
    async adjust(monthKey, delta) {
      points.set(monthKey, Math.max(0, (points.get(monthKey) || 0) + delta));
    },
    async used(monthKey) {
      return points.get(monthKey) || 0;
    },
    async markOverrun(monthKey) {
      overruns.add(monthKey);
    },
    async isOverrun(monthKey) {
      return overruns.has(monthKey);
    }
  };
}

function createIntelligenceBudgetService(config = {}, options = {}) {
  const store = options.store || createMemoryBudgetStore();
  const now = options.now || (() => Date.now());
  const rates = { ...DEFAULT_MODEL_POINT_RATES, ...(config.modelPointRates || {}) };
  const packagePoints = positiveNumber(config.monthlyPackagePoints, 330000);
  const coreReservePoints = positiveNumber(config.coreReservePoints, 100000);
  const configuredAiLimit = positiveNumber(config.monthlyAiPointLimit, 60000);
  const outputHeadroom = outputReserveMultiplier(config.outputTokenReserveMultiplier);
  const monthlyLimit = Math.max(
    0,
    Math.min(configuredAiLimit, packagePoints - coreReservePoints)
  );
  const overrunMonths = new Set();

  async function reserve({ task, model, input, maxOutputTokens, imageCount = 0 }) {
    const rate = rates[model];
    if (!rate || monthlyLimit <= 0) {
      return { allowed: false, reason: 'budget-disabled' };
    }
    const inputTokens = conservativeInputTokens(input, imageCount);
    const requestedPoints = Math.max(1, pointsForUsage({
      inputTokens,
      // Reasoning-capable providers can include hidden reasoning tokens beyond
      // the visible output limit. Reserve headroom up front, then settle the
      // ledger to measured usage after a successful response.
      outputTokens: positiveNumber(maxOutputTokens) * outputHeadroom
    }, rate));
    const monthKey = shanghaiMonthKey(now());
    if (overrunMonths.has(monthKey)) {
      return { allowed: false, reason: 'overrun-detected', monthKey };
    }
    const allowed = await store.tryReserve(monthKey, requestedPoints, monthlyLimit, {
      task,
      model
    });
    if (!allowed) {
      const overrunDetected = typeof store.isOverrun === 'function'
        ? await store.isOverrun(monthKey)
        : false;
      if (overrunDetected) {
        overrunMonths.add(monthKey);
        return { allowed: false, reason: 'overrun-detected', monthKey };
      }
      return { allowed: false, reason: 'monthly-limit', monthKey };
    }
    return {
      allowed: true,
      monthKey,
      task,
      model,
      requestedPoints,
      inputTokens
    };
  }

  async function commit(reservation, usage = {}) {
    if (!reservation || reservation.allowed !== true) return usage;
    const rate = rates[reservation.model] || {};
    const measured = pointsForUsage(usage, rate);
    let accountedPoints = reservation.requestedPoints;
    let overrunDetected = false;

    if (measured > reservation.requestedPoints) {
      const extraPoints = measured - reservation.requestedPoints;
      const extended = typeof store.tryReserve === 'function' && await store.tryReserve(
        reservation.monthKey,
        extraPoints,
        monthlyLimit,
        { task: reservation.task, model: reservation.model }
      );
      if (extended) {
        accountedPoints = measured;
      } else {
        overrunDetected = true;
        overrunMonths.add(reservation.monthKey);
        if (typeof store.markOverrun === 'function') {
          await store.markOverrun(reservation.monthKey, {
            task: reservation.task,
            model: reservation.model,
            measuredPoints: measured,
            reservedPoints: reservation.requestedPoints
          });
        }
      }
    } else if (measured > 0) {
      accountedPoints = measured;
      await store.adjust(
        reservation.monthKey,
        measured - reservation.requestedPoints,
        { task: reservation.task, model: reservation.model }
      );
    }

    if (measured === 0) {
      // Keep the conservative reservation when the provider omits usage; the
      // request may still have consumed resource points upstream.
      accountedPoints = reservation.requestedPoints;
    }

    return {
      ...usage,
      resourcePointsEstimate: measured > 0 ? measured : reservation.requestedPoints,
      resourcePointsReserved: accountedPoints,
      overrunDetected
    };
  }

  async function release(reservation) {
    if (!reservation || reservation.allowed !== true) return;
    await store.adjust(reservation.monthKey, -reservation.requestedPoints, {
      task: reservation.task,
      model: reservation.model
    });
  }

  async function status() {
    const monthKey = shanghaiMonthKey(now());
    const usedPoints = typeof store.used === 'function' ? await store.used(monthKey) : null;
    const overrunDetected = overrunMonths.has(monthKey) || (
      typeof store.isOverrun === 'function' && await store.isOverrun(monthKey)
    );
    if (overrunDetected) overrunMonths.add(monthKey);
    return {
      monthKey,
      monthlyLimit,
      coreReservePoints,
      usedPoints,
      overrunDetected: Boolean(overrunDetected)
    };
  }

  return Object.freeze({ reserve, commit, release, status, monthlyLimit });
}

module.exports = {
  DEFAULT_MODEL_POINT_RATES,
  shanghaiMonthKey,
  estimateTokens,
  conservativeInputTokens,
  outputReserveMultiplier,
  pointsForUsage,
  createMemoryBudgetStore,
  createIntelligenceBudgetService
};
