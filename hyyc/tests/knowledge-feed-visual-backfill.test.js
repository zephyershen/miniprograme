const test = require('node:test');
const assert = require('node:assert/strict');

const {
  jobPriority,
  visualJob
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-visual-job');
const {
  createFeedVisualWorkerService
} = require('../cloudfunctions/knowledgeFeed/services/feed-visual-worker-service');
const {
  createFeedVisualSeedService
} = require('../cloudfunctions/knowledgeFeed/services/feed-visual-seed-service');

const NOW = Date.parse('2026-07-17T04:00:00.000Z');
const CONFIG = Object.freeze({
  provider: 'aihot',
  captureVersion: 2,
  thumbnailVersion: 1,
  recentWindowDays: 7,
  jobsPerCycle: 2,
  dueBatchSize: 20,
  workerLeaseMs: 4 * 60 * 1000,
  jobLeaseMs: 4 * 60 * 1000,
  maxAttempts: 8,
  seedBatchSize: 2
});

function item(id, overrides = {}) {
  return {
    _id: `aihot_${id}`,
    id,
    url: `https://example.com/${id}`,
    contentHash: `${id}-hash`,
    publishedAt: '2026-07-17T03:00:00.000Z',
    publicState: 'active',
    selected: false,
    ...overrides
  };
}

function queuedJob(source = item('item0001'), overrides = {}) {
  return {
    ...visualJob(source, CONFIG, new Date(NOW)),
    status: 'leased',
    leaseOwner: 'worker-1',
    leaseUntil: new Date(NOW + CONFIG.jobLeaseMs),
    ...overrides
  };
}

test('prioritizes recent visual work before selected history and ordinary history', () => {
  assert.equal(jobPriority(item('recent01'), NOW, 7), 300);
  assert.equal(jobPriority(item('picked01', {
    publishedAt: '2026-06-01T00:00:00.000Z',
    selected: true
  }), NOW, 7), 200);
  assert.equal(jobPriority(item('history1', {
    publishedAt: '2026-06-01T00:00:00.000Z'
  }), NOW, 7), 100);
  assert.equal(visualJob(item('live0001'), CONFIG, new Date(NOW), 1000).priority, 1300);
  assert.equal(visualJob(item('covered1', { coverFileId: 'cloud://env/full.jpg' }), CONFIG, new Date(NOW)).stage, 'thumbnail');
});

test('derives a missing list thumbnail from an existing original without replacing it', async () => {
  const originalFileId = 'cloud://env/knowledge-covers/original.jpg';
  const source = item('item0004', { coverFileId: originalFileId });
  const candidate = queuedJob(source, { stage: 'thumbnail' });
  let completedFields = null;
  let stagedFiles = [];
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async () => [candidate],
      claim: async () => ({ acquired: true, job: candidate }),
      stageFiles: async (id, owner, fileIds) => {
        stagedFiles = fileIds;
        return candidate;
      },
      completeWithVisual: async (id, owner, fields) => {
        completedFields = fields;
        return { applied: true, itemId: source.id };
      }
    },
    itemRepository: { getByItemId: async () => source },
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true }),
      releaseVisualWorkerLease: async () => true,
      patch: async () => ({})
    },
    coverService: { resolveAndUploadCover: async () => { throw new Error('must not refetch'); } },
    previewService: { resolveAndUploadPreviews: async () => { throw new Error('must not recapture'); } },
    thumbnailService: {
      resolveAndUploadFromFile: async (entry, fileId) => {
        assert.equal(fileId, originalFileId);
        return 'cloud://env/knowledge-thumbnails/list/derived.jpg';
      }
    },
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: CONFIG,
    now: () => NOW,
    createOwner: () => 'worker-1'
  });

  const result = await service.run();
  assert.equal(result.completed, 1);
  assert.deepEqual(stagedFiles, ['cloud://env/knowledge-thumbnails/list/derived.jpg']);
  assert.equal(completedFields.coverFileId, undefined);
  assert.equal(completedFields.listThumbnailFileId, 'cloud://env/knowledge-thumbnails/list/derived.jpg');
});

test('publishes a resolved cover atomically and records worker progress', async () => {
  const source = item('item0002');
  const candidate = queuedJob(source);
  let completed = null;
  let syncState = {};
  const jobRepository = {
    listDue: async () => [candidate],
    claim: async () => ({ acquired: true, job: candidate }),
    stageFiles: async () => candidate,
    completeWithVisual: async (id, owner, fields) => {
      completed = { id, owner, fields };
      return { applied: true, itemId: source.id };
    }
  };
  const service = createFeedVisualWorkerService({
    jobRepository,
    itemRepository: { getByItemId: async () => source },
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true }),
      releaseVisualWorkerLease: async () => true,
      patch: async (fields) => (syncState = { ...syncState, ...fields })
    },
    coverService: { resolveAndUploadCover: async () => 'cloud://env/knowledge-covers/cover.jpg' },
    previewService: { resolveAndUploadPreviews: async () => { throw new Error('not expected'); } },
    thumbnailService: {
      resolveAndUploadFromFile: async () => 'cloud://env/knowledge-thumbnails/list/cover-thumb.jpg'
    },
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: CONFIG,
    now: () => NOW,
    createOwner: () => 'worker-1'
  });

  const result = await service.run();
  assert.equal(result.completed, 1);
  assert.equal(result.results[0].kind, 'cover');
  assert.equal(completed.id, candidate._id);
  assert.equal(completed.fields.visualState, undefined);
  assert.equal(completed.fields.coverStatus, 'ready');
  assert.equal(completed.fields.listThumbnailFileId, 'cloud://env/knowledge-thumbnails/list/cover-thumb.jpg');
  assert.equal(syncState.visualWorkerLastCompleted, 1);
});

test('falls back to source screenshots and backs failed jobs off without blocking the cycle', async () => {
  const source = item('item0003');
  const candidate = queuedJob(source);
  let advanced = false;
  let retried = null;
  const jobRepository = {
    listDue: async () => [candidate],
    claim: async () => ({ acquired: true, job: candidate }),
    advanceToPreview: async () => {
      advanced = true;
      return { ...candidate, stage: 'preview' };
    },
    retry: async (...args) => { retried = args; }
  };
  const service = createFeedVisualWorkerService({
    jobRepository,
    itemRepository: { getByItemId: async () => source },
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true }),
      releaseVisualWorkerLease: async () => true,
      patch: async () => ({})
    },
    coverService: { resolveAndUploadCover: async () => '' },
    previewService: { resolveAndUploadPreviews: async () => { throw new Error('PREVIEW_HTTP_502'); } },
    thumbnailService: { resolveAndUploadFromFile: async () => { throw new Error('not expected'); } },
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: CONFIG,
    now: () => NOW,
    createOwner: () => 'worker-1',
    logger: { warn() {} }
  });

  const result = await service.run();
  assert.equal(advanced, true);
  assert.equal(result.results[0].status, 'retry');
  assert.equal(result.results[0].attempts, 1);
  assert.equal(retried[2], 'PREVIEW_HTTP_502');
});

test('seeds recent items before history and persists bounded restart progress', async () => {
  const items = [item('item1001'), item('item1002'), item('item1003', {
    publishedAt: '2026-06-01T00:00:00.000Z'
  })];
  let state = {};
  const enqueued = [];
  const queued = [];
  const service = createFeedVisualSeedService({
    itemRepository: {
      getManyByItemIds: async (ids) => ids.map((id) => items.find((entry) => entry.id === id)),
      listByIdCursor: async (afterId, limit) => afterId ? [] : items.slice(0, limit),
      markVisualQueued: async (values) => queued.push(...values.map((entry) => entry.id))
    },
    dayIndexRepository: {
      listRange: async () => [{ entries: items.slice(0, 2).map((entry) => ({
        id: entry.id,
        publishedAt: entry.publishedAt
      })) }]
    },
    jobRepository: {
      enqueueMany: async (values) => {
        enqueued.push(values.map((entry) => entry.id));
        return {
          inserted: values.length,
          reset: 0,
          retained: 0,
          queuedItems: values
        };
      }
    },
    syncStateRepository: {
      get: async () => state,
      patch: async (fields) => (state = { ...state, ...fields })
    },
    config: CONFIG,
    now: () => NOW,
    logger: { warn() {} }
  });

  const result = await service.run({ restart: true, maxBatches: 3 });
  assert.deepEqual(enqueued[0], ['item1001', 'item1002']);
  assert.deepEqual(enqueued[1], ['item1001', 'item1002']);
  assert.deepEqual(queued, ['item1001', 'item1002', 'item1001', 'item1002']);
  assert.equal(result.visualSeedPhase, 'history');
  assert.equal(result.visualSeedScanned, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(state, '_id'), false);
});
