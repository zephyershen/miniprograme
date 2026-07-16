const test = require('node:test');
const assert = require('node:assert/strict');
const { authorized } = require('../cloudrun/source-preview-renderer/src/auth');
const {
  normalizePublicHttpsUrl,
  isPrivateIp,
  createPublicUrlGuard
} = require('../cloudrun/source-preview-renderer/src/network-security');
const {
  maintenanceAuthorized,
  createPreviewService
} = require('../cloudfunctions/knowledgeFeed/services/preview-service');
const {
  normalizeLoopbackProxyUrl,
  browserLaunchOptions
} = require('../cloudrun/source-preview-renderer/src/proxy');
const { assertRenderableResponse } = require('../cloudrun/source-preview-renderer/src/page-policy');
const { createCloudFileDeleter } = require('../cloudfunctions/knowledgeFeed/services/cloud-file-deleter');
const { createFeedCacheRepository } = require('../cloudfunctions/knowledgeFeed/repositories/feed-cache');

const FILE_ID_PREFIX = 'cloud://env.bucket/knowledge-previews/source/';

test('requires a constant-time bearer token for source preview capture', () => {
  const token = 'a'.repeat(40);
  assert.equal(authorized(`Bearer ${token}`, token), true);
  assert.equal(authorized(`Bearer ${'b'.repeat(40)}`, token), false);
  assert.equal(authorized('', token), false);
  assert.equal(authorized(`Bearer ${token}`, 'short'), false);
});

test('allows only public HTTPS targets for the browser renderer', async () => {
  const guard = createPublicUrlGuard({
    resolver: async (hostname) => hostname === 'public.example'
      ? [{ address: '8.8.8.8', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }]
  });
  assert.equal(await guard.assertPublicUrl('https://public.example/article#section'), 'https://public.example/article');
  await assert.rejects(() => guard.assertPublicUrl('https://private.example/admin'), /PRIVATE_HOST/);
  await assert.rejects(() => guard.assertPublicUrl('http://public.example/article'), /INVALID_URL/);
  assert.throws(() => normalizePublicHttpsUrl('https://user:pass@public.example'), /INVALID_URL/);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('100.100.100.200'), true);
  assert.equal(isPrivateIp('192.0.66.108'), false);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('64:ff9b::7f00:1'), true);
  assert.equal(isPrivateIp('ff02::1'), true);
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
});

test('revalidates an expired DNS result before allowing another browser request', async () => {
  let lookupCount = 0;
  const guard = createPublicUrlGuard({
    cacheTtlMs: 0,
    resolver: async () => {
      lookupCount += 1;
      return [{ address: lookupCount === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
    }
  });
  await guard.assertPublicUrl('https://changing.example/article');
  await assert.rejects(() => guard.assertPublicUrl('https://changing.example/article'), /PRIVATE_HOST/);
});

test('accepts only an authenticated-service local browser proxy', () => {
  assert.equal(normalizeLoopbackProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.deepEqual(browserLaunchOptions('socks5://localhost:7891').proxy, {
    server: 'socks5://localhost:7891'
  });
  assert.throws(() => normalizeLoopbackProxyUrl('http://0.0.0.0:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => normalizeLoopbackProxyUrl('http://proxy.example:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => normalizeLoopbackProxyUrl('http://user:pass@127.0.0.1:7890'), /INVALID_PROXY_URL/);
  assert.throws(() => browserLaunchOptions(''), /LOOPBACK_PROXY_REQUIRED/);
  assert.equal(browserLaunchOptions('', { allowDirectEgress: true }).proxy, undefined);
  assert.equal(browserLaunchOptions('', { allowDirectEgress: true }).args.includes('--no-sandbox'), false);
});

test('rejects error pages before storing a source screenshot', () => {
  assert.doesNotThrow(() => assertRenderableResponse({ status: () => 200 }));
  assert.throws(() => assertRenderableResponse({ status: () => 403 }), /UPSTREAM_HTTP_403/);
  assert.throws(() => assertRenderableResponse({ status: () => 500 }), /UPSTREAM_HTTP_500/);
  assert.throws(() => assertRenderableResponse(null), /NO_DOCUMENT_RESPONSE/);
});

test('acknowledges cloud file cleanup only when every file deletion succeeds', async () => {
  const fileIds = [`${FILE_ID_PREFIX}old-1.jpg`, `${FILE_ID_PREFIX}old-2.jpg`];
  const successful = createCloudFileDeleter({
    deleteFile: async ({ fileList }) => ({ fileList: fileList.map((fileID) => ({ fileID, status: 0 })) })
  });
  await successful(fileIds);

  const partial = createCloudFileDeleter({
    deleteFile: async () => ({
      fileList: [{ fileID: fileIds[0], status: 0 }, { fileID: fileIds[1], status: -1 }]
    })
  });
  await assert.rejects(() => partial(fileIds), /CLOUD_FILE_DELETE_FAILED/);
});

test('renders, stores and safely replaces source preview screenshots behind the maintenance boundary', async () => {
  const cache = {
    items: [{ id: 'item0001', url: 'https://public.example/article', coverFileId: '', previewFileIds: [] }]
  };
  let updatedItems = null;
  let queuedVisualDeletes = [];
  const repository = {
    get: async () => cache,
    patchItems: async (patches, updatedAt, visualDeletes) => {
      const patchById = new Map(patches.map((entry) => [entry.id, entry.fields]));
      updatedItems = cache.items.map((item) => ({ ...item, ...(patchById.get(item.id) || {}) }));
      cache.items = updatedItems;
      queuedVisualDeletes = visualDeletes || [];
      return updatedItems;
    }
  };
  const jpeg = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
  const service = createPreviewService({
    cloud: {
      getWXContext: () => ({}),
      uploadFile: async ({ cloudPath, fileContent }) => {
        assert.equal(fileContent.equals(jpeg), true);
        return { fileID: `${FILE_ID_PREFIX}${cloudPath.split('/').pop()}` };
      }
    },
    repository,
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 's'.repeat(40),
      maintenanceToken: 'm'.repeat(40),
      rendererTimeoutMs: 1000,
      retryMs: 1000,
      maxResponseBytes: 10000,
      maxImageBytes: 1000,
      maxSegments: 3,
      cloudPathPrefix: 'knowledge-previews/source/',
      fileIdPrefix: FILE_ID_PREFIX
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://renderer.example/capture');
      assert.equal(options.headers.authorization, `Bearer ${'s'.repeat(40)}`);
      const body = Buffer.from(JSON.stringify({
        ok: true,
        data: { screenshots: [{ mimeType: 'image/jpeg', data: jpeg.toString('base64') }] }
      }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body
      };
    },
    now: () => new Date('2026-07-16T06:00:00.000Z')
  });

  const result = await service.hydratePreviews(1, false, 'm'.repeat(40));
  assert.equal(result.resolved, 1);
  assert.equal(result.totalWithVisuals, 1);
  assert.equal(updatedItems[0].previewStatus, 'ready');
  assert.equal(updatedItems[0].previewFileIds.length, 1);

  const activeFileId = `${FILE_ID_PREFIX}item0001-1.jpg`;
  const staleFileIds = [
    `${FILE_ID_PREFIX}item0001-2.jpg`,
    `${FILE_ID_PREFIX}item0001-3.jpg`
  ];
  cache.items[0].previewFileIds = [activeFileId, ...staleFileIds];
  const rebuilt = await service.hydratePreview('item0001', true, 'm'.repeat(40));
  assert.equal(rebuilt.status, 'ready');
  assert.deepEqual(rebuilt.previewFileIds, [activeFileId]);
  assert.deepEqual(queuedVisualDeletes, staleFileIds);

  let stored = {
    items: [{ id: 'item0001', previewFileIds: [activeFileId] }],
    pendingVisualDeletes: [`${FILE_ID_PREFIX}already-pending.jpg`]
  };
  const reference = {
    get: async () => ({ data: stored }),
    update: async ({ data }) => { stored = { ...stored, ...data }; }
  };
  const persistentRepository = createFeedCacheRepository({
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: () => reference })
    })
  }, { collectionName: 'feed', documentId: 'public' });
  await persistentRepository.patchItems([], new Date('2026-07-16T06:01:00.000Z'), [
    staleFileIds[0],
    activeFileId
  ]);
  assert.deepEqual(stored.pendingVisualDeletes, [
    `${FILE_ID_PREFIX}already-pending.jpg`,
    staleFileIds[0]
  ]);
});

test('does not expose preview maintenance without its independent secret', async () => {
  const service = createPreviewService({
    cloud: { getWXContext: () => ({ OPENID: 'user-openid' }) },
    repository: { get: async () => null },
    config: { rendererUrl: '', rendererToken: '', maintenanceToken: 'm'.repeat(40) }
  });
  await assert.rejects(() => service.hydratePreviews(1, false, ''), { code: 'TEMPORARY_FAILURE' });
});

test('requires a separate constant-time token for preview maintenance', async () => {
  const token = 'm'.repeat(40);
  assert.equal(maintenanceAuthorized(token, token), true);
  assert.equal(maintenanceAuthorized('x'.repeat(40), token), false);
  const service = createPreviewService({
    cloud: { getWXContext: () => ({}) },
    repository: { get: async () => ({ items: [] }) },
    config: {
      rendererUrl: 'https://renderer.example',
      rendererToken: 'r'.repeat(40),
      maintenanceToken: token
    }
  });
  await assert.rejects(() => service.hydratePreviews(1, false, 'wrong'), { code: 'TEMPORARY_FAILURE' });
});

test('lists failed previews only behind the maintenance token', async () => {
  const token = 'm'.repeat(40);
  const service = createPreviewService({
    cloud: { getWXContext: () => ({}) },
    repository: {
      get: async () => ({
        items: [
          { id: 'failed001', title: 'Failed', url: 'https://failed.example', previewStatus: 'failed' },
          { id: 'ready0001', title: 'Ready', url: 'https://ready.example', previewStatus: 'ready' }
        ]
      })
    },
    config: { maintenanceToken: token }
  });
  await assert.rejects(() => service.listPreviewFailures('wrong'), { code: 'TEMPORARY_FAILURE' });
  assert.deepEqual(await service.listPreviewFailures(token), [{
    id: 'failed001',
    title: 'Failed',
    url: 'https://failed.example',
    previewCheckedAt: undefined
  }]);
});

test('reports visual and cleanup coverage without exposing the maintenance endpoint publicly', async () => {
  const token = 'm'.repeat(40);
  const service = createPreviewService({
    cloud: { getWXContext: () => ({}) },
    repository: {
      get: async () => ({
        items: [
          { id: 'cover001', coverFileId: `${FILE_ID_PREFIX}cover001.jpg` },
          { id: 'preview1', previewFileIds: [`${FILE_ID_PREFIX}preview1-1.jpg`] }
        ],
        pendingVisualDeletes: [`${FILE_ID_PREFIX}old-1.jpg`]
      })
    },
    config: { maintenanceToken: token }
  });
  await assert.rejects(() => service.maintenanceStatus('wrong'), { code: 'TEMPORARY_FAILURE' });
  const status = await service.maintenanceStatus(token);
  assert.equal(status.totalItems, 2);
  assert.equal(status.totalWithVisuals, 2);
  assert.equal(status.totalWithOriginalCovers, 1);
  assert.equal(status.totalWithSourcePreviews, 1);
  assert.equal(status.pendingVisualDeletes, 1);
});
