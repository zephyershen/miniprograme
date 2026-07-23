const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFeedVisualJobRepository,
  jobPriority,
  visualJob,
  prioritizeDueJobs,
  prioritizeVisualJobLanes,
  visualJobLane,
  isObsoleteVisualJob,
  atomicPreviewAudit
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-visual-job');

test('replaces the whole preview audit field instead of creating paths under null', () => {
  const audit = { policyVersion: 1, confidence: 0.99 };
  const setCalls = [];
  const fields = atomicPreviewAudit({
    command: {
      set: (value) => {
        setCalls.push(value);
        return { $wholeField: value };
      }
    }
  }, { previewQualityAudit: audit, visualState: 'ready' });
  assert.deepEqual(setCalls, [audit]);
  assert.deepEqual(fields.previewQualityAudit, { $wholeField: audit });
  assert.equal(fields.visualState, 'ready');
});
const {
  createFeedVisualWorkerService
} = require('../cloudfunctions/knowledgeFeed/services/feed-visual-worker-service');

const NOW = Date.parse('2026-07-17T04:00:00.000Z');
const CONFIG = Object.freeze({
  provider: 'aihot',
  captureVersion: 2,
  thumbnailVersion: 1,
  recentWindowDays: 7,
  jobsPerCycle: 2,
  dueBatchSize: 20,
  laneCandidateSize: 20,
  legacyLaneCandidateSize: 100,
  repairReason: 'PREVIEW_CONTENT_INVALID',
  obsoleteCleanupBatchSize: 2,
  workerLeaseMs: 4 * 60 * 1000,
  jobLeaseMs: 4 * 60 * 1000,
  maxAttempts: 8,
  newItemsAfter: '2026-07-16T00:00:00.000Z'
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
  assert.equal(visualJob(item('live0001'), CONFIG, new Date(NOW)).lane, 'live');
  assert.equal(visualJob(item('covered1', { coverFileId: 'cloud://env/full.jpg' }), CONFIG, new Date(NOW)).stage, 'thumbnail');
});

test('keeps live ingestion ahead of million-priority repair work while advancing both lanes', () => {
  const live = [
    queuedJob(item('live1001'), { _id: 'live-1', lane: 'live', priority: 2300 }),
    queuedJob(item('live1002'), { _id: 'live-2', lane: 'live', priority: 2300 })
  ];
  const repair = [
    queuedJob(item('fix10001'), {
      _id: 'repair-1', repairReason: 'PREVIEW_CONTENT_INVALID', priority: 1000000
    }),
    queuedJob(item('fix10002'), {
      _id: 'repair-2', repairReason: 'PREVIEW_CONTENT_INVALID', priority: 1000000
    })
  ];

  assert.deepEqual(
    prioritizeVisualJobLanes(live, repair, 4).map((job) => job._id),
    ['live-1', 'repair-1', 'live-2', 'repair-2']
  );
  assert.equal(visualJobLane(live[0]), 'live');
  assert.equal(visualJobLane(repair[0]), 'repair');
});

test('does not overwrite an obsolete lease or orphan its staged files during enqueue reset', async () => {
  const source = item('reset001');
  const documentId = source._id;
  const current = queuedJob(source, {
    _id: documentId,
    captureVersion: 2,
    status: 'leased',
    leaseOwner: 'old-worker',
    leaseUntil: new Date(NOW + 60 * 1000),
    stagedFileIds: ['cloud://env/staged-reset.jpg']
  });
  const documents = { [documentId]: { ...current } };
  const query = {
    where() { return this; },
    field() { return this; },
    limit() { return this; },
    async get() { return { data: [documents[documentId]] }; }
  };
  const reference = {
    get: async () => ({ data: documents[documentId] }),
    update: async ({ data }) => { documents[documentId] = { ...documents[documentId], ...data }; }
  };
  const db = {
    command: { in: (values) => ({ $in: values }) },
    createCollection: async () => null,
    collection: () => ({ ...query, add: async () => null }),
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: () => reference })
    })
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    captureVersion: 3,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });

  const result = await repository.enqueueMany([source], new Date(NOW));
  assert.equal(result.reset, 0);
  assert.equal(result.retained, 1);
  assert.equal(documents[documentId].captureVersion, 2);
  assert.equal(documents[documentId].leaseOwner, 'old-worker');
  assert.deepEqual(documents[documentId].stagedFileIds, ['cloud://env/staged-reset.jpg']);
});

test('queues old staged files for cleanup before replacing an idle obsolete job', async () => {
  const source = item('reset002');
  const documentId = source._id;
  const current = queuedJob(source, {
    _id: documentId,
    captureVersion: 2,
    status: 'retry',
    leaseOwner: '',
    leaseUntil: null,
    stagedFileIds: ['cloud://env/staged-reset-2.jpg'],
    cleanupFileIds: ['cloud://env/cleanup-reset-2.jpg']
  });
  const documents = { [documentId]: { ...current } };
  const query = {
    where() { return this; },
    field() { return this; },
    limit() { return this; },
    async get() { return { data: [documents[documentId]] }; }
  };
  const reference = {
    get: async () => ({ data: documents[documentId] }),
    update: async ({ data }) => { documents[documentId] = { ...documents[documentId], ...data }; }
  };
  const db = {
    command: { in: (values) => ({ $in: values }) },
    createCollection: async () => null,
    collection: () => ({ ...query, add: async () => null }),
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: () => reference })
    })
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    captureVersion: 3,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });

  const result = await repository.enqueueMany([source], new Date(NOW));
  assert.equal(result.reset, 0);
  assert.equal(result.retained, 1);
  assert.equal(documents[documentId].status, 'cleanup');
  assert.equal(documents[documentId].captureVersion, 2);
  assert.deepEqual(documents[documentId].cleanupFileIds.sort(), [
    'cloud://env/cleanup-reset-2.jpg',
    'cloud://env/staged-reset-2.jpg'
  ]);
  assert.deepEqual(documents[documentId].stagedFileIds, []);
});

test('puts never-tried realtime work ahead of a retry storm without starving recovery', () => {
  const eligibleAt = new Date('2026-07-17T03:00:00.000Z');
  const retryJobs = Array.from({ length: 12 }, (_, index) => queuedJob(
    item(`retry${String(index).padStart(4, '0')}`), {
    _id: `retry-${index}`,
    status: 'retry',
    attempts: 4,
    eligibleAt,
    nextAttemptAt: new Date(NOW - (20 + index) * 60 * 1000)
    }
  ));
  const freshJobs = [
    queuedJob(item('fresh001'), {
      _id: 'fresh-1', status: 'pending', attempts: 0, eligibleAt,
      nextAttemptAt: new Date(NOW - 60 * 1000)
    }),
    queuedJob(item('fresh002'), {
      _id: 'fresh-2', status: 'pending', attempts: 0, eligibleAt,
      nextAttemptAt: new Date(NOW - 30 * 1000)
    }),
    queuedJob(item('legacy01'), {
      _id: 'legacy', status: 'pending', attempts: 0,
      eligibleAt: new Date('2026-07-15T23:59:59.999Z'), priority: 999999,
      nextAttemptAt: new Date(NOW - 60 * 60 * 1000)
    })
  ];

  const due = prioritizeDueJobs(
    freshJobs,
    retryJobs,
    new Date(NOW),
    4,
    CONFIG.newItemsAfter
  );
  assert.deepEqual(due.map((job) => job._id), [
    'fresh-1', 'retry-11', 'fresh-2', 'retry-10'
  ]);
});

test('tries the newest item first when one source poll queues many items together', () => {
  const eligibleAt = new Date('2026-07-17T03:00:00.000Z');
  const sameDueAt = new Date(NOW - 60 * 1000);
  const jobs = [
    queuedJob(item('older001', { publishedAt: '2026-07-17T03:01:00.000Z' }), {
      _id: 'older', status: 'pending', attempts: 0, eligibleAt, nextAttemptAt: sameDueAt
    }),
    queuedJob(item('newest01', { publishedAt: '2026-07-17T03:59:00.000Z' }), {
      _id: 'newest', status: 'pending', attempts: 0, eligibleAt, nextAttemptAt: sameDueAt
    })
  ];

  assert.deepEqual(
    prioritizeDueJobs(jobs, [], new Date(NOW), 2, CONFIG.newItemsAfter)
      .map((job) => job._id),
    ['newest', 'older']
  );
});

test('queries live and repair lanes independently before interleaving them', async () => {
  const calls = [];
  const eligibleAt = new Date('2026-07-17T03:00:00.000Z');
  const pending = [queuedJob(item('fresh003'), {
    _id: 'fresh-3', status: 'pending', attempts: 0, eligibleAt,
    lane: 'live',
    nextAttemptAt: new Date(NOW - 1000)
  })];
  const recovery = [queuedJob(item('retry0099'), {
    _id: 'retry-99', status: 'retry', attempts: 7, eligibleAt,
    lane: 'live',
    nextAttemptAt: new Date(NOW - 2000)
  })];
  const repair = [queuedJob(item('repair01'), {
    _id: 'repair-1', status: 'pending', attempts: 0, eligibleAt,
    repairReason: 'PREVIEW_CONTENT_INVALID', priority: 1000000,
    nextAttemptAt: new Date(NOW - 3000)
  })];
  const db = {
    command: {
      in: (values) => ({ $in: values }),
      lte: (value) => ({ $lte: value }),
      gte: (value) => ({ $gte: value }),
      exists: (value) => ({ $exists: value })
    },
    createCollection: async () => null,
    collection: () => {
      const query = {
        filter: null,
        where(filter) { this.filter = filter; calls.push(['where', filter]); return this; },
        orderBy(field, direction) { calls.push(['orderBy', field, direction]); return this; },
        limit(value) { calls.push(['limit', value]); return this; },
        async get() {
          if (this.filter.repairReason === 'PREVIEW_CONTENT_INVALID') return {
            data: this.filter.status === 'pending' ? repair : []
          };
          if (this.filter.lane === 'live') return {
            data: this.filter.status === 'pending' ? pending : recovery
          };
          return { data: [] };
        }
      };
      return query;
    }
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });

  const due = await repository.listDue(new Date(NOW), 4, {
    eligibleAtOrAfter: CONFIG.newItemsAfter
  });
  assert.deepEqual(due.map((job) => job._id), ['fresh-3', 'repair-1', 'retry-99']);
  const filters = calls.filter(([name]) => name === 'where').map(([, filter]) => filter);
  assert.equal(filters.length, 6);
  assert.equal(filters.some((filter) => filter.lane === 'live' && filter.status === 'pending'), true);
  assert.equal(filters.some((filter) => (
    filter.repairReason === 'PREVIEW_CONTENT_INVALID' && filter.status === 'pending'
  )), true);
});

test('does not acquire or write a worker lease when no visual job is due', async () => {
  let leaseCalls = 0;
  let stateWrites = 0;
  let listDueArgs = null;
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async (...args) => {
        listDueArgs = args;
        return [];
      }
    },
    itemRepository: {},
    syncStateRepository: {
      acquireVisualWorkerLease: async () => { leaseCalls += 1; return { acquired: true }; },
      releaseVisualWorkerLease: async () => true,
      patch: async () => { stateWrites += 1; }
    },
    coverService: {}, previewService: {}, thumbnailService: {},
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: CONFIG,
    now: () => NOW
  });

  assert.deepEqual(await service.run(), {
    status: 'idle', attempted: 0, completed: 0, results: []
  });
  assert.equal(listDueArgs[0].getTime(), NOW);
  assert.equal(listDueArgs[1], CONFIG.dueBatchSize);
  assert.deepEqual(listDueArgs[2], { eligibleAtOrAfter: CONFIG.newItemsAfter });
  assert.equal(leaseCalls, 0);
  assert.equal(stateWrites, 0);
});

test('runs four visual claims concurrently on isolated worker invocations', async () => {
  const sources = Array.from({ length: 4 }, (_, index) => item(`parallel${index}`));
  const candidates = sources.map((source, index) => queuedJob(source, {
    _id: `parallel-job-${index}`,
    lane: 'live',
    status: 'pending',
    attempts: 0
  }));
  let active = 0;
  let peak = 0;
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async () => candidates,
      claim: async (id) => ({
        acquired: true,
        job: candidates.find((candidate) => candidate._id === id)
      }),
      stageFiles: async (id) => candidates.find((candidate) => candidate._id === id),
      completeWithVisual: async () => ({ applied: true })
    },
    itemRepository: {
      getByItemId: async (itemId) => sources.find((source) => source.id === itemId)
    },
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true, document: {} }),
      releaseVisualWorkerLease: async () => true,
      patch: async () => ({})
    },
    coverService: {
      resolveAndUploadCover: async (source) => {
        active += 1;
        peak = Math.max(peak, active);
        if (active === 4) releaseGate();
        await gate;
        active -= 1;
        return `cloud://env/knowledge-covers/${source.id}.jpg`;
      }
    },
    previewService: { resolveAndUploadPreviews: async () => { throw new Error('not expected'); } },
    thumbnailService: {
      resolveAndUploadFromFile: async (source) => (
        `cloud://env/knowledge-thumbnails/list/${source.id}.jpg`
      )
    },
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: {
      ...CONFIG,
      jobsPerCycle: 4,
      maxJobsPerInvocation: 4,
      maxCaptureConcurrency: 4,
      targetLiveWaitingJobs: 2,
      workerSoftDeadlineMs: 290000,
      previewStartBudgetMs: 1000,
      thumbnailStartBudgetMs: 1000
    },
    now: () => NOW,
    createOwner: () => 'parallel-worker'
  });

  const result = await service.run();
  assert.equal(peak, 4);
  assert.equal(result.attempted, 4);
  assert.equal(result.completed, 4);
});

test('ignores stale daily point metadata and still tries to claim visual work', async () => {
  const candidate = queuedJob(item('budget-capped'), {
    _id: 'budget-capped-job',
    lane: 'live',
    status: 'pending',
    attempts: 0
  });
  let claimCalls = 0;
  let releaseCalls = 0;
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async () => [candidate],
      claim: async () => {
        claimCalls += 1;
        return { acquired: false, job: candidate };
      }
    },
    itemRepository: {},
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({
        acquired: true,
        document: {
          visualBudgetDay: '2026-07-17',
          visualBudgetReservedPoints: 1200
        }
      }),
      releaseVisualWorkerLease: async () => { releaseCalls += 1; return true; },
      patch: async () => ({})
    },
    coverService: {}, previewService: {}, thumbnailService: {},
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: {
      ...CONFIG,
      jobsPerCycle: 4,
      maxJobsPerInvocation: 4,
      maxCaptureConcurrency: 4,
      workerSoftDeadlineMs: 290000,
      previewStartBudgetMs: 1000,
      thumbnailStartBudgetMs: 1000
    },
    now: () => NOW,
    createOwner: () => 'budget-worker'
  });

  const result = await service.run();
  assert.equal(result.status, 'ready');
  assert.equal(result.attempted, 0);
  assert.equal(result.completed, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'budgetLimited'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'visualBudgetReservedPoints'), false);
  assert.equal(claimCalls, 1);
  assert.equal(releaseCalls, 1);
});

test('claims obsolete jobs with compare-and-swap semantics and never claims blocked work', async () => {
  const oldJob = queuedJob(item('oldv2001'), {
    captureVersion: 2,
    status: 'pending',
    leaseOwner: '',
    leaseUntil: null,
    nextAttemptAt: new Date(NOW - 1000),
    stagedFileIds: ['cloud://env/staged-old.jpg'],
    cleanupFileIds: ['cloud://env/cleanup-old.jpg']
  });
  const documents = { [oldJob._id]: { ...oldJob } };
  const reference = (documentId) => ({
    get: async () => ({ data: documents[documentId] }),
    update: async ({ data }) => { documents[documentId] = { ...documents[documentId], ...data }; }
  });
  const db = {
    createCollection: async () => null,
    collection: () => ({}),
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: reference })
    })
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });

  const claimed = await repository.claimObsolete(
    oldJob._id,
    'cleanup-worker',
    3,
    new Date(NOW),
    new Date(NOW + CONFIG.jobLeaseMs)
  );
  assert.equal(claimed.acquired, true);
  assert.equal(claimed.job.status, 'cleanup');
  assert.equal(claimed.job.leaseOwner, 'cleanup-worker');
  assert.equal(isObsoleteVisualJob(claimed.job, 3), true);

  documents[oldJob._id] = {
    ...oldJob,
    status: 'blocked',
    nextAttemptAt: null
  };
  const blocked = await repository.claimObsolete(
    oldJob._id,
    'cleanup-worker',
    3,
    new Date(NOW)
  );
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.reason, 'not-due');

  documents[oldJob._id] = {
    ...oldJob,
    captureVersion: 3
  };
  const current = await repository.claimObsolete(
    oldJob._id,
    'cleanup-worker',
    3,
    new Date(NOW)
  );
  assert.equal(current.acquired, false);
  assert.equal(current.reason, 'current-version');
});

test('discovers v2 jobs without eligibleAt and excludes blocked status from obsolete cleanup', async () => {
  const oldWithoutCutoff = queuedJob(item('oldv2004'), {
    _id: 'old-without-eligible-at',
    captureVersion: 2,
    status: 'pending',
    nextAttemptAt: new Date(NOW - 1000)
  });
  delete oldWithoutCutoff.eligibleAt;
  let whereFilter = null;
  const query = {
    where(filter) { whereFilter = filter; return this; },
    orderBy() { return this; },
    limit() { return this; },
    async get() { return { data: [oldWithoutCutoff] }; }
  };
  const db = {
    command: {
      lt: (value) => ({ $lt: value }),
      lte: (value) => ({ $lte: value }),
      in: (values) => ({ $in: values })
    },
    createCollection: async () => null,
    collection: () => query
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });

  const result = await repository.listObsolete(new Date(NOW), 3, 2);
  assert.deepEqual(result.map((job) => job._id), ['old-without-eligible-at']);
  assert.deepEqual(whereFilter.captureVersion, { $lt: 3 });
  assert.deepEqual(whereFilter.status, {
    $in: ['pending', 'retry', 'cleanup', 'leased']
  });
  assert.equal(Object.hasOwn(whereFilter, 'eligibleAt'), false);
  assert.equal(whereFilter.status.$in.includes('blocked'), false);
});

test('atomically requeues a cleaned v2 job as v3 or removes it when the item is stale', async () => {
  const source = item('oldv2005');
  const oldJob = queuedJob(source, {
    _id: source._id,
    captureVersion: 2,
    status: 'cleanup',
    leaseOwner: 'cleanup-worker',
    cleanupFileIds: [],
    stagedFileIds: [],
    eligibleAt: new Date('2026-07-10T00:00:00.000Z')
  });
  const documents = {
    knowledge_feed_visual_jobs: { [source._id]: { ...oldJob } },
    knowledge_feed_items: { [source._id]: { ...source } }
  };
  const reference = (collectionName, documentId) => ({
    get: async () => {
      const value = documents[collectionName][documentId];
      if (!value) {
        const error = new Error('not found');
        error.errCode = -1;
        throw error;
      }
      return { data: value };
    },
    update: async ({ data }) => {
      documents[collectionName][documentId] = {
        ...documents[collectionName][documentId],
        ...data
      };
    },
    remove: async () => { delete documents[collectionName][documentId]; }
  });
  const db = {
    createCollection: async () => null,
    runTransaction: async (operation) => operation({
      collection: (collectionName) => ({
        doc: (documentId) => reference(collectionName, documentId)
      })
    })
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    captureVersion: 3,
    captureProfile: 'focus-v1',
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });

  const requeued = await repository.finishObsoleteCleanup(
    source._id,
    'cleanup-worker',
    3,
    new Date(NOW)
  );
  assert.equal(requeued.action, 'requeued');
  assert.equal(documents.knowledge_feed_visual_jobs[source._id].captureVersion, 3);
  assert.equal(documents.knowledge_feed_visual_jobs[source._id].status, 'pending');
  assert.equal(documents.knowledge_feed_visual_jobs[source._id].eligibleAt.getTime(), NOW);

  documents.knowledge_feed_visual_jobs[source._id] = { ...oldJob };
  documents.knowledge_feed_items[source._id] = { ...source, contentHash: 'changed' };
  const stale = await repository.finishObsoleteCleanup(
    source._id,
    'cleanup-worker',
    3,
    new Date(NOW)
  );
  assert.equal(stale.action, 'discarded');
  assert.equal(stale.reason, 'stale-item');
  assert.equal(documents.knowledge_feed_visual_jobs[source._id], undefined);
});

test('removes obsolete staged and cleanup files before serving a live visual job', async () => {
  const obsolete = queuedJob(item('oldv2002'), {
    _id: 'obsolete-v2',
    captureVersion: 2,
    status: 'pending',
    stagedFileIds: ['cloud://env/staged-v2.jpg'],
    cleanupFileIds: ['cloud://env/cleanup-v2.jpg']
  });
  const liveItem = item('live2001', {
    coverFileId: 'cloud://env/live-cover.jpg',
    listThumbnailFileId: 'cloud://env/live-thumb.jpg'
  });
  const live = queuedJob(liveItem, {
    _id: liveItem._id,
    captureVersion: 3,
    lane: 'live',
    status: 'pending',
    attempts: 0
  });
  const deleted = [];
  const discarded = [];
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async () => [live],
      listObsolete: async () => [obsolete],
      claimObsolete: async () => ({
        acquired: true,
        job: { ...obsolete, status: 'cleanup', leaseOwner: 'worker-1' }
      }),
      claim: async () => ({ acquired: true, job: { ...live, leaseOwner: 'worker-1' } }),
      finishObsoleteCleanup: async () => ({ applied: true, action: 'requeued' }),
      discard: async (id) => { discarded.push(id); return true; }
    },
    itemRepository: { getByItemId: async () => liveItem },
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true, document: {} }),
      releaseVisualWorkerLease: async () => true,
      patch: async () => ({})
    },
    coverService: {}, previewService: {}, thumbnailService: {},
    deleteFiles: async (fileIds) => {
      deleted.push(...fileIds);
      return { deletedFileIds: fileIds, retryFileIds: [] };
    },
    config: { ...CONFIG, captureVersion: 3 },
    now: () => NOW,
    createOwner: () => 'worker-1'
  });

  const result = await service.run();
  assert.deepEqual(deleted.sort(), [
    'cloud://env/cleanup-v2.jpg',
    'cloud://env/staged-v2.jpg'
  ]);
  assert.deepEqual(discarded, [liveItem._id]);
  assert.deepEqual(result.results.map((entry) => entry.status), [
    'obsolete-requeued',
    'already-ready'
  ]);
});

test('keeps an obsolete cleanup job retryable when storage deletion fails', async () => {
  const obsolete = queuedJob(item('oldv2003'), {
    _id: 'obsolete-retry',
    captureVersion: 2,
    status: 'cleanup',
    stagedFileIds: ['cloud://env/staged-retry.jpg'],
    cleanupFileIds: ['cloud://env/cleanup-retry.jpg']
  });
  let queued = null;
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async () => [],
      listObsolete: async () => [obsolete],
      claimObsolete: async () => ({
        acquired: true,
        job: { ...obsolete, leaseOwner: 'worker-1' }
      }),
      queueCleanup: async (...args) => { queued = args; return obsolete; }
    },
    itemRepository: {},
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true, document: {} }),
      releaseVisualWorkerLease: async () => true,
      patch: async () => ({})
    },
    coverService: {}, previewService: {}, thumbnailService: {},
    deleteFiles: async () => { throw new Error('storage unavailable'); },
    config: { ...CONFIG, captureVersion: 3 },
    now: () => NOW,
    createOwner: () => 'worker-1',
    logger: { warn() {} }
  });

  const result = await service.run();
  assert.equal(result.results[0].status, 'obsolete-cleanup-retry');
  assert.deepEqual(queued[2].sort(), [
    'cloud://env/cleanup-retry.jpg',
    'cloud://env/staged-retry.jpg'
  ]);
  assert.ok(queued[3] instanceof Date);
});

test('does not start a visual capture after maintenance consumes its soft deadline budget', async () => {
  const obsolete = queuedJob(item('oldv2006'), {
    _id: 'obsolete-before-deadline',
    captureVersion: 2,
    status: 'cleanup',
    cleanupFileIds: ['cloud://env/slow-delete.jpg']
  });
  const live = queuedJob(item('live3001'), {
    _id: 'live-after-slow-cleanup',
    captureVersion: 3,
    lane: 'live',
    status: 'pending',
    attempts: 0
  });
  let currentTime = NOW;
  let visualClaims = 0;
  const service = createFeedVisualWorkerService({
    jobRepository: {
      listDue: async () => [live],
      listObsolete: async () => [obsolete],
      claimObsolete: async () => ({
        acquired: true,
        job: { ...obsolete, leaseOwner: 'worker-1' }
      }),
      finishObsoleteCleanup: async () => ({ applied: true, action: 'requeued' }),
      claim: async () => { visualClaims += 1; return { acquired: false }; }
    },
    itemRepository: {},
    syncStateRepository: {
      acquireVisualWorkerLease: async () => ({ acquired: true, document: {} }),
      releaseVisualWorkerLease: async () => true,
      patch: async () => ({})
    },
    coverService: {}, previewService: {}, thumbnailService: {},
    deleteFiles: async (fileIds) => {
      currentTime += 9000;
      return { deletedFileIds: fileIds, retryFileIds: [] };
    },
    config: {
      ...CONFIG,
      captureVersion: 3,
      maxJobsPerInvocation: 1,
      workerSoftDeadlineMs: 290000,
      previewStartBudgetMs: 282000,
      thumbnailStartBudgetMs: 17000,
      obsoleteCleanupBatchSize: 1
    },
    now: () => currentTime,
    createOwner: () => 'worker-1'
  });

  const result = await service.run();
  assert.equal(visualClaims, 0);
  assert.equal(result.results[0].status, 'obsolete-requeued');
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

test('deletes stale jobs but retains a terminal failure as blocked for inspection', async () => {
  const source = item('terminal1');
  const staleJob = queuedJob(source, { captureVersion: 3 });
  const discarded = [];
  const staleService = createFeedVisualWorkerService({
    jobRepository: { discard: async (id) => { discarded.push(id); return true; } },
    itemRepository: { getByItemId: async () => ({ ...source, contentHash: 'changed' }) },
    syncStateRepository: {},
    coverService: {}, previewService: {}, thumbnailService: {},
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: { ...CONFIG, captureVersion: 3 },
    now: () => NOW
  });
  assert.deepEqual(await staleService.processClaim(staleJob, 'worker-1'), { status: 'stale' });
  assert.deepEqual(discarded, [staleJob._id]);

  let retryArguments = null;
  const blockedJob = queuedJob(source, {
    captureVersion: 3,
    stage: 'preview',
    attempts: CONFIG.maxAttempts - 1
  });
  const blockedService = createFeedVisualWorkerService({
    jobRepository: {
      retry: async (...args) => { retryArguments = args; return blockedJob; }
    },
    itemRepository: { getByItemId: async () => source },
    syncStateRepository: {},
    coverService: {},
    previewService: { resolveAndUploadPreviews: async () => { throw new Error('still bad'); } },
    thumbnailService: {},
    deleteFiles: async () => ({ deletedFileIds: [], retryFileIds: [] }),
    config: { ...CONFIG, captureVersion: 3 },
    now: () => NOW,
    logger: { warn() {} }
  });
  const blocked = await blockedService.processClaim(blockedJob, 'worker-1');
  assert.equal(blocked.status, 'blocked');
  assert.equal(retryArguments[6], true);
});

test('cleans staged files before a terminal visual failure becomes blocked', async () => {
  const source = item('terminal-cleanup');
  const job = queuedJob(source, {
    stage: 'preview',
    status: 'leased',
    attempts: CONFIG.maxAttempts - 1,
    leaseOwner: 'worker-1',
    leaseUntil: new Date(NOW + 60 * 1000),
    stagedFileIds: ['cloud://env/knowledge-previews/terminal-cleanup/1.jpg']
  });
  const documents = {
    knowledge_feed_visual_jobs: { [job._id]: { ...job } },
    knowledge_feed_items: { [source._id]: { ...source } }
  };
  const reference = (collectionName, documentId) => ({
    get: async () => {
      const document = documents[collectionName][documentId];
      if (!document) {
        const error = new Error('not found');
        error.errCode = -1;
        throw error;
      }
      return { data: document };
    },
    update: async ({ data }) => {
      documents[collectionName][documentId] = {
        ...documents[collectionName][documentId],
        ...data
      };
    },
    remove: async () => { delete documents[collectionName][documentId]; }
  });
  const db = {
    createCollection: async () => null,
    command: { set: (value) => value },
    runTransaction: async (operation) => operation({
      collection: (collectionName) => ({
        doc: (documentId) => reference(collectionName, documentId)
      })
    })
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });
  const failedAt = new Date(NOW + 30 * 1000);
  await repository.retry(
    job._id,
    'worker-1',
    'PREVIEW_HTTP_502',
    new Date(NOW + 60 * 1000),
    failedAt,
    CONFIG.maxAttempts,
    true
  );
  const queuedCleanup = documents.knowledge_feed_visual_jobs[job._id];
  assert.equal(queuedCleanup.status, 'cleanup');
  assert.equal(queuedCleanup.cleanupTerminalStatus, 'blocked');
  assert.deepEqual(queuedCleanup.cleanupFileIds, job.stagedFileIds);

  const claimedCleanup = {
    ...queuedCleanup,
    leaseOwner: 'worker-2',
    leaseUntil: new Date(NOW + 120 * 1000)
  };
  documents.knowledge_feed_visual_jobs[job._id] = claimedCleanup;
  const deleted = [];
  const service = createFeedVisualWorkerService({
    jobRepository: repository,
    itemRepository: {},
    syncStateRepository: {},
    coverService: {},
    previewService: {},
    thumbnailService: {},
    deleteFiles: async (fileIds) => {
      deleted.push(...fileIds);
      return { deletedFileIds: fileIds, retryFileIds: [] };
    },
    config: CONFIG,
    now: () => NOW + 60 * 1000,
    logger: { warn() {} }
  });

  const result = await service.processClaim(claimedCleanup, 'worker-2');
  assert.equal(result.status, 'cleanup');
  assert.deepEqual(deleted, job.stagedFileIds);
  const blocked = documents.knowledge_feed_visual_jobs[job._id];
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.cleanupFileIds, []);
  assert.deepEqual(blocked.stagedFileIds, []);
  assert.equal(blocked.nextAttemptAt, null);
});

test('releases a held text card as soon as its first visual attempt explicitly fails', async () => {
  const source = item('item0099', {
    visualState: 'queued',
    visualPublicationHeld: true,
    firstStoredAt: new Date(NOW)
  });
  const job = queuedJob(source);
  const documents = {
    knowledge_feed_visual_jobs: { [job._id]: { ...job } },
    knowledge_feed_items: { [source._id]: { ...source } }
  };
  const reference = (collectionName, documentId) => ({
    get: async () => ({ data: documents[collectionName][documentId] }),
    update: async ({ data }) => {
      documents[collectionName][documentId] = {
        ...documents[collectionName][documentId],
        ...data
      };
    }
  });
  const db = {
    createCollection: async () => null,
    runTransaction: async (operation) => operation({
      collection: (collectionName) => ({
        doc: (documentId) => reference(collectionName, documentId)
      })
    })
  };
  const repository = createFeedVisualJobRepository(db, {
    ...CONFIG,
    collectionName: 'knowledge_feed_visual_jobs',
    itemsCollectionName: 'knowledge_feed_items'
  });
  const failedAt = new Date(NOW + 30 * 1000);

  await repository.retry(
    job._id,
    job.leaseOwner,
    'PREVIEW_HTTP_502',
    new Date(NOW + 5 * 60 * 1000),
    failedAt,
    1,
    false
  );

  assert.equal(documents.knowledge_feed_visual_jobs[job._id].status, 'retry');
  assert.equal(documents.knowledge_feed_items[source._id].visualState, 'retry');
  assert.equal(documents.knowledge_feed_items[source._id].visualPublicationHeld, false);
  assert.equal(
    documents.knowledge_feed_items[source._id].visualPublicationReleaseReason,
    'visual-failed'
  );
});
