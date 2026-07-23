const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAihotFeedEnrichmentAdapter,
  normalizedAvatarProxy,
  normalizedMediaProxy
} = require('../cloudfunctions/knowledgeFeed/adapters/aihot-feed-enrichment');
const { createAihotSource } = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const {
  contentHash,
  toStoredFeedItem
} = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const { publicItem } = require('../cloudfunctions/knowledgeFeed/presenters/public-feed');
const {
  createSourceMetadataEnrichmentService
} = require('../cloudfunctions/knowledgeFeed/services/source-metadata-enrichment-service');
const {
  createSourceProfileRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/source-profile');
const {
  createFeedItemRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-item');

const ITEM_ID = 'cmrubsrb40pmibi7fbaczxjbl';
const ITEM_URL = 'https://x.com/rohanpaul_ai/status/2079465855797334131';
const AVATAR_PROXY = '/api/img-proxy?u=https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1816185267037859840%2FFd18CH0v_normal.jpg&mode=avatar&exp=1784700000&sig=abc123';
const MEDIA_PROXY = '/api/img-proxy?u=https%3A%2F%2Fpbs.twimg.com%2Fmedia%2FHNyVaxRXIAAi6Eb.jpg%3Fname%3Dorig&mode=full&exp=1784700000&sig=media123';

function rawSourceItem(overrides = {}) {
  return {
    id: ITEM_ID,
    title: 'AI 护城河转向专有数据',
    title_en: 'The AI moat is proprietary data',
    summary: '真正的竞争壁垒是独家专有数据集。',
    url: ITEM_URL,
    permalink: `https://aihot.virxact.com/items/${ITEM_ID}`,
    source: 'X：Rohan Paul (@rohanpaul_ai)',
    publishedAt: '2026-07-21T07:17:00.000Z',
    category: 'tip',
    score: 70,
    selected: false,
    attribution: {
      source: 'AI HOT',
      canonical: `https://aihot.virxact.com/items/${ITEM_ID}`
    },
    ...overrides
  };
}

function feedEntry(overrides = {}) {
  return {
    id: ITEM_ID,
    aiTags: [{ tag: '开源生态' }, { tag: '现象/趋势' }, { tag: '部署/工程' }],
    xDisplay: { authorName: 'Rohan Paul', screenName: 'rohanpaul_ai' },
    xAvatarProxied: AVATAR_PROXY,
    ...overrides
  };
}

function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => '' },
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

test('loads isolated AI HOT feed metadata by stable id and validates X avatar hosts', async () => {
  const urls = [];
  const adapter = createAihotFeedEnrichmentAdapter({
    feedRoot: 'https://aihot.virxact.com/api/public/feed',
    timeoutMs: 1000,
    maxPages: 2
  }, async (url) => {
    urls.push(url);
    return jsonResponse({
      items: [feedEntry()],
      hasNext: false,
      nextCursor: null
    });
  });
  const loaded = await adapter.loadForItems([{ id: ITEM_ID, url: ITEM_URL }], { mode: 'all' });
  assert.match(urls[0], /\/api\/public\/feed\?mode=all/);
  assert.deepEqual(loaded.get(ITEM_ID).sourceIdentity, {
    platform: 'x',
    displayName: 'Rohan Paul',
    handle: 'rohanpaul_ai'
  });
  assert.deepEqual(loaded.get(ITEM_ID).sourceTags, ['开源生态', '现象/趋势', '部署/工程']);
  assert.match(loaded.get(ITEM_ID).avatarProxyUrl, /^https:\/\/aihot\.virxact\.com\/api\/img-proxy\?/);
  assert.equal(loaded.get(ITEM_ID).avatarSourceHash.length, 64);

  assert.throws(() => normalizedAvatarProxy(
    '/api/img-proxy?u=https%3A%2F%2Fevil.test%2Favatar.jpg&mode=avatar',
    new URL('https://aihot.virxact.com/api/public/feed')
  ), /FEED_ENRICHMENT_AVATAR_HOST_INVALID/);

  const mismatched = createAihotFeedEnrichmentAdapter({
    feedRoot: 'https://aihot.virxact.com/api/public/feed',
    timeoutMs: 1000
  }, async () => jsonResponse({
    items: [feedEntry({
      xDisplay: { authorName: 'Another author', screenName: 'another_author' }
    })],
    hasNext: false
  }));
  await assert.rejects(
    () => mismatched.loadForItems([{ id: ITEM_ID, url: ITEM_URL }]),
    /FEED_ENRICHMENT_IDENTITY_MISMATCH/
  );
});

test('validates native AI HOT photo proxies and stores them before screenshot fallback', async () => {
  const adapter = createAihotFeedEnrichmentAdapter({
    feedRoot: 'https://aihot.virxact.com/api/public/feed',
    timeoutMs: 1000
  }, async (url) => {
    if (String(url).includes('/api/public/feed')) return jsonResponse({
      items: [feedEntry({
        xMediaProxied: Array.from({ length: 6 }, (_, index) => ({
          type: 'photo',
          fullSrc: MEDIA_PROXY,
          width: 995 + index,
          height: 904
        }))
      })],
      hasNext: false
    });
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'content-type' ? 'image/jpeg' : '4' },
      arrayBuffer: async () => Buffer.from('photo')
    };
  });
  const metadata = (await adapter.loadForItems([{ id: ITEM_ID, url: ITEM_URL }])).get(ITEM_ID);
  assert.equal(metadata.sourceMedia.length, 6);
  assert.equal(metadata.sourceMedia[0].width, 995);
  assert.match(metadata.sourceMedia[0].proxyUrl, /mode=full/);
  assert.equal((await adapter.downloadMedia(metadata.sourceMedia[0].proxyUrl)).buffer.toString(), 'photo');
  assert.throws(() => normalizedMediaProxy(
    '/api/img-proxy?u=https%3A%2F%2Fevil.test%2Fimage.jpg&mode=full',
    new URL('https://aihot.virxact.com/api/public/feed')
  ), /FEED_ENRICHMENT_MEDIA_HOST_INVALID/);

  let mediaDownloads = 0;
  const service = createSourceMetadataEnrichmentService({
    adapter: {
      loadForItems: async () => new Map([[ITEM_ID, metadata]]),
      downloadAvatar: async () => ({ buffer: Buffer.from('avatar'), extension: 'jpg' }),
      downloadMedia: async () => {
        mediaDownloads += 1;
        return { buffer: Buffer.from('photo'), extension: 'jpg' };
      }
    },
    profileRepository: { getMany: async () => new Map(), save: async () => null },
    itemRepository: { getManyByItemIds: async () => [] },
    cloud: {
      uploadFile: async ({ cloudPath }) => ({ fileID: `cloud://env.bucket/${cloudPath}` })
    },
    logger: { warn() {} }
  });
  const enriched = await service.enrichItems([{ id: ITEM_ID, url: ITEM_URL }]);
  assert.equal(mediaDownloads, 6);
  assert.equal(enriched[0].previewFileIds.length, 6);
  assert.match(enriched[0].previewFileIds[0], /knowledge-previews\/source\/aihot-media/);
  assert.equal(enriched[0].previewStatus, 'ready');

  const cachedService = createSourceMetadataEnrichmentService({
    adapter: {
      loadForItems: async () => new Map([[ITEM_ID, metadata]]),
      downloadAvatar: async () => ({ buffer: Buffer.from('avatar'), extension: 'jpg' }),
      downloadMedia: async () => { throw new Error('must not download'); }
    },
    profileRepository: { getMany: async () => new Map(), save: async () => null },
    itemRepository: {
      getManyByItemIds: async () => [{ id: ITEM_ID, previewFileIds: ['cloud://existing'] }]
    },
    cloud: { uploadFile: async () => { throw new Error('must not upload'); } },
    logger: { warn() {} }
  });
  const cached = await cachedService.enrichItems([{ id: ITEM_ID, url: ITEM_URL }]);
  assert.equal(cached[0].previewFileIds, undefined);
});

test('keeps trusted AI HOT media visuals when source enrichment rejoins primary items', async () => {
  const source = createAihotSource({
    provider: 'aihot',
    apiRoot: 'https://source.test/items',
    fingerprintRoot: 'https://source.test/fingerprint',
    dailyIndexRoot: 'https://source.test/dailies',
    dailyRoot: 'https://source.test/daily',
    pageSize: 100,
    maxItems: 100,
    allMaxItems: 100,
    timeoutMs: 1000
  }, async () => jsonResponse({
    items: [rawSourceItem()],
    hasNext: false,
    nextCursor: ''
  }), {
    enrichItems: async (items) => items.map((item) => ({
      ...item,
      sourceTags: ['OpenAI'],
      previewFileIds: ['cloud://env.bucket/knowledge-previews/source/aihot-media/item-01.webp'],
      previewStatus: 'ready',
      previewCaptureVersion: 3,
      previewCheckedAt: new Date('2026-07-22T03:00:00.000Z')
    }))
  });

  const result = await source.loadAll();
  assert.deepEqual(result.items[0].previewFileIds, [
    'cloud://env.bucket/knowledge-previews/source/aihot-media/item-01.webp'
  ]);
  assert.equal(result.items[0].previewStatus, 'ready');
  assert.equal(result.items[0].previewCaptureVersion, 3);
  assert.deepEqual(result.items[0].sourceTags, ['OpenAI']);
});

test('keeps the primary item response authoritative and treats enrichment as fail-open', async () => {
  const warnings = [];
  const source = createAihotSource({
    provider: 'aihot',
    apiRoot: 'https://source.test/items',
    fingerprintRoot: 'https://source.test/fingerprint',
    dailyIndexRoot: 'https://source.test/dailies',
    dailyRoot: 'https://source.test/daily',
    pageSize: 100,
    maxItems: 100,
    allMaxItems: 100,
    timeoutMs: 1000
  }, async () => jsonResponse({ items: [rawSourceItem()], hasNext: false }), {
    enrichItems: async (items) => items.map((item) => ({
      ...item,
      title: '不允许补充接口覆盖正文',
      sourceIdentity: { platform: 'x', displayName: 'Rohan Paul', handle: 'rohanpaul_ai' },
      sourceTags: ['开源生态']
    }))
  }, { warn: (...args) => warnings.push(args) });
  const result = await source.loadAll();
  assert.equal(result.items[0].title, 'AI 护城河转向专有数据');
  assert.equal(result.items[0].sourceIdentity.displayName, 'Rohan Paul');
  assert.deepEqual(result.items[0].sourceTags, ['开源生态']);
  assert.equal(warnings.length, 0);

  const failing = createAihotSource({
    provider: 'aihot',
    apiRoot: 'https://source.test/items',
    fingerprintRoot: 'https://source.test/fingerprint',
    dailyIndexRoot: 'https://source.test/dailies',
    dailyRoot: 'https://source.test/daily',
    pageSize: 100,
    maxItems: 100,
    allMaxItems: 100,
    timeoutMs: 1000
  }, async () => jsonResponse({ items: [rawSourceItem()], hasNext: false }), {
    enrichItems: async () => { throw new Error('metadata temporarily unavailable'); }
  }, { warn: (...args) => warnings.push(args) });
  assert.equal((await failing.loadAll()).items[0].title, 'AI 护城河转向专有数据');
  assert.equal(warnings.length, 1);
});

test('downloads an upstream avatar once, stores only a CloudBase file id, and reuses the handle cache', async () => {
  let downloads = 0;
  let uploads = 0;
  const profiles = new Map();
  const metadata = {
    id: ITEM_ID,
    sourceIdentity: { platform: 'x', displayName: 'Rohan Paul', handle: 'rohanpaul_ai' },
    sourceTags: ['开源生态', '现象/趋势', '部署/工程'],
    avatarProxyUrl: `https://aihot.virxact.com${AVATAR_PROXY}`,
    avatarSourceHash: 'a'.repeat(64)
  };
  const service = createSourceMetadataEnrichmentService({
    adapter: {
      loadForItems: async () => new Map([[ITEM_ID, metadata]]),
      downloadAvatar: async () => {
        downloads += 1;
        return { buffer: Buffer.from('jpeg'), extension: 'jpg' };
      }
    },
    profileRepository: {
      getMany: async (handles) => new Map(handles
        .filter((handle) => profiles.has(handle))
        .map((handle) => [handle, profiles.get(handle)])),
      save: async (profile) => {
        profiles.set(profile.sourceIdentity.handle.toLowerCase(), { ...profile });
        return profile;
      }
    },
    cloud: {
      uploadFile: async ({ cloudPath, fileContent }) => {
        uploads += 1;
        assert.match(cloudPath, /^knowledge-source-avatars\/x\/rohanpaul_ai-a{20}\.jpg$/);
        assert.equal(fileContent.toString(), 'jpeg');
        return { fileID: `cloud://env.bucket/${cloudPath}` };
      }
    },
    logger: { warn() {} }
  });
  const input = [{ id: ITEM_ID, url: ITEM_URL, title: 'Primary title' }];
  const first = await service.enrichItems(input, { mode: 'all' });
  const second = await service.enrichItems(input, { mode: 'all' });
  assert.equal(downloads, 1);
  assert.equal(uploads, 1);
  assert.deepEqual(first[0].sourceIdentity, metadata.sourceIdentity);
  assert.deepEqual(first[0].sourceTags, metadata.sourceTags);
  assert.match(first[0].sourceAvatarFileId, /^cloud:\/\/env\.bucket\/knowledge-source-avatars\//);
  assert.equal(first[0].sourceMetadataHash.length, 64);
  assert.equal(second[0].sourceAvatarFileId, first[0].sourceAvatarFileId);
  assert.equal(JSON.stringify(first).includes('img-proxy'), false);
});

test('joins an existing X profile while the AI HOT feed metadata is still propagating', async () => {
  const cachedProfile = {
    sourceIdentity: {
      platform: 'x',
      displayName: 'Rohan Paul',
      handle: 'rohanpaul_ai'
    },
    avatarSourceHash: 'a'.repeat(64),
    sourceAvatarFileId: 'cloud://env.bucket/knowledge-source-avatars/x/rohan.jpg'
  };
  const service = createSourceMetadataEnrichmentService({
    adapter: {
      loadForItems: async () => new Map(),
      downloadAvatar: async () => { throw new Error('must not download'); }
    },
    profileRepository: {
      getMany: async (handles) => new Map(handles.includes('rohanpaul_ai')
        ? [['rohanpaul_ai', cachedProfile]]
        : []),
      save: async () => { throw new Error('must not save'); }
    },
    cloud: { uploadFile: async () => { throw new Error('must not upload'); } },
    logger: { warn() {} }
  });
  const [enriched] = await service.enrichItems([{
    id: ITEM_ID,
    url: ITEM_URL,
    title: 'Primary title'
  }], { mode: 'all' });
  assert.deepEqual(enriched.sourceIdentity, cachedProfile.sourceIdentity);
  assert.equal(enriched.sourceAvatarFileId, cachedProfile.sourceAvatarFileId);
  assert.equal(enriched.sourceMetadataHash.length, 64);
});

test('keeps metadata outside content and analysis hashes and presents only normalized fields', () => {
  const normalized = {
    id: ITEM_ID,
    title: 'AI 护城河转向专有数据',
    titleEn: '',
    summary: '真正的竞争壁垒是独家专有数据集。',
    url: ITEM_URL,
    permalink: `https://aihot.virxact.com/items/${ITEM_ID}`,
    source: 'X：Rohan Paul (@rohanpaul_ai)',
    publishedAt: '2026-07-21T07:17:00.000Z',
    category: 'tip',
    categoryLabel: '方法实践',
    categoryMarker: 'PRACTICE',
    channelKey: 'ai',
    coverTone: 'lime',
    topicKeys: [],
    score: 70,
    selected: false,
    attribution: { source: 'AI HOT', canonical: `https://aihot.virxact.com/items/${ITEM_ID}` }
  };
  const metadata = {
    sourceIdentity: { platform: 'x', displayName: 'Rohan Paul', handle: 'rohanpaul_ai' },
    sourceTags: ['开源生态', '现象/趋势'],
    sourceAvatarFileId: 'cloud://env.bucket/knowledge-source-avatars/x/rohan.jpg'
  };
  assert.equal(contentHash(normalized), contentHash({ ...normalized, ...metadata }));
  const withoutMetadata = toStoredFeedItem(normalized, {
    provider: 'aihot', generation: 'g1', observedAt: new Date('2026-07-21T08:00:00Z')
  });
  const stored = toStoredFeedItem({ ...normalized, ...metadata }, {
    provider: 'aihot', generation: 'g1', observedAt: new Date('2026-07-21T08:00:00Z')
  });
  assert.equal(stored.contentHash, withoutMetadata.contentHash);
  assert.equal(stored.analysisInputHash, withoutMetadata.analysisInputHash);
  assert.equal(stored.sourceMetadataHash.length, 64);
  const presented = publicItem(stored);
  assert.deepEqual(presented.sourceIdentity, metadata.sourceIdentity);
  assert.deepEqual(presented.sourceTags, metadata.sourceTags);
  assert.equal(presented.sourceAvatarFileId, metadata.sourceAvatarFileId);
  assert.equal(Object.prototype.hasOwnProperty.call(presented, 'sourceMetadataHash'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(presented, 'avatarProxyUrl'), false);
});

function memoryFeedDb(initial) {
  const records = new Map(initial.map((entry) => [entry._id, { ...entry }]));
  function chain(query = null) {
    return {
      where: (next) => chain(next),
      field: () => chain(query),
      limit: () => chain(query),
      get: async () => {
        let values = [...records.values()];
        if (query && query._id && Array.isArray(query._id.values)) {
          values = values.filter((entry) => query._id.values.includes(entry._id));
        }
        return { data: values };
      },
      add: async ({ data }) => {
        for (const entry of data) records.set(entry._id, { ...entry });
      },
      doc: (id) => ({
        update: async ({ data }) => records.set(id, { ...records.get(id), ...data })
      })
    };
  }
  return {
    records,
    db: {
      command: { in: (values) => ({ values }) },
      createCollection: async () => null,
      collection: () => chain()
    }
  };
}

test('persists metadata-only changes without queuing screenshots or AI analysis and never clears old metadata', async () => {
  const base = toStoredFeedItem({
    id: ITEM_ID,
    title: 'Primary title',
    titleEn: '',
    summary: 'Primary summary',
    url: ITEM_URL,
    permalink: `https://aihot.virxact.com/items/${ITEM_ID}`,
    source: 'Rohan Paul (@rohanpaul_ai)',
    publishedAt: '2026-07-21T07:17:00.000Z',
    category: 'tip',
    categoryLabel: '方法实践',
    categoryMarker: 'PRACTICE',
    channelKey: 'ai',
    coverTone: 'lime',
    topicKeys: [],
    score: 70,
    selected: false,
    attribution: null,
    coverFileId: 'cloud://env.bucket/cover.jpg',
    listThumbnailFileId: 'cloud://env.bucket/thumb.jpg'
  }, {
    provider: 'aihot', generation: 'g1', observedAt: new Date('2026-07-21T08:00:00Z')
  });
  const current = {
    ...base,
    sourceIdentity: { platform: 'x', displayName: 'Old name', handle: 'rohanpaul_ai' },
    sourceTags: ['旧标签'],
    sourceAvatarFileId: 'cloud://env.bucket/old-avatar.jpg',
    sourceMetadataHash: '0'.repeat(64),
    visualState: 'ready',
    analysisStatus: 'ready',
    qualityTier: 'curated'
  };
  const memory = memoryFeedDb([current]);
  const repository = createFeedItemRepository(memory.db, {
    provider: 'aihot', itemsCollectionName: 'knowledge_feed_items'
  });
  const incoming = {
    ...base,
    sourceIdentity: { platform: 'x', displayName: 'Rohan Paul', handle: 'rohanpaul_ai' },
    sourceTags: ['开源生态'],
    sourceAvatarFileId: 'cloud://env.bucket/new-avatar.jpg',
    sourceMetadataHash: '1'.repeat(64)
  };
  const result = await repository.upsertMany([incoming], { mergeVisuals: true });
  assert.equal(result.updated, 1);
  assert.deepEqual(result.visualCandidates, []);
  assert.deepEqual(result.analysisCandidates, []);
  const updated = memory.records.get(base._id);
  assert.equal(updated.title, 'Primary title');
  assert.equal(updated.sourceIdentity.displayName, 'Rohan Paul');
  assert.deepEqual(updated.sourceTags, ['开源生态']);
  assert.equal(updated.sourceAvatarFileId, 'cloud://env.bucket/new-avatar.jpg');
  assert.equal(updated.analysisStatus, 'ready');
  assert.equal(updated.qualityTier, 'curated');

  const noEnrichment = await repository.upsertMany([base], { mergeVisuals: true });
  assert.equal(noEnrichment.updated, 0);
  assert.equal(memory.records.get(base._id).sourceAvatarFileId, 'cloud://env.bucket/new-avatar.jpg');
  assert.deepEqual(memory.records.get(base._id).sourceTags, ['开源生态']);
});

test('stores source profiles under a normalized X handle key', async () => {
  const records = new Map();
  function collection() {
    return {
      where: ({ _id }) => ({
        limit: () => ({
          get: async () => ({ data: [...records.values()].filter((entry) => _id.values.includes(entry._id)) })
        })
      }),
      doc: (id) => ({
        set: async ({ data }) => records.set(id, { _id: id, ...data })
      })
    };
  }
  const repository = createSourceProfileRepository({
    command: { in: (values) => ({ values }) },
    createCollection: async () => null,
    collection
  });
  await repository.save({
    sourceIdentity: { platform: 'x', displayName: 'Rohan Paul', handle: 'RohanPaul_ai' },
    avatarSourceHash: 'a'.repeat(64),
    sourceAvatarFileId: 'cloud://env.bucket/avatar.jpg'
  }, new Date('2026-07-21T08:00:00Z'));
  assert.equal(records.has('x_rohanpaul_ai'), true);
  assert.equal((await repository.get('rohanpaul_ai')).sourceIdentity.displayName, 'Rohan Paul');
});
