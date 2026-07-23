const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COLUMN_CASE_SCHEMA,
  DIGEST_SCHEMA,
  normalizeAnalysisResult,
  normalizeDigestResult,
  normalizeCommentModeration
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-contracts');
const {
  createPackyIntelligenceProvider,
  readResponseText
} = require('../cloudfunctions/knowledgeFeed/adapters/packy-intelligence-provider');
const {
  createIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-provider');
const {
  workerDue,
  shanghaiDayStart
} = require('../cloudfunctions/knowledgeFeed/services/feed-analysis-worker-service');
const {
  analysisInputHash
} = require('../cloudfunctions/knowledgeFeed/policies/feed-curation');
const {
  shanghaiClock,
  calendarPeriod,
  dueWindowKeys,
  createDigestGenerationService
} = require('../cloudfunctions/knowledgeFeed/services/digest-generation-service');
const {
  createCommentModerationService
} = require('../cloudfunctions/knowledgeFeed/services/comment-moderation-service');
const {
  DIGEST_INSTRUCTIONS
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-prompts');

test('asks the digest writer to explain changes in plain but accurate Chinese', () => {
  assert.match(DIGEST_INSTRUCTIONS, /普通上班族/);
  assert.match(DIGEST_INSTRUCTIONS, /谁做了什么/);
  assert.match(DIGEST_INSTRUCTIONS, /跟谁有关/);
  assert.match(DIGEST_INSTRUCTIONS, /已经确认到哪一步/);
  assert.match(DIGEST_INSTRUCTIONS, /不生成“跟你有什么关系”/);
  assert.match(DIGEST_INSTRUCTIONS, /避免“赋能、范式/);
  assert.equal(DIGEST_SCHEMA.properties.trends, undefined);
  assert.equal(DIGEST_SCHEMA.required.includes('trends'), false);
});

function successfulResponse(value, overrides = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      model: 'grok-4.5-build',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
      usage: {
        input_tokens: 120,
        output_tokens: 80,
        total_tokens: 200,
        output_tokens_details: { reasoning_tokens: 30 },
        cost_in_usd_ticks: 45
      },
      ...overrides
    })
  };
}

test('normalizes bounded analysis and rejects digest citations outside the candidate set', () => {
  const normalized = normalizeAnalysisResult({
    signals: {
      importance: 120, novelty: -1, sourceTrust: 80,
      evidence: 70, actionability: 60, duplicatePenalty: 10
    },
    noise: false,
    duplicate: false,
    shortReason: '  concise  ',
    reasonCodes: ['first-party', 'first-party'],
    companyKeys: [],
    directionKeys: []
  });
  assert.equal(normalized.signals.importance, 100);
  assert.equal(normalized.signals.novelty, 0);
  assert.deepEqual(normalized.reasonCodes, ['first-party']);

  assert.throws(() => normalizeDigestResult({
    executiveSummary: 'summary',
    mustKnow: [{ title: 'title', copy: 'copy', sourceItemIds: ['invented'], tags: [] }]
  }, ['real']), (error) => error.code === 'INTELLIGENCE_DIGEST_INVALID');
});

test('calls the Packy Responses endpoint with strict structured output and keeps usage metadata', async () => {
  let request;
  let requestedTimeout;
  const provider = createPackyIntelligenceProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.test/v1/',
    model: 'grok-4.5',
    setTimeoutImpl: (callback, timeoutMs) => {
      requestedTimeout = timeoutMs;
      return { callback };
    },
    clearTimeoutImpl: () => {},
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return successfulResponse({
        signals: {
          importance: 90, novelty: 80, sourceTrust: 85,
          evidence: 70, actionability: 65, duplicatePenalty: 0
        },
        noise: false,
        duplicate: false,
        shortReason: '影响范围较大的模型更新',
        reasonCodes: ['model-release'],
        companyKeys: ['company:test'],
        directionKeys: ['direction:model']
      });
    }
  });
  const result = await provider.analyzeItem({
    id: 'item-1', title: 'Model update', topicKeys: ['company:test', 'direction:model']
  });

  assert.equal(request.url, 'https://example.test/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.body.model, 'grok-4.5');
  assert.equal(requestedTimeout, 90000);
  assert.deepEqual(request.body.reasoning, { effort: 'low' });
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.strict, true);
  assert.match(request.body.input, /<untrusted_input>/);
  assert.equal(result.provider, 'packy');
  assert.equal(result.model, 'grok-4.5-build');
  assert.deepEqual(result.usage, {
    inputTokens: 120,
    outputTokens: 80,
    reasoningTokens: 30,
    totalTokens: 200,
    costUsdTicks: 45
  });
});

test('sends a strict-compatible complete schema when Packy abstains from a weekly case', async () => {
  let requestBody;
  const provider = createPackyIntelligenceProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.test/v1',
    model: 'grok-4.5',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return successfulResponse({
        publish: false,
        reason: 'Only repeated secondary reports were available.',
        title: '',
        conclusion: '',
        happened: '',
        impact: '',
        tryNow: [],
        noNeedToWorry: '',
        dossierKey: '',
        relatedLessonIds: [],
        sourceItemIds: []
      });
    }
  });

  const result = await provider.generateColumnCase({
    allowedDossierKeys: ['search-research'],
    allowedLessonIds: ['research']
  }, [{ id: 'a', title: 'Source A', source: 'One', curationScore: 80 }]);

  const schema = requestBody.text.format.schema;
  assert.equal(requestBody.text.format.strict, true);
  assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
  assert.deepEqual(schema, COLUMN_CASE_SCHEMA);
  assert.equal(result.publish, false);
  assert.match(result.reason, /repeated secondary/);
});

test('maps Packy throttling to a stable retryable intelligence error', async () => {
  const provider = createPackyIntelligenceProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.test/v1',
    model: 'grok-4.5',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'rate limited' } })
    })
  });
  await assert.rejects(
    () => provider.analyzeItem({ id: 'item-1' }),
    (error) => error.code === 'INTELLIGENCE_RATE_LIMITED' && error.status === 429
  );
});

test('stops reading an oversized Packy response before it can exhaust memory', async () => {
  const chunks = [
    new TextEncoder().encode('123456'),
    new TextEncoder().encode('789012')
  ];
  let cancelled = false;
  const reader = {
    async read() {
      return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
    },
    async cancel() { cancelled = true; },
    releaseLock() {}
  };
  await assert.rejects(
    () => readResponseText({
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => reader }
    }, 10),
    (error) => error.code === 'INTELLIGENCE_RESPONSE_TOO_LARGE'
  );
  assert.equal(cancelled, true);
});

test('rejects a declared Packy response larger than the configured byte budget', async () => {
  let bodyRead = false;
  await assert.rejects(
    () => readResponseText({
      status: 200,
      headers: { get: () => '4096' },
      text: async () => { bodyRead = true; return '{}'; }
    }, 2048),
    (error) => error.code === 'INTELLIGENCE_RESPONSE_TOO_LARGE'
  );
  assert.equal(bodyRead, false);
});

test('sends comment text and images through a strict multimodal moderation contract', async () => {
  let requestBody;
  let requestedTimeout;
  const provider = createPackyIntelligenceProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.test/v1',
    model: 'grok-4.5',
    moderationTimeoutMs: 20000,
    setTimeoutImpl: (callback, timeoutMs) => {
      requestedTimeout = timeoutMs;
      return { callback };
    },
    clearTimeoutImpl: () => {},
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return successfulResponse({
        verdict: 'allow', confidence: 0.98, categories: [], reason: '普通讨论'
      });
    }
  });
  const result = await provider.moderateComment({
    content: '这个判断有依据',
    imageUrls: ['https://example.test/comment.jpg']
  });
  assert.equal(result.verdict, 'allow');
  assert.equal(requestedTimeout, 20000);
  assert.equal(requestBody.text.format.name, 'knowledge_comment_moderation');
  assert.equal(requestBody.input[0].content[0].type, 'input_text');
  assert.equal(requestBody.input[0].content[1].type, 'input_image');
  assert.equal(requestBody.input[0].content[1].image_url, 'https://example.test/comment.jpg');
  assert.deepEqual(normalizeCommentModeration({
    verdict: 'unknown', confidence: 4, categories: ['spam', 'invented'], reason: ' test '
  }), {
    verdict: 'unsure', confidence: 1, categories: ['spam'], reason: 'test'
  });
});

test('keeps the legacy Packy timeout for moderation when no task override is supplied', async () => {
  const timeoutDelays = [];
  const provider = createPackyIntelligenceProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.test/v1',
    model: 'grok-4.5',
    timeoutMs: 1234,
    setTimeoutImpl: (callback, timeoutMs) => {
      timeoutDelays.push(timeoutMs);
      return { callback };
    },
    clearTimeoutImpl: () => {},
    fetchImpl: async () => successfulResponse({
      verdict: 'allow', confidence: 0.99, categories: [], reason: 'normal'
    })
  });

  await provider.moderateProfile({ nickname: 'normal' });
  assert.deepEqual(timeoutDelays, [1234]);
});

test('wires separate Packy background and moderation timeouts through the provider factory', async () => {
  const timeoutDelays = [];
  const provider = createIntelligenceProvider({
    providerEnabled: true,
    cloudbaseEnabled: false,
    apiKey: 'test-secret',
    apiBaseUrl: 'https://example.test/v1',
    model: 'grok-4.5',
    reasoningEffort: 'low',
    packyTimeoutMs: 90000,
    packyModerationTimeoutMs: 20000,
    analysisMaxOutputTokens: 1800,
    analysisBatchMaxOutputTokens: 3600,
    digestMaxOutputTokens: 3600
  }, {
    setTimeoutImpl: (callback, timeoutMs) => {
      timeoutDelays.push(timeoutMs);
      return { callback };
    },
    clearTimeoutImpl: () => {},
    packyFetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      return successfulResponse(body.text.format.name === 'knowledge_comment_moderation'
        ? { verdict: 'allow', confidence: 0.99, categories: [], reason: 'normal' }
        : {
            signals: {
              importance: 90, novelty: 80, sourceTrust: 85,
              evidence: 70, actionability: 65, duplicatePenalty: 0
            },
            noise: false,
            duplicate: false,
            shortReason: 'important update',
            reasonCodes: ['model-release'],
            companyKeys: [],
            directionKeys: []
          });
    },
    logger: { warn: () => {} }
  });

  await provider.analyzeItem({ id: 'item-1', title: 'Update' });
  await provider.moderateComment({ content: 'normal' });
  assert.deepEqual(timeoutDelays, [90000, 20000]);
});

test('fails comments closed without letting moderation delete unverified media', async () => {
  const deleted = [];
  const rejected = createCommentModerationService({
    provider: {
      enabled: true,
      moderateComment: async () => ({
        verdict: 'reject', confidence: 0.99, categories: ['spam'], reason: '广告垃圾'
      })
    },
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => ({ fileID, status: 0, tempFileURL: 'https://example.test/a.jpg' }))
    }),
    deleteFiles: async (fileIds) => deleted.push(...fileIds)
  });
  await assert.rejects(
    () => rejected.review({ content: '点击链接', attachments: [{ fileId: 'cloud://image' }] }),
    (error) => error.code === 'CONTENT_REJECTED'
  );
  assert.deepEqual(deleted, []);

  const unresolved = createCommentModerationService({
    provider: { enabled: true, moderateComment: async () => ({ verdict: 'allow' }) },
    getTempFileURL: async () => ({ fileList: [] })
  });
  await assert.rejects(
    () => unresolved.review({ attachments: [{ fileId: 'cloud://missing' }] }),
    (error) => error.code === 'CONTENT_REVIEW_UNAVAILABLE'
  );
});

test('analyzes up to five items in one request and allocates usage without duplication', async () => {
  const provider = createPackyIntelligenceProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.test/v1',
    model: 'grok-4.5',
    fetchImpl: async () => successfulResponse({
      analyses: ['one', 'two'].map((itemId, index) => ({
        itemId,
        signals: {
          importance: 70 + index, novelty: 60, sourceTrust: 80,
          evidence: 70, actionability: 50, duplicatePenalty: 0
        },
        noise: false,
        duplicate: false,
        shortReason: `Reason ${index + 1}`,
        reasonCodes: [], companyKeys: [], directionKeys: []
      }))
    })
  });
  const results = await provider.analyzeItems([
    { itemId: 'one', title: 'One' },
    { itemId: 'two', title: 'Two' }
  ]);
  assert.deepEqual(results.map((item) => item.itemId), ['one', 'two']);
  assert.equal(results.reduce((sum, item) => sum + item.usage.totalTokens, 0), 200);
  assert.equal(results.reduce((sum, item) => sum + item.usage.costUsdTicks, 0), 45);
});

test('keeps intelligence optional so provider setup cannot break the core feed', () => {
  assert.equal(createIntelligenceProvider({ providerEnabled: false }).enabled, false);
  const unavailable = createIntelligenceProvider({ providerEnabled: true });
  assert.equal(unavailable.enabled, false);
  assert.equal(unavailable.reason, 'INTELLIGENCE_PROVIDER_CONFIG_INVALID');
});

test('isolates a malformed Packy fallback during provider construction', async () => {
  const config = {
    providerEnabled: true,
    cloudbaseEnabled: false,
    apiKey: 'configured',
    apiBaseUrl: 'https://example.test/v1',
    model: 'grok-test'
  };
  const logger = { warn: () => {} };
  const disabled = createIntelligenceProvider(config, {
    packyFetchImpl: {},
    logger
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.reason, 'INTELLIGENCE_PROVIDER_CONFIG_INVALID');

  const primaryOnly = createIntelligenceProvider(config, {
    primaryProvider: {
      name: 'cloudbase-test', model: 'qwen-test', enabled: true,
      analyzeItem: async () => ({ provider: 'cloudbase' })
    },
    packyFetchImpl: {},
    logger
  });
  assert.equal(primaryOnly.enabled, true);
  assert.equal((await primaryOnly.analyzeItem({ id: 'one' })).provider, 'cloudbase');
});

test('throttles the scheduled worker to configured minute boundaries', () => {
  assert.equal(workerDue(Date.parse('2026-07-19T00:20:00.000Z'), 10), true);
  assert.equal(workerDue(Date.parse('2026-07-19T00:21:00.000Z'), 10), false);
  assert.equal(
    shanghaiDayStart(Date.parse('2026-07-19T15:59:59.000Z')).toISOString(),
    '2026-07-18T16:00:00.000Z'
  );
  assert.equal(
    shanghaiDayStart(Date.parse('2026-07-19T16:00:00.000Z')).toISOString(),
    '2026-07-19T16:00:00.000Z'
  );
});

test('builds a source-traceable daily digest without exposing it through feature flags', async () => {
  const now = Date.parse('2026-07-19T00:20:00.000Z');
  const items = ['one', 'two', 'three'].map((id, index) => ({
    id,
    title: `Title ${index + 1}`,
    summary: `Summary ${index + 1}`,
    source: 'Example',
    url: `https://example.com/${id}`,
    publishedAt: '2026-07-19T00:00:00.000Z',
    publicState: 'active',
    qualityTier: 'curated',
    curationScore: 90 - index
  }));
  let published;
  const service = createDigestGenerationService({
    provider: {
      enabled: true,
      generateDigest: async () => ({
        executiveSummary: '今日最重要的三项变化。',
        mustKnow: [{
          title: '核心变化', copy: '三项变化值得继续跟踪。',
          sourceItemIds: ['one', 'two'], tags: ['模型']
        }],
        radar: [], followUps: [],
        provider: 'packy', model: 'grok-4.5-build', usage: { totalTokens: 300 }
      })
    },
    digestRepository: {
      get: async () => null,
      latest: async () => null,
      publish: async (document) => {
        published = { ...document, status: 'published' };
        return published;
      }
    },
    itemRepository: {
      queryPage: async () => ({ items }),
      analysisCoverage: async () => ({ total: 3, ready: 3, ratio: 1, truncated: false })
    },
    config: { digestSourceLimit: 40, digestGenerationEnabled: true },
    now: () => now
  });

  assert.deepEqual(shanghaiClock(now), { dateKey: '20260719', minuteOfDay: 500 });
  const result = await service.generateWindow('24h');
  assert.equal(result.status, 'generated');
  assert.equal(published._id, 'digest_24h_20260718');
  assert.equal(published.periodKey, '20260718');
  assert.equal(published.windowStart.toISOString(), '2026-07-17T16:00:00.000Z');
  assert.equal(published.windowEnd.toISOString(), '2026-07-18T16:00:00.000Z');
  assert.deepEqual(published.mustKnow[0].sourceItemIds, ['one', 'two']);
  assert.deepEqual(published.sourceIndex.map((item) => item.itemId), ['one', 'two']);
  assert.equal(published.coverage.state, 'complete');
  assert.equal(published.intelligenceProvider, 'packy');
  assert.equal(published.trends, undefined);
});

test('publishes weekly and monthly digests on calendar boundaries only', () => {
  const mondayMorning = Date.parse('2026-07-20T00:06:00.000Z');
  const monthStartMorning = Date.parse('2026-08-01T00:11:00.000Z');
  assert.deepEqual(dueWindowKeys(mondayMorning), ['24h', '7d']);
  assert.deepEqual(dueWindowKeys(monthStartMorning), ['24h', '30d']);

  const weekly = calendarPeriod('7d', mondayMorning);
  assert.equal(weekly.periodKey, '20260713_20260719');
  assert.equal(weekly.windowStart.toISOString(), '2026-07-12T16:00:00.000Z');
  assert.equal(weekly.windowEnd.toISOString(), '2026-07-19T16:00:00.000Z');

  const monthly = calendarPeriod('30d', monthStartMorning);
  assert.equal(monthly.periodKey, '202607');
  assert.equal(monthly.windowStart.toISOString(), '2026-06-30T16:00:00.000Z');
  assert.equal(monthly.windowEnd.toISOString(), '2026-07-31T16:00:00.000Z');
});

test('claims a worker batch and makes one provider request for multiple articles', async () => {
  const items = ['one', 'two'].map((id) => ({
    id,
    title: `Title ${id}`,
    summary: 'Summary',
    url: `https://example.com/${id}`,
    source: 'Example',
    category: 'AI',
    channelKey: 'ai',
    topicKeys: [],
    publishedAt: '2026-07-19T00:00:00.000Z',
    publicState: 'active'
  }));
  const jobs = items.map((item) => ({
    _id: `job-${item.id}`,
    itemId: item.id,
    expectedInputHash: analysisInputHash(item),
    policyVersion: 1,
    attempts: 0
  }));
  let providerCalls = 0;
  const published = [];
  const completed = [];
  const { createFeedAnalysisWorkerService } = require(
    '../cloudfunctions/knowledgeFeed/services/feed-analysis-worker-service'
  );
  const service = createFeedAnalysisWorkerService({
    provider: {
      enabled: true,
      name: 'batch-test',
      analyzeItems: async (inputs) => {
        providerCalls += 1;
        return inputs.map((input) => ({
          itemId: input.itemId,
          signals: {
            importance: 80, novelty: 70, sourceTrust: 80,
            evidence: 70, actionability: 60, duplicatePenalty: 0
          },
          noise: false,
          duplicate: false,
          shortReason: 'Batch result',
          provider: 'test',
          model: 'test-model',
          usage: { totalTokens: 100 }
        }));
      }
    },
    jobRepository: {
      listDue: async () => jobs,
      claim: async (id, owner) => ({
        acquired: true,
        job: jobs.find((job) => job._id === id),
        owner
      }),
      complete: async (id) => completed.push(id),
      retry: async () => { throw new Error('must not retry'); }
    },
    itemRepository: {
      getByItemId: async (id) => items.find((item) => item.id === id)
    },
    analysisRepository: {
      countSince: async () => 0,
      publish: async (item, analysis) => {
        published.push({ item, analysis });
        return { applied: true };
      }
    },
    config: {
      jobsPerCycle: 5,
      workerIntervalMinutes: 1,
      maxAnalysisJobsPerDay: 48,
      maxAttempts: 8
    },
    now: () => Date.parse('2026-07-19T00:20:00.000Z'),
    createOwner: () => 'owner',
    logger: { warn: () => {} }
  });

  const result = await service.run();
  assert.equal(result.attempted, 2);
  assert.equal(providerCalls, 1);
  assert.equal(published.length, 2);
  assert.deepEqual(completed, ['job-one', 'job-two']);
});
