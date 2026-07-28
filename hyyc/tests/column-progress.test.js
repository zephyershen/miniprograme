const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  progressDocumentId,
  createColumnProgressRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/column-progress');
const {
  createColumnProgressService
} = require('../cloudfunctions/knowledgeFeed/services/column-progress-service');
const {
  applyColumnProgress,
  readingProgressPercent,
  createProgressMutationId
} = require('../features/ai-column/progress');
const {
  createProgressReporter
} = require('../features/ai-column/progress-reporter');

const OWNER_KEY = 'a'.repeat(64);
const OTHER_OWNER_KEY = 'b'.repeat(64);
const member = { entitlements: { aiColumn: true } };
const free = { entitlements: { aiColumn: false } };

function memoryProgressDatabase() {
  const documents = new Map();
  function documentReference(id) {
    return {
      async get() {
        if (!documents.has(id)) {
          const error = new Error('DOCUMENT_NOT_FOUND');
          error.errCode = -1;
          throw error;
        }
        return { data: { ...documents.get(id) } };
      },
      async set({ data }) {
        documents.set(id, { ...data });
      }
    };
  }
  return {
    documents,
    async createCollection() {},
    collection() {
      throw new Error('list query not expected in this test');
    },
    runTransaction(operation) {
      return operation({
        collection() {
          return { doc: documentReference };
        }
      });
    }
  };
}

test('uses an owner-scoped deterministic document id and rejects forged identities', () => {
  const first = progressDocumentId(OWNER_KEY, 'lesson', 'lesson_intro');
  assert.equal(first, progressDocumentId(OWNER_KEY, 'lesson', 'lesson_intro'));
  assert.notEqual(first, progressDocumentId(OTHER_OWNER_KEY, 'lesson', 'lesson_intro'));
  assert.notEqual(first, progressDocumentId(OWNER_KEY, 'practical', 'lesson_intro'));
  assert.throws(() => progressDocumentId('client-owner', 'lesson', 'lesson_intro'));
  assert.throws(() => progressDocumentId(OWNER_KEY, 'case', 'lesson_intro'));
});

test('persists monotonic progress transactionally and keeps the newest reading position', async () => {
  const db = memoryProgressDatabase();
  const repository = createColumnProgressRepository(db, {
    progressCollectionName: 'knowledge_column_progress'
  });
  const first = await repository.save(OWNER_KEY, {
    entryType: 'lesson',
    entryId: 'lesson_intro',
    progressPercent: 65,
    lastPosterIndex: 1205,
    publishedRevision: 2,
    mutationId: 'progress-first-1'
  }, '2026-07-27T08:00:00.000Z');
  const second = await repository.save(OWNER_KEY, {
    entryType: 'lesson',
    entryId: 'lesson_intro',
    progressPercent: 20,
    lastPosterIndex: 2,
    publishedRevision: 2,
    mutationId: 'progress-second-1'
  }, '2026-07-27T09:00:00.000Z');
  const duplicate = await repository.save(OWNER_KEY, {
    entryType: 'lesson',
    entryId: 'lesson_intro',
    progressPercent: 100,
    lastPosterIndex: 8,
    publishedRevision: 2,
    mutationId: 'progress-second-1'
  }, '2026-07-27T10:00:00.000Z');

  assert.equal(first.progressPercent, 65);
  assert.equal(first.lastPosterIndex, 1205);
  assert.equal(second.progressPercent, 65);
  assert.equal(second.lastPosterIndex, 2);
  assert.equal(duplicate.progressPercent, 65);
  assert.equal(duplicate.lastReadAt, '2026-07-27T09:00:00.000Z');
});

test('rechecks Pro entitlement, derives the owner server-side, and verifies a published entry', async () => {
  const saves = [];
  const service = createColumnProgressService({
    repository: {
      async list() {
        return [];
      },
      async save(ownerKey, value, updatedAt) {
        saves.push({ ownerKey, value, updatedAt });
        return { ownerKey, ...value, lastReadAt: updatedAt };
      }
    },
    catalogService: {
      async publishedEntry(id, kind) {
        return id === 'lesson_intro' && kind === 'course'
          ? { publishedRevision: 7, revision: 99 }
          : null;
      }
    },
    now: () => Date.parse('2026-07-27T08:00:00.000Z')
  });

  await assert.rejects(
    () => service.save({
      entryType: 'lesson',
      entryId: 'lesson_intro',
      progressPercent: 10,
      mutationId: 'progress-free-1'
    }, { ownerKey: OWNER_KEY }, free),
    (error) => error.code === 'ENTITLEMENT_REQUIRED'
  );
  const result = await service.save({
    ownerKey: OTHER_OWNER_KEY,
    entryType: 'lesson',
    entryId: 'lesson_intro',
    progressPercent: 42,
    lastPosterIndex: 3,
    mutationId: 'progress-member-1'
  }, { ownerKey: OWNER_KEY }, member);

  assert.equal(saves.length, 1);
  assert.equal(saves[0].ownerKey, OWNER_KEY);
  assert.equal(saves[0].value.publishedRevision, 7);
  assert.equal(result.item.progressPercent, 42);
  assert.equal(Object.hasOwn(result.item, 'ownerKey'), false);
  await assert.rejects(
    () => service.save({
      entryType: 'practical',
      entryId: 'lesson_intro',
      progressPercent: 20,
      mutationId: 'progress-wrong-kind-1'
    }, { ownerKey: OWNER_KEY }, member),
    (error) => error.code === 'ITEM_NOT_FOUND'
  );
});

test('decorates the live catalog with completion, overall progress, and newest resume target', () => {
  const home = applyColumnProgress({
    lessons: [
      { id: 'lesson_a', title: '第一课' },
      { id: 'lesson_b', title: '第二课' }
    ],
    courseGroups: [{
      key: 'understand',
      lessons: [
        { id: 'lesson_a', title: '第一课' },
        { id: 'lesson_b', title: '第二课' }
      ]
    }],
    practicals: [{ id: 'practical_a', title: '动手课' }]
  }, {
    items: [
      {
        entryType: 'lesson',
        entryId: 'lesson_b',
        progressPercent: 45,
        lastPosterIndex: 4,
        lastReadAt: '2026-07-27T09:00:00.000Z'
      },
      {
        entryType: 'lesson',
        entryId: 'lesson_a',
        progressPercent: 100,
        completed: true,
        lastReadAt: '2026-07-27T08:00:00.000Z'
      }
    ]
  });

  assert.equal(home.lessons[0].progressLabel, '已完成');
  assert.equal(home.courseGroups[0].lessons[1].progressLabel, '已读 45%');
  assert.deepEqual(home.progressSummary, {
    totalCount: 3,
    startedCount: 2,
    completedCount: 1,
    overallPercent: 48,
    resume: {
      id: 'lesson_b',
      type: 'lesson',
      title: '第二课',
      progressLabel: '已读 45%',
      lastPosterIndex: 4
    }
  });
  assert.equal(readingProgressPercent(1200, 1201), 65);
  assert.match(createProgressMutationId(1, .5), /^column_progress_[a-z0-9_]+$/);
});

test('coalesces rapid reader updates and never lets progress persistence break reading', async () => {
  const saves = [];
  const reporter = createProgressReporter({
    save: async (value) => {
      saves.push(value);
      if (saves.length === 1) throw new Error('temporary failure');
    },
    mutationId: (() => {
      let sequence = 0;
      return () => `progress-test-${++sequence}`;
    })(),
    setTimer: () => 1,
    clearTimer: () => {}
  });

  await reporter.report({
    entryType: 'lesson',
    entryId: 'lesson_a',
    progressPercent: 20,
    lastPosterIndex: 1
  });
  await reporter.report({
    entryType: 'lesson',
    entryId: 'lesson_a',
    progressPercent: 55,
    lastPosterIndex: 4
  });
  await reporter.flush();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].progressPercent, 55);
  assert.equal(saves[0].lastPosterIndex, 4);

  await reporter.report({
    entryType: 'lesson',
    entryId: 'lesson_a',
    progressPercent: 100,
    lastPosterIndex: 4
  }, { immediate: true });
  assert.equal(saves.length, 2);
  assert.equal(saves[1].progressPercent, 100);
  await reporter.dispose();
});

test('registers protected progress actions, ADMINONLY storage, and reader/catalog UI', () => {
  const backend = fs.readFileSync(path.join(
    __dirname,
    '..',
    'cloudfunctions',
    'knowledgeFeed',
    'index.js'
  ), 'utf8');
  assert.match(backend, /\bcolumnProgressList\b/);
  assert.match(backend, /\bcolumnProgressSave\b/);

  const rules = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'cloud-database-rules.json'
  ), 'utf8'));
  assert.ok(rules.collections.includes('knowledge_column_progress'));

  const indexes = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'cloud-database-indexes.json'
  ), 'utf8'));
  assert.ok(indexes.indexes.some((index) => (
    index.collection === 'knowledge_column_progress'
    && index.name === 'owner_last_read_at'
  )));

  const reader = fs.readFileSync(path.join(__dirname, '..', 'pages', 'column-reader', 'index.js'), 'utf8');
  const catalog = fs.readFileSync(path.join(__dirname, '..', 'pages', 'curated', 'index.wxml'), 'utf8');
  assert.match(reader, /onReachBottom\(\)/);
  assert.match(reader, /!page\.adminPreview/);
  assert.match(catalog, /继续学习/);
  assert.match(catalog, /progressLabel/);
});
