const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jpeg = require('../cloudfunctions/knowledgeFeed/node_modules/jpeg-js');
const {
  SOURCE_PREVIEW_REVIEW_SCHEMA,
  assertSchema
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-contracts');
const {
  SOURCE_PREVIEW_REVIEW_INSTRUCTIONS
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-prompts');
const {
  createCloudbaseIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/cloudbase-intelligence-provider');
const {
  createPackyIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/packy-intelligence-provider');
const {
  createDisabledIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-provider');
const {
  createResilientIntelligenceProvider
} = require('../cloudfunctions/knowledgeFeed/adapters/resilient-intelligence-provider');
const {
  inspectJpegVisualSignal,
  resizeRepresentativeJpeg,
  createSourcePreviewReviewService
} = require('../cloudfunctions/knowledgeFeed/services/source-preview-review-service');
const {
  createPreviewService
} = require('../cloudfunctions/knowledgeFeed/services/preview-service');
const {
  createFeedVisualWorkerService,
  readyVisualFields,
  VISUAL_WORK_SLOTS,
  chooseWorkerCandidates,
  deterministicStatusJob,
  previewStartBudgetForJob
} = require('../cloudfunctions/knowledgeFeed/services/feed-visual-worker-service');
const {
  INTELLIGENCE_CONFIG,
  PREVIEW_CONFIG,
  LIST_THUMBNAIL_CONFIG,
  VISUAL_JOB_CONFIG
} = require('../cloudfunctions/knowledgeFeed/config');

const QUALITY = Object.freeze({
  policyVersion: 1,
  verdict: 'accept',
  targetMatched: false,
  reviewRequired: true,
  reasonCode: 'PRIMARY_CONTENT_READY'
});
const ITEM = Object.freeze({
  id: 'preview-review-1',
  title: 'A model release explained',
  summary: 'The source announces a new model release.',
  source: 'Example Lab',
  url: 'https://public.example/model-release'
});
const FILE_ID_PREFIX = 'cloud://env.bucket/knowledge-previews/source/';

let representativeJpeg;
function reviewJpeg() {
  if (representativeJpeg) return representativeJpeg;
  const width = 800;
  const height = 1000;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      data[offset] = x % 255;
      data[offset + 1] = y % 255;
      data[offset + 2] = (x + y) % 255;
      data[offset + 3] = 255;
    }
  }
  representativeJpeg = Buffer.from(jpeg.encode({ data, width, height }, 82).data);
  return representativeJpeg;
}

function solidJpeg(red = 255, green = 255, blue = 255) {
  const width = 1080;
  const height = 1350;
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 74).data);
}

function acceptedResult(overrides = {}) {
  return {
    verdict: 'accept',
    targetMatched: true,
    confidence: 0.97,
    reasonCode: 'SOURCE_ITEM_MATCHED',
    provider: 'test-vision',
    model: 'vision-test',
    ...overrides
  };
}

function previewConfig(overrides = {}) {
  return {
    rendererUrl: 'https://renderer.example',
    rendererToken: 'r'.repeat(40),
    rendererTimeoutMs: 1000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxImageBytes: 1024 * 1024,
    maxSegments: 12,
    captureVersion: 3,
    captureProfile: 'focus-v1',
    cloudPathPrefix: 'knowledge-previews/source/',
    fileIdPrefix: FILE_ID_PREFIX,
    ...overrides
  };
}

function rendererFetch(jpegBuffer, quality = QUALITY) {
  return async () => {
    const body = Buffer.from(JSON.stringify({
      ok: true,
      data: {
        captureVersion: 3,
        segmentCount: 1,
        finalUrl: 'https://www.public.example/model-release',
        quality,
        screenshots: [{ mimeType: 'image/jpeg', data: jpegBuffer.toString('base64') }]
      }
    }));
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      arrayBuffer: async () => body
    };
  };
}

test('uses a strict source preview review schema', () => {
  const valid = {
    verdict: 'accept', targetMatched: true, confidence: 0.98, reasonCode: 'MATCHED'
  };
  assert.equal(assertSchema(valid, SOURCE_PREVIEW_REVIEW_SCHEMA), valid);
  assert.throws(
    () => assertSchema({ ...valid, extra: true }, SOURCE_PREVIEW_REVIEW_SCHEMA),
    /INTELLIGENCE_OUTPUT_SCHEMA_INVALID/
  );
  const missing = { ...valid };
  delete missing.targetMatched;
  assert.throws(
    () => assertSchema(missing, SOURCE_PREVIEW_REVIEW_SCHEMA),
    /INTELLIGENCE_OUTPUT_SCHEMA_INVALID/
  );
  assert.throws(
    () => assertSchema({ ...valid, reasonCode: 'not strict' }, SOURCE_PREVIEW_REVIEW_SCHEMA),
    /INTELLIGENCE_OUTPUT_SCHEMA_INVALID/
  );
});

test('allows exact-page Open Graph artwork when its visible content matches the item', () => {
  assert.match(SOURCE_PREVIEW_REVIEW_INSTRUCTIONS, /official Open Graph/i);
  assert.match(SOURCE_PREVIEW_REVIEW_INSTRUCTIONS, /standalone graphic/i);
  assert.match(SOURCE_PREVIEW_REVIEW_INSTRUCTIONS, /reject generic logos/i);
});

test('budgets an independent review window inside the visual worker deadline', () => {
  assert.equal(INTELLIGENCE_CONFIG.cloudbaseSourcePreviewReviewTimeoutMs, 180000);
  assert.equal(INTELLIGENCE_CONFIG.packySourcePreviewReviewTimeoutMs, 90000);
  assert.equal(PREVIEW_CONFIG.reviewDeadlineMs, 210000);
  assert.ok(
    PREVIEW_CONFIG.rendererTimeoutMs
      + PREVIEW_CONFIG.reviewDeadlineMs
      + LIST_THUMBNAIL_CONFIG.rendererTimeoutMs
      < 300000
  );
  assert.ok(VISUAL_JOB_CONFIG.workerLeaseMs > 300000);
  assert.ok(VISUAL_JOB_CONFIG.jobLeaseMs > 300000);
  assert.equal(VISUAL_JOB_CONFIG.jobsPerCycle, 38);
  assert.equal(VISUAL_JOB_CONFIG.maxJobsPerInvocation, 38);
  assert.equal(VISUAL_JOB_CONFIG.maxCaptureConcurrency, 6);
  assert.equal(VISUAL_JOB_CONFIG.deterministicPreviewStartBudgetMs, 110000);
  assert.equal(VISUAL_JOB_CONFIG.obsoleteCleanupBatchSize, 1);
  assert.ok(VISUAL_JOB_CONFIG.workerSoftDeadlineMs < 300000);
  assert.ok(VISUAL_JOB_CONFIG.previewStartBudgetMs > 277000);
});

test('probes four times per minute while every visual tick remains lease-protected', () => {
  const cloudbase = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'cloudbaserc.json'),
    'utf8'
  ));
  const knowledgeFeed = cloudbase.functions.find((entry) => entry.name === 'knowledgeFeed');
  const visualTrigger = knowledgeFeed.triggers.find((entry) => (
    entry.name === 'knowledge-feed-visual-worker'
  ));
  assert.equal(visualTrigger.config, '10,25,40,55 * * * * * *');
  assert.equal(VISUAL_JOB_CONFIG.jobsPerCycle, 38);
  assert.equal(VISUAL_JOB_CONFIG.maxJobsPerInvocation, 38);
  assert.equal(VISUAL_JOB_CONFIG.maxCaptureConcurrency, 6);
  assert.equal(VISUAL_JOB_CONFIG.targetLiveWaitingJobs, 0);
});

test('visual cycles preserve weighted fairness and can assign multiple isolated workers', () => {
  const live = { _id: 'live', lane: 'live', status: 'pending', attempts: 0 };
  const repair = {
    _id: 'repair', repairReason: 'PREVIEW_CONTENT_INVALID', status: 'pending', attempts: 0
  };
  assert.deepEqual(VISUAL_WORK_SLOTS.map((slot) => slot.key), [
    'live-fresh-1', 'live-fresh-2', 'live-fresh-3', 'repair-fresh',
    'live-fresh-4', 'live-fresh-5', 'live-fresh-6', 'live-recovery',
    'live-fresh-7', 'live-fresh-8', 'live-fresh-9', 'repair-recovery'
  ]);
  assert.deepEqual(chooseWorkerCandidates([live, repair], 1, ''), [live]);
  assert.deepEqual(
    chooseWorkerCandidates([live, repair], 1, 'live', 'fresh', 'live-fresh-1'),
    [live]
  );
  assert.deepEqual(
    chooseWorkerCandidates([live, repair], 1, 'live', 'fresh', 'live-fresh-2'),
    [live]
  );
  assert.deepEqual(
    chooseWorkerCandidates([live, repair], 1, 'live', 'fresh', 'live-fresh-3'),
    [repair]
  );
  assert.deepEqual(
    chooseWorkerCandidates([live, repair], 1, 'repair', 'fresh', 'repair-fresh'),
    [live]
  );
  assert.deepEqual(chooseWorkerCandidates([live, repair], 2, ''), [live, repair]);
  const xLive = {
    ...live,
    expectedUrl: 'https://x.com/example/status/2079430412837757338'
  };
  const xRepair = {
    ...repair,
    expectedUrl: 'https://twitter.com/example/status/2079430412837757339'
  };
  assert.deepEqual(chooseWorkerCandidates([xLive, xRepair], 2, ''), [xLive, xRepair]);
  assert.deepEqual(
    chooseWorkerCandidates([xLive, xRepair], 2, 'live', 'fresh', 'live-fresh-3'),
    [xRepair, xLive]
  );
});

test('drains every fresh live item before repair work when the waiting target is zero', () => {
  const live = Array.from({ length: 10 }, (_, index) => ({
    _id: `live-${index}`,
    lane: 'live',
    status: 'pending',
    attempts: 0
  }));
  const repair = {
    _id: 'repair',
    repairReason: 'PREVIEW_CONTENT_INVALID',
    status: 'pending',
    attempts: 0
  };
  assert.deepEqual(
    chooseWorkerCandidates([...live, repair], 4, '', '', '', 0),
    live.slice(0, 4)
  );
});

test('uses the shorter deterministic budget only for exact X status jobs', () => {
  const config = {
    previewStartBudgetMs: 282000,
    deterministicPreviewStartBudgetMs: 110000,
    thumbnailStartBudgetMs: 17000
  };
  const exact = { expectedUrl: 'https://x.com/example/status/2079430412837757338' };
  assert.equal(deterministicStatusJob(exact), true);
  assert.equal(previewStartBudgetForJob(exact, config), 110000);
  assert.equal(previewStartBudgetForJob({ expectedUrl: 'https://example.com/article' }, config), 282000);
  assert.equal(previewStartBudgetForJob({ ...exact, stage: 'thumbnail' }, config), 17000);
});

test('single-job cycles preserve a recovery turn after the weighted live burst', () => {
  const fresh = { _id: 'fresh', lane: 'live', status: 'pending', attempts: 0 };
  const recovery = { _id: 'recovery', lane: 'live', status: 'retry', attempts: 1 };
  assert.deepEqual(chooseWorkerCandidates([fresh, recovery], 1, ''), [fresh]);
  assert.deepEqual(
    chooseWorkerCandidates([fresh, recovery], 1, 'live', 'fresh', 'live-fresh-6'),
    [recovery]
  );
  assert.deepEqual(
    chooseWorkerCandidates([fresh, recovery], 1, 'live', 'recovery', 'live-recovery'),
    [fresh]
  );
});

test('shrinks the representative JPEG before sending it to vision models', () => {
  const resized = resizeRepresentativeJpeg(reviewJpeg(), {
    maxWidth: 640,
    maxHeight: 800,
    maxBytes: 220 * 1024,
    quality: 58
  });
  const decoded = jpeg.decode(resized, { useTArray: true });
  assert.ok(decoded.width <= 640);
  assert.ok(decoded.height <= 800);
  assert.ok(resized.length <= 220 * 1024);
});

test('keeps exact renderer target matches on the deterministic fast path', async () => {
  let modelCalls = 0;
  const service = createSourcePreviewReviewService({
    provider: {
      name: 'unused', enabled: true,
      reviewSourcePreview: async () => { modelCalls += 1; return acceptedResult(); }
    },
    now: () => new Date('2026-07-21T10:00:00.000Z')
  });
  const audit = await service.review({
    item: ITEM,
    rendererQuality: {
      ...QUALITY,
      targetMatched: true,
      reviewRequired: false,
      reasonCode: 'TARGET_STATUS_MATCHED'
    },
    images: [reviewJpeg()]
  });
  assert.equal(modelCalls, 0);
  assert.equal(audit.reviewer, 'deterministic');
  assert.equal(audit.confidence, 1);
});

test('rejects solid captures and sends suspiciously small exact-target captures to AI', async () => {
  const blank = solidJpeg();
  const signal = inspectJpegVisualSignal(blank);
  assert.ok(signal.luminanceDeviation < 4);
  let modelCalls = 0;
  const service = createSourcePreviewReviewService({
    provider: {
      name: 'test-vision',
      enabled: true,
      reviewSourcePreview: async ({ rendererQuality }) => {
        modelCalls += 1;
        assert.equal(rendererQuality.reviewRequired, true);
        assert.equal(rendererQuality.reasonCode, 'SPARSE_CAPTURE_REQUIRES_AI');
        return acceptedResult();
      }
    },
    deterministicFastPathMinBytes: reviewJpeg().length + 1
  });
  await assert.rejects(service.review({
    item: ITEM,
    rendererQuality: {
      ...QUALITY,
      targetMatched: true,
      reviewRequired: false,
      reasonCode: 'TARGET_STATUS_MATCHED'
    },
    images: [blank]
  }), { code: 'PREVIEW_VISUALLY_BLANK' });
  assert.equal(modelCalls, 0);

  const audit = await service.review({
    item: ITEM,
    rendererQuality: {
      ...QUALITY,
      targetMatched: true,
      reviewRequired: false,
      reasonCode: 'TARGET_STATUS_MATCHED'
    },
    images: [reviewJpeg()]
  });
  assert.equal(modelCalls, 1);
  assert.equal(audit.reviewer, 'ai');
  assert.equal(audit.reasonCode, 'SOURCE_ITEM_MATCHED');
});

test('rejects malformed renderer proof and never fast-tracks an unconfirmed target', async () => {
  const service = createSourcePreviewReviewService({ provider: { enabled: false } });
  await assert.rejects(service.review({
    item: ITEM,
    rendererQuality: { ...QUALITY, unexpected: true },
    images: []
  }), { code: 'PREVIEW_QUALITY_CONTRACT_INVALID' });
  await assert.rejects(service.review({
    item: ITEM,
    rendererQuality: { ...QUALITY, reviewRequired: false },
    images: []
  }), { code: 'PREVIEW_RENDERER_TARGET_UNCONFIRMED' });
});

test('passes one resized data URL to AI and only accepts a high-confidence item match', async () => {
  let request;
  const service = createSourcePreviewReviewService({
    provider: {
      name: 'test-vision', enabled: true, model: 'vision-test',
      reviewSourcePreview: async (value) => { request = value; return acceptedResult(); }
    },
    minConfidence: 0.9,
    maxImages: 1,
    imageMaxWidth: 640,
    imageMaxHeight: 800,
    imageMaxBytes: 220 * 1024,
    now: () => new Date('2026-07-21T10:00:00.000Z'),
    clock: () => 1000
  });
  const audit = await service.review({
    item: ITEM,
    rendererQuality: QUALITY,
    images: [reviewJpeg()],
    finalUrl: 'https://redirected.example/model-release'
  });
  assert.equal(request.imageUrls.length, 1);
  assert.match(request.imageUrls[0], /^data:image\/jpeg;base64,/);
  assert.ok(Buffer.from(request.imageUrls[0].split(',')[1], 'base64').length <= 220 * 1024);
  assert.equal(request.item.title, ITEM.title);
  assert.equal(request.item.finalUrl, 'https://redirected.example/model-release');
  assert.equal(request.reviewDeadlineAt, 211000);
  assert.equal(audit.redirected, true);
  assert.equal(audit.hostMatched, false);
  assert.equal(audit.verdict, 'accept');
  assert.equal(audit.targetMatched, true);
  assert.equal(audit.reviewer, 'ai');
});

test('fails closed for every non-accepting, mismatched, low-confidence or timed-out review', async () => {
  const scenarios = [
    [acceptedResult({ verdict: 'reject' }), 'PREVIEW_AI_REVIEW_REJECT'],
    [acceptedResult({ verdict: 'retry' }), 'PREVIEW_AI_REVIEW_RETRY'],
    [acceptedResult({ verdict: 'unsure' }), 'PREVIEW_AI_REVIEW_UNSURE'],
    [acceptedResult({ targetMatched: false }), 'PREVIEW_AI_REVIEW_TARGET_MISMATCH'],
    [acceptedResult({ confidence: 0.89 }), 'PREVIEW_AI_REVIEW_LOW_CONFIDENCE']
  ];
  for (const [result, code] of scenarios) {
    const service = createSourcePreviewReviewService({
      provider: { enabled: true, reviewSourcePreview: async () => result },
      minConfidence: 0.9
    });
    await assert.rejects(
      service.review({ item: ITEM, rendererQuality: QUALITY, images: [reviewJpeg()] }),
      (error) => error.code === code && error.previewQualityAudit.verdict === result.verdict
    );
  }
  const timeoutService = createSourcePreviewReviewService({
    provider: {
      enabled: true,
      reviewSourcePreview: async () => {
        const error = new Error('INTELLIGENCE_TIMEOUT');
        error.code = 'INTELLIGENCE_TIMEOUT';
        throw error;
      }
    }
  });
  await assert.rejects(
    timeoutService.review({ item: ITEM, rendererQuality: QUALITY, images: [reviewJpeg()] }),
    { code: 'PREVIEW_AI_REVIEW_TIMEOUT' }
  );
});

test('does not upload a renderer success until AI has approved its representative image', async () => {
  let uploads = 0;
  const reviewService = createSourcePreviewReviewService({
    provider: {
      name: 'test', enabled: true,
      reviewSourcePreview: async () => acceptedResult({ verdict: 'reject' })
    }
  });
  const service = createPreviewService({
    cloud: { uploadFile: async () => { uploads += 1; throw new Error('must not upload'); } },
    repository: {},
    config: previewConfig(),
    sourcePreviewReviewService: reviewService,
    fetchImpl: rendererFetch(reviewJpeg())
  });
  await assert.rejects(service.resolveAndUploadPreviews(ITEM), {
    code: 'PREVIEW_AI_REVIEW_REJECT'
  });
  assert.equal(uploads, 0);
});

test('keeps a failed AI quality audit on the retrying item', async () => {
  let retryArguments = null;
  const qualityAudit = {
    policyVersion: 1,
    verdict: 'reject',
    targetMatched: false,
    reviewRequired: true,
    reasonCode: 'ERROR_PAGE',
    confidence: 0.99
  };
  const failure = new Error('PREVIEW_AI_REVIEW_REJECT');
  failure.code = 'PREVIEW_AI_REVIEW_REJECT';
  failure.previewQualityAudit = qualityAudit;
  const service = createFeedVisualWorkerService({
    jobRepository: {
      retry: async (...args) => { retryArguments = args; }
    },
    itemRepository: {
      getByItemId: async () => ({
        ...ITEM,
        publicState: 'active',
        contentHash: 'hash-1',
        previewFileIds: [],
        listThumbnailFileId: ''
      })
    },
    syncStateRepository: {},
    coverService: {},
    previewService: { resolveAndUploadPreviews: async () => { throw failure; } },
    thumbnailService: {},
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: {
      captureVersion: 3,
      thumbnailVersion: 1,
      maxAttempts: 8
    },
    now: () => Date.parse('2026-07-21T10:00:00.000Z'),
    logger: { warn() {} }
  });
  const result = await service.processClaim({
    _id: 'aihot_preview-review-1',
    itemId: ITEM.id,
    expectedUrl: ITEM.url,
    expectedContentHash: 'hash-1',
    stage: 'preview',
    status: 'leased',
    attempts: 0,
    cleanupFileIds: [],
    stagedFileIds: [],
    captureVersion: 3
  }, 'worker-1');
  assert.equal(result.status, 'retry');
  assert.deepEqual(retryArguments[7], qualityAudit);
});

test('uploads after approval and carries the compact audit into visual publication fields', async () => {
  let uploads = 0;
  const reviewService = createSourcePreviewReviewService({
    provider: {
      name: 'test-vision', enabled: true,
      reviewSourcePreview: async () => acceptedResult()
    },
    now: () => new Date('2026-07-21T10:00:00.000Z')
  });
  const service = createPreviewService({
    cloud: {
      uploadFile: async ({ cloudPath }) => {
        uploads += 1;
        return { fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}` };
      }
    },
    repository: {},
    config: previewConfig(),
    sourcePreviewReviewService: reviewService,
    fetchImpl: rendererFetch(reviewJpeg())
  });
  const resolution = await service.resolveAndUploadPreviews(ITEM);
  assert.equal(uploads, 1);
  assert.equal(resolution.fileIds.length, 1);
  assert.equal(resolution.qualityAudit.reasonCode, 'SOURCE_ITEM_MATCHED');
  assert.equal(resolution.qualityAudit.redirected, true);
  assert.equal(resolution.qualityAudit.hostMatched, false);
  const fields = readyVisualFields(
    'preview', resolution.fileIds, new Date(), 3, '', 1, resolution.qualityAudit
  );
  assert.equal(fields.previewQualityAudit.verdict, 'accept');
  assert.equal(fields.previewQualityAudit.reviewer, 'ai');
});

test('downloads one staged CloudBase preview for review without returning base64 across functions', async () => {
  const fileId = `${FILE_ID_PREFIX}function-stage-1.jpg`;
  const image = reviewJpeg();
  let downloaded = '';
  let uploads = 0;
  const service = createPreviewService({
    cloud: {
      downloadFile: async ({ fileID }) => {
        downloaded = fileID;
        return { fileContent: image };
      },
      uploadFile: async () => {
        uploads += 1;
        throw new Error('staged files must not be uploaded twice');
      },
      deleteFile: async () => ({})
    },
    repository: {},
    config: previewConfig({
      rendererFunctionEnabled: true,
      rendererUrl: ''
    }),
    rendererClient: {
      capture: async () => ({
        captureVersion: 3,
        segmentCount: 1,
        fileIds: [fileId],
        quality: QUALITY,
        finalUrl: ITEM.url
      })
    },
    sourcePreviewReviewService: {
      review: async ({ images }) => {
        assert.equal(images.length, 1);
        assert.equal(images[0].equals(image), true);
        return { policyVersion: 1, verdict: 'accept', targetMatched: true };
      }
    }
  });
  const result = await service.resolveAndUploadPreviews(ITEM);
  assert.equal(downloaded, fileId);
  assert.equal(uploads, 0);
  assert.deepEqual(result.fileIds, [fileId]);
});

test('CloudBase review uses its independent timeout and excludes base64 from budget input', async () => {
  let generation;
  let reservation;
  const provider = createCloudbaseIntelligenceProvider({
    ai: {
      createModel: () => ({
        generateText: async (request, options) => {
          generation = { request, options };
          return {
            text: JSON.stringify(acceptedResult({ provider: undefined, model: undefined })),
            usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
          };
        }
      })
    },
    budgetService: {
      reserve: async (value) => { reservation = value; return { allowed: true }; },
      commit: async () => ({}),
      release: async () => null
    },
    moderationTimeoutMs: 30000,
    sourcePreviewReviewTimeoutMs: 180000
  });
  const dataUrl = `data:image/jpeg;base64,${reviewJpeg().toString('base64')}`;
  const result = await provider.reviewSourcePreview({
    item: ITEM, rendererQuality: QUALITY, imageUrls: [dataUrl]
  });
  assert.equal(result.verdict, 'accept');
  assert.equal(generation.options.timeout, 180000);
  assert.equal(reservation.imageCount, 1);
  assert.doesNotMatch(JSON.stringify(reservation.input), /data:image\/jpeg;base64/);
  assert.equal(
    generation.request.messages[1].content.some((part) => part.image_url?.url === dataUrl),
    true
  );
});

test('Packy review uses strict multimodal output with its independent timeout', async () => {
  let timeoutMs;
  let body;
  const provider = createPackyIntelligenceProvider({
    apiKey: 'secret',
    baseUrl: 'https://packy.example/v1',
    model: 'grok-test',
    moderationTimeoutMs: 30000,
    sourcePreviewReviewTimeoutMs: 90000,
    setTimeoutImpl: (callback, delay) => { timeoutMs = delay; return 1; },
    clearTimeoutImpl: () => null,
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: 'grok-test',
          output: [{ content: [{ text: JSON.stringify(acceptedResult({ provider: undefined, model: undefined })) }] }],
          usage: {}
        })
      };
    }
  });
  await provider.reviewSourcePreview({
    item: ITEM,
    rendererQuality: QUALITY,
    imageUrls: [`data:image/jpeg;base64,${reviewJpeg().toString('base64')}`]
  });
  assert.equal(timeoutMs, 90000);
  assert.equal(body.text.format.name, 'knowledge_source_preview_review');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.input[0].content.some((part) => part.type === 'input_image'), true);
});

test('resilient review falls back and a disabled provider still fails closed', async () => {
  const unavailable = async () => {
    const error = new Error('INTELLIGENCE_TIMEOUT');
    error.code = 'INTELLIGENCE_TIMEOUT';
    throw error;
  };
  const provider = createResilientIntelligenceProvider({
    primary: { name: 'primary', enabled: true, reviewSourcePreview: unavailable },
    fallback: {
      name: 'fallback', enabled: true,
      reviewSourcePreview: async () => acceptedResult({ provider: 'fallback' })
    },
    logger: { warn() {} }
  });
  assert.equal((await provider.reviewSourcePreview({})).provider, 'fallback');
  await assert.rejects(createDisabledIntelligenceProvider().reviewSourcePreview(), {
    code: 'INTELLIGENCE_PROVIDER_DISABLED'
  });
});
