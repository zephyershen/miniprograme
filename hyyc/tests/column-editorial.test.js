const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  COLUMN_TRACKS,
  COLUMN_LESSONS
} = require('../cloudfunctions/knowledgeFeed/content/column-lessons');
const {
  PRACTICAL_TRACKS,
  PRACTICAL_SUPPORT_NOTICE,
  PRACTICAL_LESSONS
} = require('../cloudfunctions/knowledgeFeed/content/practical-lessons');
const {
  COLUMN_MEDIA,
  findColumnMedia
} = require('../cloudfunctions/knowledgeFeed/content/ai-column-media');
const {
  createColumnContentService
} = require('../cloudfunctions/knowledgeFeed/services/column-content-service');
const {
  createColumnEditorialRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/column-editorial');
const {
  normalizeColumnCaseResult
} = require('../cloudfunctions/knowledgeFeed/adapters/intelligence-contracts');
const {
  weeklyColumnPeriod,
  registrableDomain,
  selectCandidates,
  evidenceIsSufficient,
  createColumnEditorialService
} = require('../cloudfunctions/knowledgeFeed/services/column-editorial-service');

const member = { entitlements: { aiColumn: true } };
const free = { entitlements: { aiColumn: false } };

function memoryColumnDb() {
  const stores = new Map();
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  function reference(name, id) {
    return {
      async get() {
        const value = store(name).get(id);
        if (!value) {
          const error = new Error('document not found');
          error.errCode = -1;
          throw error;
        }
        return { data: { ...value, _id: id } };
      },
      async set({ data }) {
        store(name).set(id, { ...data });
      },
      async update({ data }) {
        const current = store(name).get(id);
        if (!current) throw new Error('document not found');
        store(name).set(id, { ...current, ...data });
      }
    };
  }
  function collection(name) {
    return { doc: (id) => reference(name, id) };
  }
  return {
    stores,
    createCollection: async (name) => { store(name); },
    collection,
    runTransaction: async (operation) => operation({ collection })
  };
}

function contentRepository() {
  return {
    latestCase: async () => ({
      _id: 'column_case_20260713_20260719',
      title: '一件值得关注的变化',
      conclusion: '先看自己的真实任务，不必追逐每次发布。',
      dossierKey: 'search-research',
      publishedAt: new Date('2026-07-20T00:20:00.000Z'),
      sources: [{ itemId: 'a' }],
      status: 'published'
    }),
    listDossiers: async () => [],
    listCases: async () => ({ items: [], hasMore: false, nextCursor: '' }),
    getCase: async () => null,
    getDossier: async () => null,
    listEvents: async () => []
  };
}

test('ships a conversational four-track, twenty-four course curriculum from the server package', () => {
  assert.equal(COLUMN_TRACKS.length, 4);
  assert.equal(COLUMN_LESSONS.length, 24);
  assert.equal(new Set(COLUMN_LESSONS.map((item) => item.id)).size, 24);
  assert.deepEqual([...new Set(COLUMN_LESSONS.map((item) => item.track))],
    COLUMN_TRACKS.map((item) => item.key));
  COLUMN_LESSONS.forEach((lesson) => {
    assert.ok(lesson.title && lesson.subtitle && lesson.duration);
    assert.equal(lesson.visual.nodes.length, 4);
    assert.ok(lesson.sections.summary);
    assert.ok(lesson.sections.scenario);
    assert.ok(lesson.sections.steps.length >= 3);
    assert.ok(lesson.sections.pitfalls.length >= 2);
    assert.ok(lesson.sections.avoid);
    assert.match(lesson.sections.takeaway, /^记住这一句：/);
    assert.equal(lesson.kind, 'course');
  });
});

test('ships exactly six protected practical lessons with official references and safe steps', () => {
  assert.equal(PRACTICAL_TRACKS.length, 3);
  assert.deepEqual(PRACTICAL_LESSONS.map((item) => item.id), [
    'codex-cli-install',
    'codex-cli-first-task',
    'claude-code-install',
    'claude-code-first-task',
    'api-key-safety',
    'mcp-connect'
  ]);
  PRACTICAL_LESSONS.forEach((lesson) => {
    assert.equal(lesson.kind, 'practical');
    assert.equal(lesson.verifiedAt, '2026-07-21');
    assert.equal(lesson.visual, undefined);
    assert.equal(lesson.sections.scenario, undefined);
    assert.ok(lesson.sections.steps.length >= 3);
    assert.ok(lesson.sections.pitfalls.length >= 2);
    assert.ok(lesson.sections.takeaway);
    assert.doesNotMatch(JSON.stringify({
      subtitle: lesson.subtitle,
      sections: lesson.sections
    }), /举个例子|例如|比如|这像|就像/);
    assert.ok(lesson.sources.length >= 1);
    lesson.sources.forEach((source) => assert.match(source.url, /^https:\/\//));
  });
  ['codex-cli-install', 'claude-code-install'].forEach((id) => {
    const lesson = PRACTICAL_LESSONS.find((item) => item.id === id);
    assert.deepEqual(lesson.platformGuides.map((guide) => guide.label),
      id === 'codex-cli-install' ? ['Windows', 'macOS', 'Linux'] : ['Windows', 'macOS', 'Linux / WSL']);
    lesson.platformGuides.forEach((guide) => {
      assert.ok(guide.commands.length >= 1);
      assert.ok(guide.steps.length >= 4);
    });
  });
  assert.match(PRACTICAL_SUPPORT_NOTICE.copy, /私聊微信/);
  assert.match(PRACTICAL_SUPPORT_NOTICE.copy, /不另收费/);
  assert.match(PRACTICAL_SUPPORT_NOTICE.exclusions, /API 调用/);
  assert.match(PRACTICAL_SUPPORT_NOTICE.exclusions, /不包含/);
});

test('maps a complete three-page handdrawn set to all 24 courses', () => {
  assert.deepEqual(
    COLUMN_MEDIA.map((item) => item.id),
    COLUMN_LESSONS.map((lesson) => lesson.id)
  );
  assert.equal(COLUMN_MEDIA.length, 24);
  COLUMN_MEDIA.forEach((entry, lessonIndex) => {
    const lesson = COLUMN_LESSONS[lessonIndex];
    assert.equal(entry.id, lesson.id);
    assert.equal(entry.posters.length, 3);
    assert.equal(new Set(entry.posters.map((poster) => poster.fileId)).size, 3);
    entry.posters.forEach((poster, index) => {
      assert.match(
        poster.fileId,
        new RegExp(`/ai-column/posters-hd/v2/${String(lesson.order).padStart(2, '0')}-${entry.id}-0${index + 1}\\.jpg$`)
      );
    });
    assert.equal(findColumnMedia(entry.id), entry);
  });
  assert.equal(findColumnMedia('not-a-course'), null);
});

test('column home v4 returns only course and practical content categories without legacy queries', async () => {
  let tempCalls = 0;
  let legacyQueries = 0;
  const repository = contentRepository();
  repository.latestCase = async () => { legacyQueries += 1; return null; };
  repository.listDossiers = async () => { legacyQueries += 1; return []; };
  const service = createColumnContentService({
    repository,
    getTempFileURL: async () => { tempCalls += 1; return { fileList: [] }; }
  });
  const home = await service.home(free);
  assert.equal(home.contractVersion, 4);
  assert.equal(home.access.locked, true);
  assert.equal(home.courses.length, 24);
  assert.equal(home.practicals.length, 6);
  assert.equal(home.courses[0].sections, undefined);
  assert.equal(home.courses[0].subtitle, undefined);
  assert.equal(home.practicals[0].sections, undefined);
  assert.equal(home.practicals[0].subtitle, undefined);
  assert.equal(home.courseTracks[0].summary, undefined);
  assert.equal(home.practicalTracks[0].note, undefined);
  assert.equal(home.lessons, undefined);
  assert.equal(home.latestCase, undefined);
  assert.equal(home.dossiers, undefined);
  assert.match(home.practicalSupport.copy, /不另收费/);
  assert.ok(Buffer.byteLength(JSON.stringify(home), 'utf8') < 20 * 1024);
  assert.equal(tempCalls, 0);
  assert.equal(legacyQueries, 0);

  const memberHome = await service.home(member);
  assert.ok(memberHome.courses[0].subtitle);
  assert.ok(memberHome.practicals[0].subtitle);
  assert.ok(memberHome.courseTracks[0].summary);
  assert.ok(memberHome.practicalTracks[0].note);
});

test('column detail stays server protected and signs handdrawn media only for matching member lessons', async () => {
  const signed = [];
  const service = createColumnContentService({
    repository: contentRepository(),
    getTempFileURL: async ({ fileList }) => {
      signed.push([...fileList]);
      return {
        fileList: fileList.map((fileID) => ({
          fileID,
          status: 0,
          tempFileURL: `https://media.example/${fileID.split('/').pop()}`
        }))
      };
    }
  });
  await assert.rejects(() => service.lesson('model-basics', free), (error) => {
    assert.equal(error.code, 'ENTITLEMENT_REQUIRED');
    assert.equal(error.details.featureKey, 'ai_column');
    return true;
  });
  const lesson = await service.lesson('model-basics', member);
  assert.equal(lesson.id, 'model-basics');
  assert.ok(lesson.sections.takeaway);
  assert.equal(lesson.illustrationUrl, '');
  assert.equal(lesson.posters.length, 3);
  assert.equal(signed.length, 1);
  assert.equal(signed[0].length, 3);

  const illustrated = await service.lesson('context', member);
  assert.equal(signed.length, 2);
  assert.equal(signed[1].length, 3);
  assert.deepEqual(illustrated.posters.map((poster) => poster.key), [
    'context-1', 'context-2', 'context-3'
  ]);
  assert.match(illustrated.posters[0].image, /02-context-01\.jpg$/);
  assert.equal(illustrated.posters[0].previewImage, illustrated.posters[0].image);
});

test('legacy column response signs all 72 posters in storage-safe batches', async () => {
  const batchSizes = [];
  const service = createColumnContentService({
    repository: contentRepository(),
    getTempFileURL: async ({ fileList }) => {
      batchSizes.push(fileList.length);
      return {
        fileList: fileList.map((fileID) => ({
          fileID,
          status: 0,
          tempFileURL: `https://media.example/${fileID.split('/').pop()}`
        }))
      };
    }
  });
  const response = await service.get(member);
  assert.deepEqual(batchSizes, [50, 22]);
  assert.equal(response.lessons.length, 24);
  assert.equal(response.lessons.flatMap((lesson) => lesson.posters).length, 72);
});

test('practical detail is protected, clone-safe and carries commands, sources and support', async () => {
  const service = createColumnContentService({
    repository: contentRepository(),
    getTempFileURL: async () => ({ fileList: [] })
  });
  await assert.rejects(() => service.practical('codex-cli-install', free), (error) => {
    assert.equal(error.code, 'ENTITLEMENT_REQUIRED');
    assert.equal(error.details.featureKey, 'ai_column');
    return true;
  });
  const value = await service.practical('codex-cli-install', member);
  assert.equal(value.id, 'codex-cli-install');
  assert.equal(value.kind, 'practical');
  assert.ok(value.commands.some((item) => item.command === 'codex --version'));
  assert.ok(value.sources.some((item) => item.url.includes('openai/codex')));
  assert.match(value.support.copy, /私聊微信/);
  assert.match(value.support.exclusions, /第三方费用/);
  assert.notEqual(value.commands, PRACTICAL_LESSONS[0].commands);
  assert.notEqual(value.platformGuides, PRACTICAL_LESSONS[0].platformGuides);
  assert.notEqual(value.platformGuides[0].commands, PRACTICAL_LESSONS[0].platformGuides[0].commands);
  assert.notEqual(value.sections.steps, PRACTICAL_LESSONS[0].sections.steps);
  await assert.rejects(() => service.practical('missing', member), (error) => {
    assert.equal(error.code, 'ITEM_NOT_FOUND');
    return true;
  });
});

test('knowledge feed router exposes the new practical action and retains legacy actions', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../cloudfunctions/knowledgeFeed/index.js'), 'utf8');
  assert.match(source, /columnPractical:\s*async/);
  assert.match(source, /columnContentService\.practical\(event\.practicalId/);
  assert.match(source, /columnCases:\s*async/);
  assert.match(source, /columnCase:\s*async/);
  assert.match(source, /trendDossier:\s*async/);
});

test('weekly column uses the previous seven complete Shanghai calendar days', () => {
  const period = weeklyColumnPeriod(Date.parse('2026-07-20T00:20:00.000Z'));
  assert.equal(period.periodKey, '20260713_20260719');
  assert.equal(period.windowStart.toISOString(), '2026-07-12T16:00:00.000Z');
  assert.equal(period.windowEnd.toISOString(), '2026-07-19T16:00:00.000Z');
  const tuesdayRetry = weeklyColumnPeriod(Date.parse('2026-07-21T03:20:00.000Z'));
  assert.deepEqual(tuesdayRetry, period);
});

test('weekly case contract rejects invented sources and dossier keys', () => {
  const raw = {
    publish: true, reason: '',
    title: '标题', conclusion: '结论', happened: '事实', impact: '影响',
    tryNow: ['先小范围验证'], noNeedToWorry: '不必一次迁移',
    dossierKey: 'search-research',
    relatedLessonIds: ['research', 'invented-lesson'],
    sourceItemIds: ['allowed-source', 'invented-source']
  };
  const normalized = normalizeColumnCaseResult(raw, {
    allowedItemIds: ['allowed-source'],
    allowedDossierKeys: ['search-research'],
    allowedLessonIds: ['research']
  });
  assert.deepEqual(normalized.sourceItemIds, ['allowed-source']);
  assert.deepEqual(normalized.relatedLessonIds, ['research']);
  assert.throws(() => normalizeColumnCaseResult({ ...raw, dossierKey: 'invented' }, {
    allowedItemIds: ['allowed-source'],
    allowedDossierKeys: ['search-research'],
    allowedLessonIds: ['research']
  }), /INTELLIGENCE_COLUMN_CASE_INVALID/);
});

test('weekly case contract supports an explicit evidence-based abstention', () => {
  const normalized = normalizeColumnCaseResult({
    publish: false,
    reason: '只有重复转载，无法形成可靠判断'
  });
  assert.deepEqual(normalized, {
    publish: false,
    reason: '只有重复转载，无法形成可靠判断'
  });
});

test('candidate policy removes repeated and low-quality entries and enforces source evidence', () => {
  const config = { minimumCurationScore: 75, sourceLimit: 24, singleSourceMinimumScore: 85 };
  const items = [
    { id: 'a', title: '同一变化', publicState: 'active', qualityTier: 'curated', curationScore: 90, url: 'https://one.example/a' },
    { id: 'b', title: '同一变化！', publicState: 'active', qualityTier: 'curated', curationScore: 88, url: 'https://two.example/b' },
    { id: 'c', title: '低质量', publicState: 'active', qualityTier: 'curated', curationScore: 70, url: 'https://three.example/c' },
    { id: 'd', title: '另一变化', publicState: 'active', qualityTier: 'curated', curationScore: 80, url: 'https://two.example/d' }
  ];
  const selected = selectCandidates(items, config);
  assert.deepEqual(selected.map((item) => item.id), ['a', 'd']);
  assert.equal(evidenceIsSufficient({ sourceItemIds: ['d'] }, selected, config), false);
  assert.equal(evidenceIsSufficient({ sourceItemIds: ['a'] }, selected, config), true);
  assert.equal(evidenceIsSufficient({ sourceItemIds: ['a', 'd'] }, selected, config), true);
  assert.equal(registrableDomain('news.example.com'), 'example.com');
  assert.equal(registrableDomain('labs.example.com.cn'), 'example.com.cn');
});

test('weekly column publishes once, records a trend event and reuses the period idempotently', async () => {
  const stored = new Map();
  const events = [];
  const repository = {
    getCase: async (id) => stored.get(id) || null,
    claimCase: async (document, options) => {
      const current = stored.get(document._id);
      if (current && current.status === 'published') {
        return { acquired: false, reason: 'published', document: current };
      }
      if (current && current.generationLeaseOwner) {
        return { acquired: false, reason: 'leased', document: current };
      }
      stored.set(document._id, {
        ...document,
        status: 'generating',
        generationLeaseOwner: options.owner
      });
      return { acquired: true, owner: options.owner };
    },
    publishCaseWithTrend: async (document, owner) => {
      const current = stored.get(document._id);
      assert.equal(current.generationLeaseOwner, owner);
      const next = { ...document, status: 'published', generationLeaseOwner: '' };
      stored.set(document._id, next);
      const event = {
        _id: `trend_event_${document.dossierKey}_${document.periodKey}`,
        dossierKey: document.dossierKey,
        caseId: document._id
      };
      const index = events.findIndex((item) => item._id === event._id);
      if (index >= 0) events[index] = event;
      else events.push(event);
      return next;
    },
    ensureTrendProjection: async () => true,
    markCaseSkipped: async (id, owner) => {
      const current = stored.get(id);
      if (current && current.generationLeaseOwner === owner) {
        stored.set(id, { ...current, status: 'skipped', generationLeaseOwner: '' });
      }
      return true;
    },
    markCaseFailed: async (id, owner) => {
      const current = stored.get(id);
      if (current && current.generationLeaseOwner === owner) {
        stored.set(id, { ...current, status: 'retry', generationLeaseOwner: '' });
      }
      return true;
    }
  };
  const items = [
    { id: 'a', title: '变化 A', summary: 'A', source: '来源一', url: 'https://one.example/a', publicState: 'active', qualityTier: 'curated', curationScore: 90 },
    { id: 'b', title: '变化 B', summary: 'B', source: '来源二', url: 'https://two.example/b', publicState: 'active', qualityTier: 'curated', curationScore: 88 },
    { id: 'c', title: '变化 C', summary: 'C', source: '来源三', url: 'https://three.example/c', publicState: 'active', qualityTier: 'curated', curationScore: 80 }
  ];
  let generated = 0;
  const service = createColumnEditorialService({
    provider: {
      enabled: true,
      generateColumnCase: async () => {
        generated += 1;
        return {
          publish: true,
          reason: '',
          title: '本周真正值得理解的一件事',
          conclusion: '变化已经能进入部分工作，但不必立刻替换全部流程。',
          happened: '三个来源记录了同一方向的能力变化。',
          impact: '普通职场人可以先从一个低风险任务开始验证。',
          tryNow: ['选择一个可复核的小任务做前后对比。'],
          noNeedToWorry: '新能力并不会让所有旧方法立刻失效。',
          dossierKey: 'search-research',
          relatedLessonIds: ['research'],
          sourceItemIds: ['a', 'b'],
          provider: 'test', model: 'test', usage: null
        };
      }
    },
    repository,
    itemRepository: { queryPage: async () => ({ items }) },
    config: {
      sourceLimit: 24,
      sourceScanPages: 3,
      minimumCandidates: 3,
      minimumCurationScore: 75,
      singleSourceMinimumScore: 85,
      generationLeaseMs: 600000
    },
    now: () => Date.parse('2026-07-20T00:20:00.000Z')
  });
  const first = await service.run();
  const second = await service.run();
  assert.equal(first.status, 'generated');
  assert.equal(second.status, 'current');
  assert.equal(generated, 1);
  assert.equal(stored.size, 1);
  assert.equal(events.length, 1);
  const document = [...stored.values()][0];
  assert.equal(document.intelligenceProvider, 'test');
  assert.deepEqual(document.sourceItemIds, ['a', 'b']);
});

test('weekly column records an evidence abstention without publishing an article', async () => {
  let skipped = null;
  let published = false;
  const items = [
    { id: 'a', title: 'Change A', source: 'One', url: 'https://one.example/a', publicState: 'active', qualityTier: 'curated', curationScore: 90 },
    { id: 'b', title: 'Change B', source: 'Two', url: 'https://two.example/b', publicState: 'active', qualityTier: 'curated', curationScore: 88 },
    { id: 'c', title: 'Change C', source: 'Three', url: 'https://three.example/c', publicState: 'active', qualityTier: 'curated', curationScore: 80 }
  ];
  const service = createColumnEditorialService({
    provider: {
      enabled: true,
      generateColumnCase: async () => ({ publish: false, reason: 'duplicate-secondary-sources' })
    },
    repository: {
      getCase: async () => null,
      claimCase: async (_document, options) => ({ acquired: true, owner: options.owner }),
      markCaseSkipped: async (id, owner, reason) => { skipped = { id, owner, reason }; },
      publishCaseWithTrend: async () => { published = true; },
      markCaseFailed: async () => true
    },
    itemRepository: { queryPage: async () => ({ items, hasMore: false, nextCursor: '' }) },
    config: {
      sourceLimit: 24,
      sourceScanPages: 3,
      minimumCandidates: 3,
      minimumCurationScore: 75,
      singleSourceMinimumScore: 85,
      generationLeaseMs: 600000
    },
    now: () => Date.parse('2026-07-20T00:20:00.000Z')
  });

  const result = await service.run();
  assert.equal(result.status, 'insufficient-evidence');
  assert.equal(skipped.id, 'column_case_20260713_20260719');
  assert.equal(skipped.reason, 'duplicate-secondary-sources');
  assert.equal(published, false);
});

test('repository leases one weekly generation and atomically publishes its trend projection', async () => {
  const db = memoryColumnDb();
  const config = {
    casesCollectionName: 'cases',
    dossiersCollectionName: 'dossiers',
    eventsCollectionName: 'events',
    generationLeaseMs: 600000,
    casePageSize: 8,
    caseMaxPageSize: 20,
    dossierEventLimit: 100
  };
  const repository = createColumnEditorialRepository(db, config);
  const seed = {
    _id: 'column_case_20260713_20260719',
    periodKey: '20260713_20260719',
    windowStart: new Date('2026-07-12T16:00:00.000Z'),
    windowEnd: new Date('2026-07-19T16:00:00.000Z')
  };
  const claimed = await repository.claimCase(seed, {
    owner: 'worker-one',
    currentTime: new Date('2026-07-20T00:20:00.000Z')
  });
  assert.equal(claimed.acquired, true);
  const duplicate = await repository.claimCase(seed, {
    owner: 'worker-two',
    currentTime: new Date('2026-07-20T00:20:01.000Z')
  });
  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.reason, 'leased');

  await assert.rejects(() => repository.publishCaseWithTrend({
    ...seed,
    title: '错误发布',
    dossierKey: 'search-research'
  }, 'worker-two'), /COLUMN_GENERATION_LEASE_LOST/);

  const published = await repository.publishCaseWithTrend({
    ...seed,
    title: '可靠案例',
    conclusion: '先从小范围验证。',
    dossierKey: 'search-research',
    sourceItemIds: ['a', 'b'],
    sources: [{ itemId: 'a' }, { itemId: 'b' }],
    publishedAt: new Date('2026-07-20T00:21:00.000Z'),
    updatedAt: new Date('2026-07-20T00:21:00.000Z')
  }, 'worker-one');
  assert.equal(published.status, 'published');
  assert.equal(db.stores.get('events').size, 1);
  assert.equal(db.stores.get('dossiers').get('trend_dossier_search-research').eventCount, 1);
  const afterPublish = await repository.claimCase(seed, {
    owner: 'worker-three',
    currentTime: new Date('2026-07-20T00:22:00.000Z')
  });
  assert.equal(afterPublish.reason, 'published');
});
