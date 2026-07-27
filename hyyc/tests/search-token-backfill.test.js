const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SEARCH_TOKEN_VERSION
} = require('../cloudfunctions/knowledgeFeed/lib/search-terms');
const {
  toStoredFeedItem
} = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const {
  createFeedItemRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-item');
const {
  createFeedSyncStateRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-sync-state');
const {
  createSearchTokenBackfillService
} = require('../cloudfunctions/knowledgeFeed/services/search-token-backfill-service');

const TOKEN = 's'.repeat(40);
const NOW = Date.parse('2026-07-27T09:00:00.000Z');
const CONFIG = {
  provider: 'aihot',
  itemsCollectionName: 'knowledge_feed_items',
  syncStateCollectionName: 'knowledge_feed_sync_state',
  syncStateDocumentId: 'aihot_all'
};

function rawItem(id, title) {
  return {
    id,
    title,
    titleEn: '',
    summary: '这是一条用于验证旧资讯存量索引补齐的摘要。',
    url: `https://example.com/${id}`,
    permalink: `https://example.com/${id}`,
    source: 'Example Research',
    publishedAt: '2026-07-10T08:00:00.000Z',
    category: 'tool',
    categoryLabel: '工具产品',
    categoryMarker: 'TOOL',
    channelKey: 'ai',
    coverTone: 'cyan',
    topicKeys: ['direction:agents'],
    score: 88,
    selected: false,
    attribution: null
  };
}

function memoryDatabase(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, documents]) => [
    name,
    new Map(documents.map((document) => [document._id, structuredClone(document)]))
  ]));

  function records(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function reference(name, id) {
    return {
      async get() {
        const value = records(name).get(id);
        if (!value) throw Object.assign(new Error('DOCUMENT_NOT_FOUND'), { errCode: -1 });
        return { data: structuredClone(value) };
      },
      async update({ data }) {
        const current = records(name).get(id);
        if (!current) throw Object.assign(new Error('DOCUMENT_NOT_FOUND'), { errCode: -1 });
        records(name).set(id, { ...current, ...structuredClone(data) });
      },
      async set({ data }) {
        records(name).set(id, { _id: id, ...structuredClone(data) });
      }
    };
  }

  function query(name, filter = null, limitValue = Number.POSITIVE_INFINITY) {
    return {
      doc: (id) => reference(name, id),
      where: (nextFilter) => query(name, nextFilter, limitValue),
      orderBy: () => query(name, filter, limitValue),
      limit: (nextLimit) => query(name, filter, nextLimit),
      async get() {
        let values = [...records(name).values()]
          .sort((left, right) => left._id.localeCompare(right._id));
        if (filter && filter._id && filter._id.operator === 'gt') {
          values = values.filter((value) => value._id > filter._id.value);
        }
        return { data: structuredClone(values.slice(0, limitValue)) };
      }
    };
  }

  const db = {
    command: {
      gt: (value) => ({ operator: 'gt', value })
    },
    async createCollection(name) {
      records(name);
    },
    collection: (name) => query(name),
    runTransaction: async (operation) => operation({
      collection: (name) => query(name)
    })
  };
  return { db, collections };
}

test('backfills old stored rows transactionally, resumes by server cursor, and completes once', async () => {
  const oldDocument = toStoredFeedItem(rawItem('search_old_0001', '旧资讯也能搜索 Claude'), {
    provider: 'aihot',
    generation: 'g1',
    observedAt: new Date(NOW)
  });
  delete oldDocument.searchTokenVersion;
  delete oldDocument.searchTokens;
  oldDocument.contentHash = 'legacy-content-hash';
  oldDocument.likeCount = 5;
  oldDocument.score = oldDocument.baseScore + oldDocument.likeCount;

  const currentDocument = toStoredFeedItem(rawItem('search_ready_0002', '已索引资讯'), {
    provider: 'aihot',
    generation: 'g1',
    observedAt: new Date(NOW)
  });
  const memory = memoryDatabase({
    knowledge_feed_items: [oldDocument, currentDocument],
    knowledge_feed_sync_state: [{
      _id: 'aihot_all',
      allItemsSyncedAt: new Date(NOW)
    }]
  });
  const itemRepository = createFeedItemRepository(memory.db, CONFIG);
  const syncStateRepository = createFeedSyncStateRepository(memory.db, CONFIG);
  let currentTime = NOW;
  const service = createSearchTokenBackfillService({
    itemRepository,
    syncStateRepository,
    maintenanceToken: TOKEN,
    now: () => currentTime,
    concurrency: 2
  });

  await assert.rejects(() => service.run({ token: 'wrong' }), { code: 'AUTH_REQUIRED' });

  const first = await service.runScheduled({ limit: 1 });
  assert.equal(first.done, false);
  assert.equal(first.advanced, true);
  assert.deepEqual(first.batch, { scanned: 1, updated: 1, skipped: 0, failed: 0 });

  currentTime += 1000;
  const second = await service.run({ token: TOKEN, limit: 1 });
  assert.equal(second.done, false);
  assert.deepEqual(second.batch, { scanned: 1, updated: 0, skipped: 1, failed: 0 });

  currentTime += 1000;
  const completed = await service.run({ token: TOKEN, limit: 1 });
  assert.equal(completed.done, true);
  assert.equal(completed.version, SEARCH_TOKEN_VERSION);
  assert.equal(completed.scanned, 2);
  assert.equal(completed.updated, 1);
  assert.equal(completed.skipped, 1);

  const stored = memory.collections.get('knowledge_feed_items').get(oldDocument._id);
  assert.equal(stored.searchTokenVersion, SEARCH_TOKEN_VERSION);
  assert.ok(stored.searchTokens.includes('l:claude'));
  assert.equal(stored.score, 93);
  assert.equal(stored.contentHash, 'legacy-content-hash');

  const repeated = await service.run({ token: TOKEN, limit: 1 });
  assert.equal(repeated.done, true);
  assert.equal(repeated.advanced, false);
  assert.deepEqual(repeated.batch, { scanned: 0, updated: 0, skipped: 0, failed: 0 });
  assert.equal(repeated.updated, 1);
});

test('rejects a stale cursor advance so concurrent batches cannot skip documents', async () => {
  const memory = memoryDatabase({
    knowledge_feed_sync_state: [{
      _id: 'aihot_all',
      allItemsSyncedAt: new Date(NOW)
    }]
  });
  const repository = createFeedSyncStateRepository(memory.db, CONFIG);
  const started = await repository.beginSearchTokenBackfill(
    SEARCH_TOKEN_VERSION,
    new Date(NOW)
  );
  assert.equal(started.state.searchTokenBackfillCursor, '');

  const winner = await repository.advanceSearchTokenBackfill({
    targetVersion: SEARCH_TOKEN_VERSION,
    expectedCursor: '',
    nextCursor: 'aihot_item_0001',
    scanned: 1,
    updated: 1,
    skipped: 0,
    done: false,
    advancedAt: new Date(NOW + 1)
  });
  const stale = await repository.advanceSearchTokenBackfill({
    targetVersion: SEARCH_TOKEN_VERSION,
    expectedCursor: '',
    nextCursor: 'aihot_item_9999',
    scanned: 1,
    updated: 1,
    skipped: 0,
    done: false,
    advancedAt: new Date(NOW + 2)
  });

  assert.equal(winner.advanced, true);
  assert.equal(stale.advanced, false);
  assert.equal(stale.state.searchTokenBackfillCursor, 'aihot_item_0001');
  assert.equal(stale.state.searchTokenBackfillScanned, 1);
});

test('quarantines a persistent poison document, exposes it, and keeps search usable', async () => {
  const poison = toStoredFeedItem(rawItem('search_poison_0001', '持续失败的旧资讯'), {
    provider: 'aihot',
    generation: 'g1',
    observedAt: new Date(NOW)
  });
  const healthy = toStoredFeedItem(rawItem('search_healthy_0002', '正常旧资讯'), {
    provider: 'aihot',
    generation: 'g1',
    observedAt: new Date(NOW)
  });
  [poison, healthy].forEach((document) => {
    delete document.searchTokenVersion;
    delete document.searchTokens;
  });
  const memory = memoryDatabase({
    knowledge_feed_items: [poison, healthy],
    knowledge_feed_sync_state: [{ _id: 'aihot_all' }]
  });
  const baseRepository = createFeedItemRepository(memory.db, CONFIG);
  let poisonWrites = 0;
  let failPoison = true;
  const itemRepository = {
    ...baseRepository,
    async backfillSearchTokens(documentId, updatedAt) {
      if (documentId === poison._id && failPoison) {
        poisonWrites += 1;
        throw Object.assign(new Error('stable malformed row'), { code: 'INVALID_STORED_ROW' });
      }
      return baseRepository.backfillSearchTokens(documentId, updatedAt);
    }
  };
  const warnings = [];
  let currentTime = NOW;
  const service = createSearchTokenBackfillService({
    itemRepository,
    syncStateRepository: createFeedSyncStateRepository(memory.db, CONFIG),
    maintenanceToken: TOKEN,
    now: () => {
      currentTime += 10;
      return currentTime;
    },
    logger: { warn: (message, meta) => warnings.push({ message, meta }) }
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await service.runScheduled({ limit: 2 });
    assert.equal(result.done, false);
  }
  const scanFinished = await service.runScheduled({ limit: 2 });
  assert.equal(scanFinished.done, false);
  assert.equal(scanFinished.ready, true);
  assert.equal(scanFinished.blockedCount, 1);
  assert.deepEqual(scanFinished.blockedDocumentIds, [poison._id]);
  assert.equal(poisonWrites, 5);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].meta.newlyBlockedCount, 1);

  failPoison = false;
  const recovered = await service.runScheduled({ limit: 2 });
  assert.equal(recovered.done, true);
  assert.equal(recovered.ready, true);
  assert.equal(recovered.blockedCount, 0);
  assert.equal(
    memory.collections.get('knowledge_feed_items').get(poison._id).searchTokenVersion,
    SEARCH_TOKEN_VERSION
  );
});

test('does not quarantine a batch-wide database outage', async () => {
  const documents = Array.from({ length: 20 }, (_, index) => ({
    _id: `outage_${String(index).padStart(4, '0')}`
  }));
  let recorded = null;
  const service = createSearchTokenBackfillService({
    itemRepository: {
      listByIdCursor: async () => documents,
      backfillSearchTokens: async () => {
        throw Object.assign(new Error('database busy'), { code: 'DATABASE_BUSY' });
      }
    },
    syncStateRepository: {
      beginSearchTokenBackfill: async () => ({
        done: false,
        state: {
          searchTokenBackfillTargetVersion: SEARCH_TOKEN_VERSION,
          searchTokenBackfillCursor: ''
        }
      }),
      recordSearchTokenBackfillAttempt: async (input) => {
        recorded = input;
        return { recorded: true, state: {} };
      }
    },
    maintenanceToken: TOKEN
  });

  await assert.rejects(
    () => service.runScheduled({ limit: 20 }),
    { code: 'SEARCH_BACKFILL_BATCH_FAILED' }
  );
  assert.equal(recorded.failureCount, 20);
  assert.deepEqual(recorded.failures, []);
});
