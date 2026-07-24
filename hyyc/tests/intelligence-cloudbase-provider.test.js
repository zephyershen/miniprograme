const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ANALYSIS_SCHEMA,
  COLUMN_CASE_SCHEMA,
  assertSchema
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-contracts');

test('validates a source-bound weekly column case through the managed provider', async () => {
  let request = null;
  const provider = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async (value) => {
      request = value;
      return {
        text: JSON.stringify({
          publish: true,
          reason: '',
          title: '本周变化',
          conclusion: '先在低风险任务中验证。',
          happened: '两个独立来源记录了同一方向的变化。',
          impact: '普通职场人可以减少重复整理。',
          tryNow: ['选择一个可复核的小任务。'],
          noNeedToWorry: '旧方法不会立刻失效。',
          dossierKey: 'search-research',
          relatedLessonIds: ['research'],
          sourceItemIds: ['a', 'b']
        }),
        usage: { prompt_tokens: 100, completion_tokens: 80 }
      };
    }),
    budgetService: budgetService(),
    digestTimeoutMs: 180000
  });
  const result = await provider.generateColumnCase({
    allowedDossierKeys: ['search-research'],
    allowedLessonIds: ['research']
  }, [
    { id: 'a', title: '来源 A', source: '一', curationScore: 90 },
    { id: 'b', title: '来源 B', source: '二', curationScore: 88 }
  ]);
  assert.equal(result.provider, 'cloudbase');
  assert.deepEqual(result.sourceItemIds, ['a', 'b']);
  assert.equal(request.input.model, 'qwen3.5-plus');
  assert.equal(request.options.timeout, 180000);
  assert.deepEqual(
    new Set(COLUMN_CASE_SCHEMA.required),
    new Set(Object.keys(COLUMN_CASE_SCHEMA.properties))
  );
});

test('lets the managed provider explicitly abstain when evidence is insufficient', async () => {
  const provider = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async () => ({
      text: JSON.stringify({
        publish: false,
        reason: '来源不足，无法形成可靠判断',
        title: '',
        conclusion: '',
        happened: '',
        impact: '',
        tryNow: [],
        noNeedToWorry: '',
        dossierKey: '',
        relatedLessonIds: [],
        sourceItemIds: []
      }),
      usage: { prompt_tokens: 30, completion_tokens: 12 }
    })),
    budgetService: budgetService()
  });
  const result = await provider.generateColumnCase({
    allowedDossierKeys: ['search-research'],
    allowedLessonIds: ['research']
  }, [{ id: 'a', title: '来源 A', source: '一', curationScore: 80 }]);
  assert.equal(result.publish, false);
  assert.match(result.reason, /来源不足/);
});
const {
  createCloudbaseIntelligenceProvider,
  normalizeCloudbaseError
} = require('../cloudfunctions/knowledgeFeed/adapters/cloudbase-intelligence-provider');
const {
  createResilientIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/resilient-intelligence-provider');
const {
  createManagedAiClient,
  createIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-provider');
const {
  createMemoryBudgetStore,
  createIntelligenceBudgetService,
  pointsForUsage,
  shanghaiMonthKey
} = require('../cloudfunctions/knowledgeFeed/services/intelligence-budget-service');
const {
  documentNotFound,
  collectionAlreadyExists,
  createCloudbaseIntelligenceBudgetStore
} = require('../cloudfunctions/knowledgeFeed/adapters/cloudbase-intelligence-budget-store');
const {
  createCommentModerationService
} = require('../cloudfunctions/knowledgeFeed/services/comment-moderation-service');
const {
  INTELLIGENCE_CONFIG
} = require('../cloudfunctions/knowledgeFeed/config');

test('keeps a larger AI budget while preserving the core resource reserve', async () => {
  const service = createIntelligenceBudgetService({}, {
    store: createMemoryBudgetStore(),
    now: () => Date.parse('2026-07-21T00:00:00.000Z')
  });
  assert.equal(service.monthlyLimit, 60000);
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseMonthlyAiPointLimit, 60000);
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseCoreReservePoints, 100000);
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseTimeoutMs, 180000);
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseAnalysisTimeoutMs, 90000);
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseDigestTimeoutMs, 180000);
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseModerationTimeoutMs, 30000);
});

function validAnalysis(overrides = {}) {
  return {
    signals: {
      importance: 90,
      novelty: 80,
      sourceTrust: 85,
      evidence: 75,
      actionability: 70,
      duplicatePenalty: 0
    },
    noise: false,
    duplicate: false,
    shortReason: '一手来源的重要产品更新',
    reasonCodes: ['first-party'],
    companyKeys: [],
    directionKeys: [],
    ...overrides
  };
}

function budgetService(overrides = {}) {
  return createIntelligenceBudgetService({
    monthlyPackagePoints: 330000,
    coreReservePoints: 100000,
    monthlyAiPointLimit: 20000,
    ...overrides
  }, {
    store: createMemoryBudgetStore(),
    now: () => Date.parse('2026-07-20T00:00:00.000Z')
  });
}

function fakeAi(handler) {
  return {
    createModel: (group) => ({
      generateText: (input, options) => handler({ group, input, options })
    })
  };
}

function fakeBudgetDatabase() {
  let collectionCreated = false;
  const documents = new Map();
  const command = {
    inc: (value) => ({ operation: 'inc', value }),
    lte: (value) => ({ operation: 'lte', value }),
    neq: (value) => ({ operation: 'neq', value })
  };
  function apply(document, data) {
    const next = { ...document };
    for (const [key, value] of Object.entries(data)) {
      next[key] = value && value.operation === 'inc'
        ? (Number(next[key]) || 0) + value.value
        : value;
    }
    return next;
  }
  return {
    command,
    createCollection: async () => { collectionCreated = true; },
    collection: () => ({
      doc: (id) => ({
        get: async () => {
          if (!collectionCreated || !documents.has(id)) throw new Error('not found');
          return { data: documents.get(id) };
        },
        update: async ({ data }) => {
          documents.set(id, apply(documents.get(id), data));
          return { stats: { updated: 1 } };
        }
      }),
      add: async ({ data }) => {
        documents.set(data._id, data);
        return { id: data._id };
      },
      where: (criteria) => ({
        update: async ({ data }) => {
          const current = documents.get(criteria._id);
          const overrunBlocked = criteria.overrunDetected
            && criteria.overrunDetected.operation === 'neq'
            && current && current.overrunDetected === criteria.overrunDetected.value;
          if (!current || overrunBlocked
            || current.reservedPoints > criteria.reservedPoints.value) {
            return { stats: { updated: 0 } };
          }
          documents.set(criteria._id, apply(current, data));
          return { stats: { updated: 1 } };
        }
      })
    }),
    documents
  };
}

test('recognizes CloudBase database codes even when the message is generic', () => {
  assert.equal(documentNotFound({ errCode: -502005, message: 'database request failed' }), true);
  assert.equal(collectionAlreadyExists({
    errCode: -502001,
    message: 'database request failed'
  }), true);
});

test('initializes the managed Node client with a production AI timeout', () => {
  const currentEnvironment = Symbol('current-environment');
  const ai = fakeAi(async () => ({ text: '{}', usage: {} }));
  let initialized;
  const client = createManagedAiClient({ cloudbaseTimeoutMs: 60000 }, {
    cloudbaseSdk: {
      SYMBOL_CURRENT_ENV: currentEnvironment,
      init: (config) => {
        initialized = config;
        return { ai: () => ai };
      }
    }
  });
  assert.equal(client, ai);
  assert.deepEqual(initialized, { env: currentEnvironment, timeout: 60000 });
});

test('strict schema validation rejects missing, mistyped and extra output fields', () => {
  assert.doesNotThrow(() => assertSchema(validAnalysis(), ANALYSIS_SCHEMA));
  assert.throws(
    () => assertSchema(validAnalysis({ noise: 'false' }), ANALYSIS_SCHEMA),
    (error) => error.code === 'INTELLIGENCE_OUTPUT_SCHEMA_INVALID' && error.path === '$.noise'
  );
  assert.throws(
    () => assertSchema({ ...validAnalysis(), invented: true }, ANALYSIS_SCHEMA),
    (error) => error.code === 'INTELLIGENCE_OUTPUT_SCHEMA_INVALID'
  );
  const missing = validAnalysis();
  delete missing.shortReason;
  assert.throws(
    () => assertSchema(missing, ANALYSIS_SCHEMA),
    (error) => error.code === 'INTELLIGENCE_OUTPUT_SCHEMA_INVALID'
  );
});

test('keeps a persistent-style monthly AI allowance below the core resource reserve', async () => {
  const store = createMemoryBudgetStore();
  const service = createIntelligenceBudgetService({
    monthlyPackagePoints: 12,
    coreReservePoints: 10,
    monthlyAiPointLimit: 20,
    modelPointRates: { test: { inputPerMillion: 0, outputPerMillion: 1 } }
  }, {
    store,
    now: () => Date.parse('2026-07-31T16:00:00.000Z')
  });
  assert.equal(service.monthlyLimit, 2);
  const first = await service.reserve({ task: 'analysis', model: 'test', input: 'a', maxOutputTokens: 1 });
  const second = await service.reserve({ task: 'digest', model: 'test', input: 'b', maxOutputTokens: 1 });
  const third = await service.reserve({ task: 'analysis', model: 'test', input: 'c', maxOutputTokens: 1 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.deepEqual(third, { allowed: false, reason: 'monthly-limit', monthKey: '202608' });
  await service.release(first);
  assert.equal((await service.reserve({ task: 'analysis', model: 'test', input: 'd', maxOutputTokens: 1 })).allowed, true);
  assert.equal(shanghaiMonthKey(Date.parse('2026-07-31T16:00:00.000Z')), '202608');
  assert.equal(pointsForUsage(
    { inputTokens: 1000000, outputTokens: 1000000 },
    { inputPerMillion: 200, outputPerMillion: 2000 }
  ), 2200);
});

test('persists an overrun fuse without growing the ledger past its hard limit', async () => {
  const database = fakeBudgetDatabase();
  const config = {
    monthlyPackagePoints: 2,
    coreReservePoints: 1,
    monthlyAiPointLimit: 1,
    outputTokenReserveMultiplier: 1,
    modelPointRates: { test: { inputPerMillion: 0, outputPerMillion: 1000000 } }
  };
  const service = createIntelligenceBudgetService(config, {
    store: createCloudbaseIntelligenceBudgetStore(database, { collectionName: 'budget' }),
    now: () => Date.parse('2026-07-20T00:00:00.000Z')
  });
  const reservation = await service.reserve({
    task: 'analysis', model: 'test', input: 'a', maxOutputTokens: 1
  });
  assert.equal(reservation.allowed, true);
  const usage = await service.commit(reservation, { outputTokens: 5 });
  assert.equal(usage.resourcePointsEstimate, 5);
  assert.equal(usage.resourcePointsReserved, 1);
  assert.equal(usage.overrunDetected, true);
  assert.deepEqual(await service.status(), {
    monthKey: '202607', monthlyLimit: 1, coreReservePoints: 1,
    usedPoints: 1, overrunDetected: true
  });
  assert.equal(database.documents.get('202607').overrunDetected, true);
  const freshService = createIntelligenceBudgetService(config, {
    store: createCloudbaseIntelligenceBudgetStore(database, { collectionName: 'budget' }),
    now: () => Date.parse('2026-07-20T00:00:00.000Z')
  });
  assert.deepEqual(
    await freshService.reserve({ task: 'analysis', model: 'test', input: 'b', maxOutputTokens: 1 }),
    { allowed: false, reason: 'overrun-detected', monthKey: '202607' }
  );
});

test('persists reservations atomically in a CloudBase budget document', async () => {
  const database = fakeBudgetDatabase();
  const store = createCloudbaseIntelligenceBudgetStore(database, {
    collectionName: 'budget'
  });
  assert.equal(await store.tryReserve('202607', 2, 3, { task: 'analysis', model: 'test' }), true);
  assert.equal(await store.tryReserve('202607', 2, 3, { task: 'analysis', model: 'test' }), false);
  await store.adjust('202607', -1);
  assert.equal(await store.tryReserve('202607', 2, 3), true);
  assert.equal(await store.used('202607'), 3);
  await store.markOverrun('202607', {
    task: 'digest', model: 'test', measuredPoints: 5, reservedPoints: 2
  });
  assert.equal(await store.isOverrun('202607'), true);
  assert.equal(database.documents.get('202607').overrunDetected, true);
  assert.equal(await store.tryReserve('202607', 0, 3), false);
});

test('settles a normal output estimate miss without opening the monthly fuse', async () => {
  const database = fakeBudgetDatabase();
  const config = {
    monthlyPackagePoints: 30,
    coreReservePoints: 10,
    monthlyAiPointLimit: 20,
    outputTokenReserveMultiplier: 1,
    modelPointRates: { test: { inputPerMillion: 0, outputPerMillion: 1000000 } }
  };
  const service = createIntelligenceBudgetService(config, {
    store: createCloudbaseIntelligenceBudgetStore(database, { collectionName: 'budget' }),
    now: () => Date.parse('2026-07-20T00:00:00.000Z')
  });
  const reservation = await service.reserve({
    task: 'analysis', model: 'test', input: 'a', maxOutputTokens: 9
  });
  assert.equal(reservation.requestedPoints, 9);
  const usage = await service.commit(reservation, { outputTokens: 12 });
  assert.equal(usage.resourcePointsReserved, 12);
  assert.equal(usage.overrunDetected, false);
  assert.equal(database.documents.get('202607').reservedPoints, 12);
  assert.equal(database.documents.get('202607').overrunDetected, false);
  assert.deepEqual(await service.status(), {
    monthKey: '202607', monthlyLimit: 20, coreReservePoints: 10,
    usedPoints: 12, overrunDetected: false
  });
  const freshService = createIntelligenceBudgetService(config, {
    store: createCloudbaseIntelligenceBudgetStore(database, { collectionName: 'budget' }),
    now: () => Date.parse('2026-07-20T00:00:00.000Z')
  });
  assert.equal((await freshService.reserve({
    task: 'analysis', model: 'test', input: 'b', maxOutputTokens: 1
  })).allowed, true);
});

test('uses two-times output headroom and settles only when usage is known', async () => {
  const store = createMemoryBudgetStore();
  const service = createIntelligenceBudgetService({
    monthlyPackagePoints: 30,
    coreReservePoints: 10,
    monthlyAiPointLimit: 20,
    modelPointRates: { test: { inputPerMillion: 0, outputPerMillion: 1000000 } }
  }, { store, now: () => Date.parse('2026-07-20T00:00:00.000Z') });
  const measured = await service.reserve({
    task: 'analysis', model: 'test', input: 'a', maxOutputTokens: 3
  });
  assert.equal(measured.requestedPoints, 6);
  assert.equal((await service.commit(measured, { outputTokens: 4 })).resourcePointsReserved, 4);
  const unknown = await service.reserve({
    task: 'digest', model: 'test', input: 'b', maxOutputTokens: 2
  });
  assert.equal(unknown.requestedPoints, 4);
  assert.equal((await service.commit(unknown, {})).resourcePointsReserved, 4);
  assert.equal((await service.status()).usedPoints, 8);
});

test('allows measured settlement exactly at the monthly limit and blocks the next call', async () => {
  const store = createMemoryBudgetStore();
  const service = createIntelligenceBudgetService({
    monthlyPackagePoints: 30,
    coreReservePoints: 10,
    monthlyAiPointLimit: 20,
    outputTokenReserveMultiplier: 1,
    modelPointRates: { test: { inputPerMillion: 0, outputPerMillion: 1000000 } }
  }, { store, now: () => Date.parse('2026-07-20T00:00:00.000Z') });
  const reservation = await service.reserve({
    task: 'analysis', model: 'test', input: 'a', maxOutputTokens: 18
  });
  const usage = await service.commit(reservation, { outputTokens: 20 });
  assert.equal(usage.resourcePointsReserved, 20);
  assert.equal(usage.overrunDetected, false);
  assert.deepEqual(await service.reserve({
    task: 'analysis', model: 'test', input: 'b', maxOutputTokens: 1
  }), { allowed: false, reason: 'monthly-limit', monthKey: '202607' });
});

test('uses CloudBase managed models by task and records measured resource usage', async () => {
  const requests = [];
  const timeoutDelays = [];
  const provider = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async (request) => {
      requests.push(request);
      const isModeration = request.input.model === 'qwen3.5-plus';
      return {
        text: JSON.stringify(isModeration
          ? { verdict: 'allow', confidence: 0.99, categories: [], reason: '正常内容' }
          : validAnalysis()),
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }
      };
    }),
    budgetService: budgetService(),
    analysisModel: 'qwen3.5-flash',
    moderationImageModel: 'qwen3.5-plus',
    analysisTimeoutMs: 90000,
    moderationTimeoutMs: 10000,
    setTimeoutImpl: (callback, timeoutMs) => {
      timeoutDelays.push(timeoutMs);
      return { callback };
    },
    clearTimeoutImpl: () => {}
  });

  const analysis = await provider.analyzeItem({ id: 'item-1', title: '更新' });
  const moderation = await provider.moderateComment({
    content: '图片说明',
    imageUrls: ['https://example.test/image.jpg']
  });
  const profileModeration = await provider.moderateProfile({
    nickname: '小明',
    avatarUrl: 'https://example.test/avatar.jpg'
  });

  assert.equal(requests[0].group, 'cloudbase');
  assert.equal(requests[0].input.model, 'qwen3.5-flash');
  assert.equal(requests[0].input.enable_thinking, undefined);
  assert.equal(requests[0].options.timeout, 90000);
  assert.equal(requests[1].input.model, 'qwen3.5-plus');
  assert.equal(requests[1].input.enable_thinking, false);
  assert.equal(requests[1].options.timeout, 10000);
  assert.equal(requests[2].input.model, 'qwen3.5-plus');
  assert.equal(requests[2].input.enable_thinking, false);
  assert.equal(requests[2].options.timeout, 10000);
  assert.deepEqual(timeoutDelays, [90000, 10000, 10000]);
  assert.equal(requests[1].input.messages[1].content[1].type, 'image_url');
  assert.equal(requests[1].input.messages[1].content[1].image_url.url, 'https://example.test/image.jpg');
  assert.equal(requests[2].input.messages[1].content[1].image_url.url, 'https://example.test/avatar.jpg');
  assert.equal(analysis.provider, 'cloudbase');
  assert.ok(analysis.usage.resourcePointsEstimate >= 1);
  assert.equal(moderation.verdict, 'allow');
  assert.equal(profileModeration.verdict, 'allow');
});

test('keeps the legacy CloudBase timeout for moderation when no task override is supplied', async () => {
  const requests = [];
  const timeoutDelays = [];
  const provider = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async (request) => {
      requests.push(request);
      return {
        text: JSON.stringify({
          verdict: 'allow', confidence: 0.99, categories: [], reason: 'normal'
        }),
        usage: {}
      };
    }),
    budgetService: budgetService(),
    timeoutMs: 1234,
    setTimeoutImpl: (callback, timeoutMs) => {
      timeoutDelays.push(timeoutMs);
      return { callback };
    },
    clearTimeoutImpl: () => {}
  });

  await provider.moderateComment({ content: 'normal' });
  assert.equal(requests[0].options.timeout, 1234);
  assert.deepEqual(timeoutDelays, [1234]);
});

test('falls back to Packy on strict output failure and opens a short primary circuit', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async () => {
      primaryCalls += 1;
      return { text: JSON.stringify({ noise: false }), usage: {} };
    }),
    budgetService: budgetService()
  });
  const fallback = {
    name: 'packy-test',
    model: 'grok-test',
    enabled: true,
    analyzeItem: async () => {
      fallbackCalls += 1;
      return { ...validAnalysis(), provider: 'packy', model: 'grok-test' };
    }
  };
  const provider = createResilientIntelligenceProvider({
    primary,
    fallback,
    failureThreshold: 1,
    cooldownMs: 60000,
    now: () => 1000,
    logger: { warn: () => {} }
  });

  assert.equal((await provider.analyzeItem({ id: 'one' })).provider, 'packy');
  assert.equal((await provider.analyzeItem({ id: 'two' })).provider, 'packy');
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
});

test('normalizes CloudBase throttling, server failure and timeout for automatic fallback', () => {
  assert.deepEqual(
    { code: normalizeCloudbaseError({ status: 429 }).code, status: normalizeCloudbaseError({ status: 429 }).status },
    { code: 'INTELLIGENCE_RATE_LIMITED', status: 429 }
  );
  assert.deepEqual(
    { code: normalizeCloudbaseError({ statusCode: 503 }).code, status: normalizeCloudbaseError({ statusCode: 503 }).status },
    { code: 'INTELLIGENCE_UPSTREAM_FAILURE', status: 503 }
  );
  assert.equal(
    normalizeCloudbaseError({ code: 'ETIMEDOUT', message: 'timed out' }).code,
    'INTELLIGENCE_TIMEOUT'
  );
});

test('routes to Packy when the CloudBase allowance is exhausted', async () => {
  let cloudbaseCalls = 0;
  const store = createMemoryBudgetStore();
  const limitedBudget = createIntelligenceBudgetService({
    monthlyPackagePoints: 101,
    coreReservePoints: 100,
    monthlyAiPointLimit: 10
  }, { store, now: () => Date.parse('2026-07-20T00:00:00.000Z') });
  const primary = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async () => {
      cloudbaseCalls += 1;
      return { text: JSON.stringify(validAnalysis()), usage: {} };
    }),
    budgetService: limitedBudget,
    analysisMaxOutputTokens: 1
  });
  const fallback = {
    name: 'packy-test', model: 'grok-test', enabled: true,
    analyzeItem: async () => ({ ...validAnalysis(), provider: 'packy', model: 'grok-test' })
  };
  const provider = createResilientIntelligenceProvider({
    primary, fallback, logger: { warn: () => {} }
  });
  assert.equal((await provider.analyzeItem({ id: 'one' })).provider, 'cloudbase');
  assert.equal((await provider.analyzeItem({ id: 'two' })).provider, 'packy');
  assert.equal(cloudbaseCalls, 1);
});

test('routes every later request to Packy after measured CloudBase usage overruns its reservation', async () => {
  let cloudbaseCalls = 0;
  let fallbackCalls = 0;
  const store = createMemoryBudgetStore();
  const guardedBudget = createIntelligenceBudgetService({
    monthlyPackagePoints: 3,
    coreReservePoints: 1,
    monthlyAiPointLimit: 2,
    outputTokenReserveMultiplier: 1,
    modelPointRates: { test: { inputPerMillion: 0, outputPerMillion: 1000000 } }
  }, { store, now: () => Date.parse('2026-07-20T00:00:00.000Z') });
  const primary = createCloudbaseIntelligenceProvider({
    ai: fakeAi(async () => {
      cloudbaseCalls += 1;
      return {
        text: JSON.stringify(validAnalysis()),
        usage: { completion_tokens: 5 }
      };
    }),
    budgetService: guardedBudget,
    analysisModel: 'test',
    analysisMaxOutputTokens: 1
  });
  const fallback = {
    name: 'packy-test', model: 'grok-test', enabled: true,
    analyzeItem: async () => {
      fallbackCalls += 1;
      return { ...validAnalysis(), provider: 'packy', model: 'grok-test' };
    }
  };
  const provider = createResilientIntelligenceProvider({
    primary, fallback, failureThreshold: 10, logger: { warn: () => {} }
  });

  assert.equal((await provider.analyzeItem({ id: 'one' })).provider, 'cloudbase');
  assert.equal((await provider.analyzeItem({ id: 'two' })).provider, 'packy');
  assert.equal((await provider.analyzeItem({ id: 'three' })).provider, 'packy');
  assert.equal(cloudbaseCalls, 1);
  assert.equal(fallbackCalls, 2);
  assert.equal((await guardedBudget.status()).usedPoints, 1);
  assert.equal((await guardedBudget.status()).overrunDetected, true);
});

test('wires CloudBase as primary without requiring any model secret', async () => {
  const timeoutDelays = [];
  const provider = createIntelligenceProvider({
    providerEnabled: true,
    cloudbaseEnabled: true,
    cloudbaseModelGroup: 'cloudbase',
    cloudbaseAnalysisModel: 'qwen3.5-flash',
    cloudbaseDigestModel: 'qwen3.5-plus',
    cloudbaseModerationTextModel: 'qwen3.5-flash',
    cloudbaseModerationImageModel: 'qwen3.5-plus',
    cloudbaseTimeoutMs: 1000,
    cloudbaseAnalysisTimeoutMs: 800,
    cloudbaseDigestTimeoutMs: 900,
    cloudbaseModerationTimeoutMs: 10,
    cloudbaseFailureThreshold: 3,
    cloudbaseCooldownMs: 60000,
    analysisMaxOutputTokens: 100,
    analysisBatchMaxOutputTokens: 200,
    digestMaxOutputTokens: 200,
    apiKey: ''
  }, {
    cloudbaseAi: fakeAi(async ({ input }) => ({
      text: JSON.stringify(input.max_tokens === 450
        ? { verdict: 'allow', confidence: 0.99, categories: [], reason: 'normal' }
        : validAnalysis()),
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    })),
    budgetService: budgetService(),
    setTimeoutImpl: (callback, timeoutMs) => {
      timeoutDelays.push(timeoutMs);
      return { callback };
    },
    clearTimeoutImpl: () => {},
    logger: { warn: () => {} }
  });
  assert.match(provider.name, /cloudbase-managed/);
  assert.equal((await provider.analyzeItem({ id: 'item-1' })).provider, 'cloudbase');
  assert.equal((await provider.moderateComment({ content: 'normal' })).provider, 'cloudbase');
  assert.deepEqual(timeoutDelays, [800, 10]);
});

test('fails comment moderation closed when both managed and Packy providers fail', async () => {
  const unavailable = () => {
    const error = new Error('INTELLIGENCE_UPSTREAM_FAILURE');
    error.code = 'INTELLIGENCE_UPSTREAM_FAILURE';
    throw error;
  };
  const provider = createResilientIntelligenceProvider({
    primary: { name: 'cloudbase', enabled: true, moderateComment: unavailable },
    fallback: { name: 'packy', enabled: true, moderateComment: unavailable },
    logger: { warn: () => {} }
  });
  const service = createCommentModerationService({
    provider,
    getTempFileURL: async () => ({ fileList: [] })
  });
  await assert.rejects(
    () => service.review({ content: '正常文本', attachments: [] }),
    (error) => error.code === 'CONTENT_REVIEW_UNAVAILABLE'
  );
});

test('fails comment moderation closed for low-confidence allow results', async () => {
  const service = createCommentModerationService({
    provider: {
      name: 'test', enabled: true,
      moderateComment: async () => ({
        verdict: 'allow', confidence: 0.2, categories: ['other'], reason: '不确定'
      })
    },
    getTempFileURL: async () => ({ fileList: [] })
  });
  await assert.rejects(
    () => service.review({ content: '需要进一步判断', attachments: [] }),
    (error) => error.code === 'CONTENT_REVIEW_UNAVAILABLE'
  );
});
