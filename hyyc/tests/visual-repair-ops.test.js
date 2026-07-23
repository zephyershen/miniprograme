const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createVisualRepairService
} = require('../cloudfunctions/knowledgeOps/services/visual-repair-service');
const {
  isNewVisualJob
} = require('../cloudfunctions/knowledgeFeed/policies/new-visuals');

const TOKEN = 'v'.repeat(40);
const NOW = Date.parse('2026-07-21T08:00:00.000Z');
const ITEM_ID = 'item00001';
const DOCUMENT_ID = `aihot_${ITEM_ID}`;
const URL = 'https://x.com/example/status/1234567890';
const HASH = 'a'.repeat(64);
const PREVIEW_PREFIX = 'cloud://env/knowledge-previews/source/';
const THUMBNAIL_PREFIX = 'cloud://env/knowledge-thumbnails/list/';

function previewFile(itemId, generation = 'abcdef012345', segment = 1, prefix = PREVIEW_PREFIX) {
  return `${prefix}${itemId}-0123456789ab-${generation}-${segment}.jpg`;
}

function thumbnailFile(itemId, generation = 'abcdef012345') {
  return `${THUMBNAIL_PREFIX}${itemId}-0123456789ab-${generation}-v1.jpg`;
}

const OLD_PREVIEW = previewFile(ITEM_ID);
const OLD_THUMBNAIL = thumbnailFile(ITEM_ID);

function clone(value) {
  return structuredClone(value);
}

function memoryDb(seed = {}) {
  let state = new Map(Object.entries(seed).map(([collectionName, records]) => [
    collectionName,
    new Map(Object.entries(records).map(([id, document]) => [id, clone(document)]))
  ]));
  let transactionCalls = 0;

  function transactionReference(draft, collectionName, documentId) {
    if (!draft.has(collectionName)) draft.set(collectionName, new Map());
    const collection = draft.get(collectionName);
    return {
      get: async () => {
        if (!collection.has(documentId)) {
          throw Object.assign(new Error('DOCUMENT_NOT_FOUND'), { errCode: -1 });
        }
        return { data: clone(collection.get(documentId)) };
      },
      update: async ({ data }) => {
        if (!collection.has(documentId)) {
          throw Object.assign(new Error('DOCUMENT_NOT_FOUND'), { errCode: -1 });
        }
        collection.set(documentId, { ...collection.get(documentId), ...clone(data) });
      },
      set: async ({ data }) => {
        collection.set(documentId, clone(data));
      }
    };
  }

  return {
    db: {
      runTransaction: async (operation) => {
        transactionCalls += 1;
        const draft = clone(state);
        const result = await operation({
          collection: (collectionName) => ({
            doc: (documentId) => transactionReference(draft, collectionName, documentId)
          })
        });
        state = draft;
        return result;
      }
    },
    get: (collectionName, documentId) => clone(state.get(collectionName).get(documentId)),
    transactionCalls: () => transactionCalls
  };
}

function item(overrides = {}) {
  return {
    _id: DOCUMENT_ID,
    id: ITEM_ID,
    provider: 'aihot',
    publicState: 'active',
    url: URL,
    contentHash: HASH,
    title: 'Target news item',
    publishedAt: '2026-07-21T07:30:00.000Z',
    selected: true,
    coverFileId: '',
    previewFileIds: [OLD_PREVIEW],
    listThumbnailFileId: OLD_THUMBNAIL,
    previewStatus: 'ready',
    previewCaptureVersion: 2,
    listThumbnailVersion: 1,
    previewQualityAudit: { policyVersion: 1, verdict: 'allow' },
    visualState: 'ready',
    visualPublicationHeld: false,
    ...overrides
  };
}

function cache(cacheItem = item(), overrides = {}) {
  return {
    _id: 'aihot_selected',
    items: [cacheItem],
    pendingVisualDeletes: ['cloud://env/knowledge-covers/aihot/already-pending.jpg'],
    visualDeleteClaims: ['cloud://env/knowledge-covers/aihot/already-claimed.jpg'],
    ...overrides
  };
}

function seed({ target = item(), cacheDocument = cache(), job } = {}) {
  return {
    knowledge_feed_items: { [DOCUMENT_ID]: target },
    knowledge_feed_visual_jobs: job ? { [DOCUMENT_ID]: job } : {},
    knowledge_feed_cache: cacheDocument ? { aihot_selected: cacheDocument } : {}
  };
}

function request(overrides = {}) {
  return {
    token: TOKEN,
    itemId: ITEM_ID,
    expectedUrl: URL,
    expectedContentHash: HASH,
    expectedPreviewFileIds: [OLD_PREVIEW],
    expectedListThumbnailFileId: OLD_THUMBNAIL,
    ...overrides
  };
}

function serviceFor(store, options = {}) {
  return createVisualRepairService({
    db: store.db,
    authorize: (token) => {
      if (token !== TOKEN) throw Object.assign(new Error('denied'), { code: 'AUTH_REQUIRED' });
    },
    config: {
      provider: 'aihot',
      itemsCollectionName: 'knowledge_feed_items',
      jobsCollectionName: 'knowledge_feed_visual_jobs',
      cacheCollectionName: 'knowledge_feed_cache',
      cacheDocumentId: 'aihot_selected',
      previewFileIdPrefix: PREVIEW_PREFIX,
      listThumbnailFileIdPrefix: THUMBNAIL_PREFIX,
      captureVersion: 3,
      captureProfile: 'focus-v1',
      thumbnailVersion: 1,
      priority: 1000000,
      ...(options.config || {})
    },
    now: () => NOW,
    ...(options.wallNow ? { wallNow: options.wallNow } : {})
  });
}

test('authorizes before reading or mutating visual state', async () => {
  const store = memoryDb(seed());
  await assert.rejects(
    () => serviceFor(store).run(request({ token: 'wrong' })),
    { code: 'AUTH_REQUIRED' }
  );
  assert.equal(store.transactionCalls(), 0);
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
});

test('atomically quarantines exact bad refs, keeps text public, queues cleanup and rebuilds', async () => {
  const store = memoryDb(seed());
  const result = await serviceFor(store).run(request());
  const repaired = store.get('knowledge_feed_items', DOCUMENT_ID);
  const control = store.get('knowledge_feed_cache', 'aihot_selected');
  const job = store.get('knowledge_feed_visual_jobs', DOCUMENT_ID);

  assert.deepEqual(result, {
    itemId: ITEM_ID,
    status: 'queued',
    textVisible: true,
    cachePatched: true,
    stage: 'cover',
    cleanupQueued: 2,
    cleanupSkipped: 0
  });
  assert.equal(repaired.publicState, 'active');
  assert.equal(repaired.visualPublicationHeld, false);
  assert.equal(repaired.visualPublicationReleaseReason, 'visual-repair-quarantine');
  assert.equal(repaired.visualState, 'queued');
  assert.equal(repaired.previewStatus, 'stale');
  assert.equal(repaired.previewQualityAudit, null);
  assert.deepEqual(repaired.previewFileIds, []);
  assert.equal(repaired.listThumbnailFileId, '');
  assert.deepEqual(control.items[0].previewFileIds, []);
  assert.equal(control.items[0].listThumbnailFileId, '');
  assert.deepEqual(control.pendingVisualDeletes.sort(), [
    'cloud://env/knowledge-covers/aihot/already-pending.jpg',
    OLD_PREVIEW,
    OLD_THUMBNAIL
  ].sort());
  assert.equal(job.itemId, ITEM_ID);
  assert.equal(job.expectedUrl, URL);
  assert.equal(job.expectedContentHash, HASH);
  assert.equal(job.status, 'pending');
  assert.equal(job.captureVersion, 3);
  assert.equal(job.repairExpectedPreviewFileId, OLD_PREVIEW);
  assert.equal(job.stage, 'cover');
  assert.equal(job.eligibleAt.getTime(), NOW);
});

test('repeat repair is idempotent and does not duplicate cleanup work', async () => {
  const store = memoryDb(seed());
  const service = serviceFor(store);
  await service.run(request());
  const pendingBefore = store.get('knowledge_feed_cache', 'aihot_selected').pendingVisualDeletes;
  const result = await service.run(request());
  const pendingAfter = store.get('knowledge_feed_cache', 'aihot_selected').pendingVisualDeletes;

  assert.equal(result.status, 'alreadyQueued');
  assert.deepEqual(pendingAfter, pendingBefore);
});

test('rejects stale URL, hash or visual refs without committing partial writes', async () => {
  const cases = [
    request({ expectedUrl: 'https://x.com/example/status/changed' }),
    request({ expectedContentHash: 'b'.repeat(64) }),
    request({ expectedPreviewFileIds: [previewFile(ITEM_ID, 'bbbbbbbbbbbb')] }),
    request({ expectedListThumbnailFileId: thumbnailFile(ITEM_ID, 'bbbbbbbbbbbb') })
  ];
  for (const input of cases) {
    const store = memoryDb(seed());
    await assert.rejects(() => serviceFor(store).run(input), { code: 'VISUAL_REPAIR_STALE' });
    assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
    assert.equal(store.get('knowledge_feed_visual_jobs', DOCUMENT_ID), undefined);
  }
});

test('never queues foreign-prefix or another-item files for deletion', async () => {
  const foreignPreview = previewFile(
    ITEM_ID,
    'abcdef012345',
    1,
    'cloud://another-env/knowledge-previews/source/'
  );
  const otherItemThumb = thumbnailFile('item99999');
  const target = item({
    previewFileIds: [foreignPreview],
    listThumbnailFileId: otherItemThumb
  });
  const store = memoryDb(seed({ target, cacheDocument: cache(target) }));
  const result = await serviceFor(store).run(request({
    expectedPreviewFileIds: [foreignPreview],
    expectedListThumbnailFileId: otherItemThumb
  }));
  const control = store.get('knowledge_feed_cache', 'aihot_selected');

  assert.equal(result.cleanupQueued, 0);
  assert.equal(result.cleanupSkipped, 2);
  assert.equal(control.pendingVisualDeletes.includes(foreignPreview), false);
  assert.equal(control.pendingVisualDeletes.includes(otherItemThumb), false);
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, []);
});

test('does not steal an actively leased visual job', async () => {
  const leasedJob = {
    itemId: ITEM_ID,
    provider: 'aihot',
    expectedUrl: URL,
    expectedContentHash: HASH,
    status: 'leased',
    leaseUntil: new Date(NOW + 60000)
  };
  const store = memoryDb(seed({ job: leasedJob }));
  await assert.rejects(() => serviceFor(store).run(request()), { code: 'VISUAL_REPAIR_BUSY' });
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
});

test('does not overwrite an active cleanup claim', async () => {
  const cleanupJob = {
    itemId: ITEM_ID,
    provider: 'aihot',
    expectedUrl: URL,
    expectedContentHash: HASH,
    status: 'cleanup',
    leaseOwner: 'cleanup-worker',
    leaseUntil: new Date(NOW + 60000),
    cleanupFileIds: [previewFile(ITEM_ID, 'bbbbbbbbbbbb')]
  };
  const store = memoryDb(seed({ job: cleanupJob }));
  await assert.rejects(() => serviceFor(store).run(request()), { code: 'VISUAL_REPAIR_BUSY' });
  assert.equal(store.get('knowledge_feed_visual_jobs', DOCUMENT_ID).status, 'cleanup');
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
});

test('preserves a valid cover and rebuilds only its list thumbnail', async () => {
  const coverFileId = 'cloud://env/knowledge-covers/aihot/valid-cover.jpg';
  const target = item({ coverFileId });
  const store = memoryDb(seed({ target, cacheDocument: cache(target) }));
  const result = await serviceFor(store).run(request());
  const repaired = store.get('knowledge_feed_items', DOCUMENT_ID);
  const job = store.get('knowledge_feed_visual_jobs', DOCUMENT_ID);

  assert.equal(result.stage, 'thumbnail');
  assert.equal(repaired.coverFileId, coverFileId);
  assert.equal(job.stage, 'thumbnail');
  assert.equal(
    store.get('knowledge_feed_cache', 'aihot_selected').pendingVisualDeletes.includes(coverFileId),
    false
  );
});

test('requires the durable cleanup control document before changing public refs', async () => {
  const store = memoryDb(seed({ cacheDocument: null }));
  await assert.rejects(
    () => serviceFor(store).run(request()),
    { code: 'VISUAL_CLEANUP_UNAVAILABLE' }
  );
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
  assert.equal(store.get('knowledge_feed_visual_jobs', DOCUMENT_ID), undefined);
});

test('skips repair while legacy visual maintenance holds its cache lease', async () => {
  const control = cache(item(), {
    visualLeaseOwner: 'legacy-worker',
    visualLeaseUntil: new Date(NOW + 60000)
  });
  const store = memoryDb(seed({ cacheDocument: control }));
  await assert.rejects(() => serviceFor(store).run(request()), { code: 'VISUAL_REPAIR_BUSY' });
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
  assert.equal(store.get('knowledge_feed_visual_jobs', DOCUMENT_ID), undefined);
});

test('fails closed when the same cached item id points at another source identity', async () => {
  const conflictingCacheItem = item({
    url: 'https://x.com/example/status/another-source',
    contentHash: 'b'.repeat(64)
  });
  const store = memoryDb(seed({ cacheDocument: cache(conflictingCacheItem) }));
  await assert.rejects(
    () => serviceFor(store).run(request()),
    { code: 'VISUAL_REPAIR_CACHE_CONFLICT' }
  );
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [OLD_PREVIEW]);
});

test('journals item-owned visual refs that existed only in the legacy cache', async () => {
  const cachePreview = previewFile(ITEM_ID, 'bbbbbbbbbbbb');
  const cacheThumbnail = thumbnailFile(ITEM_ID, 'bbbbbbbbbbbb');
  const cached = item({
    previewFileIds: [cachePreview],
    listThumbnailFileId: cacheThumbnail
  });
  const store = memoryDb(seed({ cacheDocument: cache(cached) }));
  const result = await serviceFor(store).run(request());
  const pending = store.get('knowledge_feed_cache', 'aihot_selected').pendingVisualDeletes;

  assert.equal(result.cleanupQueued, 4);
  for (const fileId of [OLD_PREVIEW, OLD_THUMBNAIL, cachePreview, cacheThumbnail]) {
    assert.equal(pending.includes(fileId), true);
  }
});

test('resets a blocked repair job even though the bad refs were already quarantined', async () => {
  const target = item({
    previewFileIds: [],
    listThumbnailFileId: '',
    visualState: 'blocked'
  });
  const blockedJob = {
    itemId: ITEM_ID,
    provider: 'aihot',
    expectedUrl: URL,
    expectedContentHash: HASH,
    status: 'blocked',
    repairReason: 'PREVIEW_CONTENT_INVALID',
    repairExpectedPreviewFileId: OLD_PREVIEW,
    attempts: 8,
    stagedFileIds: []
  };
  const store = memoryDb(seed({
    target,
    cacheDocument: cache(target),
    job: blockedJob
  }));
  const result = await serviceFor(store).run(request());
  const job = store.get('knowledge_feed_visual_jobs', DOCUMENT_ID);

  assert.equal(result.status, 'queued');
  assert.equal(result.resetFromStatus, 'blocked');
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 0);
});

test('recovers an inactive cleanup-stage repair without losing its old file journal', async () => {
  const target = item({ previewFileIds: [], listThumbnailFileId: '', visualState: 'queued' });
  const cleanupFileId = previewFile(ITEM_ID, 'bbbbbbbbbbbb');
  const cleanupJob = {
    itemId: ITEM_ID,
    provider: 'aihot',
    expectedUrl: URL,
    expectedContentHash: HASH,
    status: 'cleanup',
    repairReason: 'PREVIEW_CONTENT_INVALID',
    repairExpectedPreviewFileId: OLD_PREVIEW,
    leaseOwner: '',
    leaseUntil: new Date(NOW - 1000),
    cleanupFileIds: [cleanupFileId]
  };
  const store = memoryDb(seed({
    target,
    cacheDocument: cache(target),
    job: cleanupJob
  }));
  const result = await serviceFor(store).run(request());

  assert.equal(result.resetFromStatus, 'cleanup');
  assert.equal(store.get('knowledge_feed_visual_jobs', DOCUMENT_ID).status, 'pending');
  assert.equal(
    store.get('knowledge_feed_cache', 'aihot_selected').pendingVisualDeletes.includes(cleanupFileId),
    true
  );
});

test('batch mode repairs only exact first-preview matches and reports every skipped item', async () => {
  const secondId = 'item00002';
  const secondPreview = previewFile(secondId, 'bbbbbbbbbbbb');
  const secondThumbnail = thumbnailFile(secondId, 'bbbbbbbbbbbb');
  const second = item({
    _id: `aihot_${secondId}`,
    id: secondId,
    url: 'https://x.com/example/status/2222222222',
    contentHash: 'b'.repeat(64),
    previewFileIds: [secondPreview],
    listThumbnailFileId: secondThumbnail
  });
  const thirdId = 'item00003';
  const thirdPreview = previewFile(thirdId, 'cccccccccccc');
  const third = item({
    _id: `aihot_${thirdId}`,
    id: thirdId,
    url: 'https://x.com/example/status/3333333333',
    contentHash: 'c'.repeat(64),
    previewFileIds: [thirdPreview],
    listThumbnailFileId: thumbnailFile(thirdId, 'cccccccccccc'),
    publicState: 'withdrawn'
  });
  const store = memoryDb({
    knowledge_feed_items: {
      [DOCUMENT_ID]: item(),
      [`aihot_${secondId}`]: second,
      [`aihot_${thirdId}`]: third
    },
    knowledge_feed_visual_jobs: {},
    knowledge_feed_cache: {
      aihot_selected: {
        items: [item(), second, third],
        pendingVisualDeletes: [],
        visualDeleteClaims: []
      }
    }
  });
  const result = await serviceFor(store).run({
    token: TOKEN,
    repairs: [
      { itemId: ITEM_ID, expectedPreviewFileId: OLD_PREVIEW },
      { itemId: secondId, expectedPreviewFileId: secondPreview },
      { itemId: thirdId, expectedPreviewFileId: thirdPreview }
    ]
  });

  assert.equal(result.requested, 3);
  assert.equal(result.applied, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.results.map((entry) => entry.status), ['applied', 'applied', 'skipped']);
  assert.equal(result.results[2].code, 'VISUAL_REPAIR_NOT_ACTIVE');
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, []);
  assert.deepEqual(store.get('knowledge_feed_items', `aihot_${secondId}`).previewFileIds, []);
  assert.deepEqual(
    store.get('knowledge_feed_items', `aihot_${thirdId}`).previewFileIds,
    [thirdPreview]
  );
});

test('targeted batch matching requires the exact first preview file', async () => {
  const first = previewFile(ITEM_ID, 'dddddddddddd');
  const target = item({ previewFileIds: [first, OLD_PREVIEW] });
  const store = memoryDb(seed({ target, cacheDocument: cache(target) }));
  const result = await serviceFor(store).run({
    token: TOKEN,
    repairs: [{ itemId: ITEM_ID, expectedPreviewFileId: OLD_PREVIEW }]
  });

  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[0].code, 'VISUAL_REPAIR_STALE');
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [first, OLD_PREVIEW]);
});

test('rejects item-id prefix collisions that do not match the generated filename grammar', async () => {
  const collidingFile = previewFile(`${ITEM_ID}-other`);
  const target = item({ previewFileIds: [collidingFile] });
  const store = memoryDb(seed({ target, cacheDocument: cache(target) }));
  const result = await serviceFor(store).run({
    token: TOKEN,
    repairs: [{ itemId: ITEM_ID, expectedPreviewFileId: collidingFile }]
  });

  assert.equal(result.applied, 0);
  assert.equal(result.results[0].code, 'INVALID_REQUEST');
  assert.equal(store.transactionCalls(), 0);
  assert.deepEqual(store.get('knowledge_feed_items', DOCUMENT_ID).previewFileIds, [collidingFile]);
});

test('caps targeted repair batches at fifty entries', async () => {
  const store = memoryDb(seed());
  await assert.rejects(
    () => serviceFor(store).run({
      token: TOKEN,
      repairs: Array.from({ length: 51 }, () => ({
        itemId: ITEM_ID,
        expectedPreviewFileId: OLD_PREVIEW
      }))
    }),
    { code: 'INVALID_REQUEST' }
  );
  assert.equal(store.transactionCalls(), 0);
});

test('returns unprocessed batch entries before the cloud-function timeout window', async () => {
  const clock = [0, 46000];
  const store = memoryDb(seed());
  const result = await serviceFor(store, {
    wallNow: () => clock.shift() ?? 46000
  }).run({
    token: TOKEN,
    repairs: [
      { itemId: ITEM_ID, expectedPreviewFileId: OLD_PREVIEW },
      { itemId: ITEM_ID, expectedPreviewFileId: OLD_PREVIEW }
    ]
  });

  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[1].code, 'BATCH_DEADLINE');
});

test('puts an old repaired item into the explicit current repair lane', async () => {
  const target = item({ publishedAt: '2025-01-01T00:00:00.000Z' });
  const store = memoryDb(seed({ target, cacheDocument: cache(target) }));
  await serviceFor(store).run(request());
  const job = {
    _id: DOCUMENT_ID,
    ...store.get('knowledge_feed_visual_jobs', DOCUMENT_ID)
  };

  assert.equal(job.publishedAt, '2025-01-01T00:00:00.000Z');
  assert.equal(job.eligibleAt.getTime(), NOW);
  assert.equal(isNewVisualJob(job, '2026-07-18T04:43:08.568Z'), true);
});

test('repairVisual is maintenance-only and is not exposed by the public knowledgeFeed router', () => {
  const opsIndex = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/knowledgeOps/index.js'),
    'utf8'
  );
  const publicIndex = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/knowledgeFeed/index.js'),
    'utf8'
  );
  assert.match(opsIndex, /repairVisual/);
  assert.doesNotMatch(publicIndex, /repairVisual/);
});
