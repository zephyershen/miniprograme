const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BUILTIN_ENTRIES,
  mergeColumnEntries,
  normalizeEntryContent
} = require('../cloudfunctions/knowledgeFeed/content/column-entry-contract');
const {
  createColumnCatalogService
} = require('../cloudfunctions/knowledgeFeed/services/column-catalog-service');
const {
  createColumnAdminService
} = require('../cloudfunctions/knowledgeFeed/services/column-admin-service');
const {
  createColumnContentService
} = require('../cloudfunctions/knowledgeFeed/services/column-content-service');
const {
  editableForm,
  draftFromForm,
  decorateEntryList,
  nextEntryOrder,
  columnAdminLoadError
} = require('../features/column-admin/model');

const actualAdminWhilePreviewingFree = {
  viewer: {
    actualRole: 'admin',
    currentRole: 'free',
    isActualAdmin: true
  },
  entitlements: { aiColumn: false }
};
const ordinaryViewer = {
  viewer: {
    actualRole: 'free',
    currentRole: 'free',
    isActualAdmin: false
  },
  entitlements: { aiColumn: false }
};
const member = { entitlements: { aiColumn: true } };
const free = { entitlements: { aiColumn: false } };
const actor = { ownerKey: 'wx-admin-owner' };

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function memoryEntryRepository(initial = []) {
  const documents = new Map(initial.map((entry) => [entry._id, clone(entry)]));
  return {
    documents,
    async get(id) {
      return clone(documents.get(id) || null);
    },
    async listAll() {
      return [...documents.values()].map(clone);
    },
    async mutate({ id, expectedVersion, mutationId, createDocument, update }) {
      const current = documents.get(id);
      if (current && current.lastMutationId === mutationId) return clone(current);
      if (Number(current && current.version || 0) !== Number(expectedVersion)) {
        const error = new Error('version conflict');
        error.code = 'VERSION_CONFLICT';
        throw error;
      }
      const base = clone(current || createDocument);
      if (!base) {
        const error = new Error('version conflict');
        error.code = 'VERSION_CONFLICT';
        throw error;
      }
      const next = {
        ...update(base),
        _id: id,
        version: Number(base.version || 0) + 1,
        lastMutationId: mutationId
      };
      documents.set(id, clone(next));
      return clone(next);
    }
  };
}

function memoryMediaRepository(initial = []) {
  const documents = new Map(initial.map((entry) => [entry._id, clone(entry)]));
  const removed = [];
  return {
    documents,
    removed,
    async getMany(ids) {
      return ids.map((id) => documents.get(id)).filter(Boolean).map(clone);
    },
    async listForEntry(entryId) {
      return [...documents.values()].filter((entry) => entry.entryId === entryId).map(clone);
    },
    async create(document) {
      documents.set(document._id, clone(document));
      return clone(document);
    },
    async update(id, patch) {
      const next = { ...documents.get(id), ...clone(patch) };
      documents.set(id, next);
      return clone(next);
    },
    async listExpired() {
      return [...documents.values()]
        .filter((entry) => entry.cleanupAfter)
        .map(clone);
    },
    async remove(id) {
      removed.push(id);
      documents.delete(id);
    }
  };
}

function services({
  entries = memoryEntryRepository(),
  media = memoryMediaRepository(),
  getTempFileURL = async ({ fileList }) => ({
    fileList: fileList.map((fileID) => ({
      fileID,
      status: 0,
      tempFileURL: `https://media.example/${encodeURIComponent(fileID)}`
    }))
  }),
  deleteFiles = async (fileIds) => ({ deletedFileIds: fileIds, retryFileIds: [] })
} = {}) {
  const catalog = createColumnCatalogService({
    entryRepository: entries,
    mediaRepository: media,
    getTempFileURL
  });
  const admin = createColumnAdminService({
    entryRepository: entries,
    mediaRepository: media,
    catalogService: catalog,
    uploadFile: async () => ({ fileID: '' }),
    deleteFiles,
    config: {
      mediaMaxBytes: 3 * 1024 * 1024,
      mediaMaxDimension: 4096,
      mediaMaxPixels: 12 * 1024 * 1024,
      mediaPathPrefix: 'knowledge-column-media/',
      mediaOrphanTtlMs: 24 * 60 * 60 * 1000,
      mediaCleanupBatchSize: 20
    },
    now: () => Date.parse('2026-07-27T08:00:00.000Z')
  });
  const publicContent = createColumnContentService({
    repository: {},
    getTempFileURL,
    catalogService: catalog
  });
  return { entries, media, catalog, admin, publicContent };
}

test('projects all thirty built-ins and lets an override hide one without mutating the baseline', () => {
  assert.equal(BUILTIN_ENTRIES.length, 30);
  const hiddenId = BUILTIN_ENTRIES[0].id;
  const override = {
    _id: hiddenId,
    id: hiddenId,
    kind: 'course',
    status: 'unpublished',
    version: 1,
    draft: clone(BUILTIN_ENTRIES[0].draft),
    published: clone(BUILTIN_ENTRIES[0].published)
  };
  const merged = mergeColumnEntries([override]);
  assert.equal(merged.length, 30);
  assert.equal(merged.find((entry) => entry.id === hiddenId).status, 'unpublished');
  assert.equal(BUILTIN_ENTRIES[0].status, 'published');
});

test('allows list reordering only between adjacent entries in the same category', () => {
  const items = decorateEntryList({ items: [
    { id: 'a', kind: 'course', track: 'understand', order: 1, status: 'published' },
    { id: 'b', kind: 'course', track: 'understand', order: 2, status: 'published' },
    { id: 'c', kind: 'course', track: 'instruct', order: 1, status: 'published' }
  ] });
  assert.deepEqual(items.map((item) => [item.canMoveUp, item.canMoveDown]), [
    [false, true],
    [true, false],
    [false, false]
  ]);
});

test('calculates move order only from neighbours in the same category', () => {
  const items = [
    { id: 'a1', track: 'understand', order: 1 },
    { id: 'a2', track: 'understand', order: 2 },
    { id: 'a3', track: 'understand', order: 3 },
    { id: 'b1', track: 'instruct', order: 1 }
  ];
  assert.equal(nextEntryOrder(items, 0, 1), 2.5);
  assert.equal(nextEntryOrder(items, 1, -1), 0.5);
  assert.equal(nextEntryOrder(items, 1, 1), 4);
  assert.equal(nextEntryOrder(items, 2, 1), null);
  assert.equal(nextEntryOrder(items, 0, -1), null);
  assert.equal(nextEntryOrder([
    items[0],
    { ...items[1], canMoveDown: false },
    items[2]
  ], 1, 1), null);
});

test('filters the administrator list by status and text without offering unsafe moves', () => {
  const payload = { items: [
    {
      id: 'course_live',
      kind: 'course',
      track: 'understand',
      order: 1,
      status: 'published',
      title: '提示词基础'
    },
    {
      id: 'course_draft',
      kind: 'course',
      track: 'understand',
      order: 2,
      status: 'draft',
      title: 'Agent 实践'
    }
  ] };
  const published = decorateEntryList(payload, 'course', {
    status: 'published',
    query: '提示词'
  });
  assert.deepEqual(published.map((item) => item.id), ['course_live']);
  assert.equal(published[0].canMoveUp, false);
  assert.equal(published[0].canMoveDown, false);
});

test('explains an undeployed administrator backend instead of exposing the raw route error', () => {
  const undeployed = columnAdminLoadError({
    code: 'INVALID_REQUEST',
    message: '不支持的操作'
  });
  assert.equal(undeployed.title, '管理服务还没有更新');
  assert.doesNotMatch(undeployed.copy, /不支持的操作/);

  const markup = fs.readFileSync(path.join(
    __dirname,
    '..',
    'pages',
    'column-admin',
    'index.wxml'
  ), 'utf8');
  assert.match(markup, /新建基础课/);
  assert.match(markup, /新建动手课/);
  assert.doesNotMatch(markup, /EDITORIAL DESK|基础知识|应用操作/);
});

test('requires a real administrator even while preserving authority under free-role preview', async () => {
  const { admin } = services();
  await assert.rejects(
    () => admin.list(ordinaryViewer),
    (error) => error.code === 'ADMIN_REQUIRED'
  );
  const result = await admin.list(actualAdminWhilePreviewingFree);
  assert.equal(result.items.length, 30);
});

test('keeps draft edits invisible until atomic publish and removes them after unpublish', async () => {
  const { admin, publicContent } = services();
  const created = await admin.create({
    kind: 'course',
    mutationId: 'create-flow-0001'
  }, actor, actualAdminWhilePreviewingFree);
  assert.equal(created.status, 'draft');
  assert.equal(created.version, 1);

  const beforeSave = await publicContent.home(member);
  assert.equal(beforeSave.courses.some((item) => item.id === created.id), false);

  const firstDraft = {
    ...created.draft,
    title: '管理员新增的基础知识',
    subtitle: '先保存草稿，会员暂时看不到。',
    duration: '6 分钟',
    sections: {
      ...created.draft.sections,
      summary: '这是第一个准备发布的版本。',
      steps: ['保存草稿', '预览', '发布']
    }
  };
  const saved = await admin.save({
    id: created.id,
    expectedVersion: created.version,
    mutationId: 'save-flow-000001',
    draft: firstDraft
  }, actor, actualAdminWhilePreviewingFree);
  assert.equal(saved.version, 2);

  const published = await admin.publish({
    id: created.id,
    expectedVersion: saved.version,
    mutationId: 'publish-flow-001'
  }, actor, actualAdminWhilePreviewingFree);
  assert.equal(published.status, 'published');
  assert.equal(published.publishedRevision, 1);
  const liveAfterPublish = await publicContent.home(member);
  assert.equal(
    liveAfterPublish.courses.find((item) => item.id === created.id).title,
    '管理员新增的基础知识'
  );

  const secondDraft = {
    ...published.draft,
    title: '仍在编辑的第二版'
  };
  const edited = await admin.save({
    id: created.id,
    expectedVersion: published.version,
    mutationId: 'save-flow-000002',
    draft: secondDraft
  }, actor, actualAdminWhilePreviewingFree);
  const liveDuringEdit = await publicContent.home(member);
  assert.equal(
    liveDuringEdit.courses.find((item) => item.id === created.id).title,
    '管理员新增的基础知识'
  );
  await assert.rejects(
    () => admin.save({
      id: created.id,
      expectedVersion: published.version,
      mutationId: 'save-stale-00001',
      draft: secondDraft
    }, actor, actualAdminWhilePreviewingFree),
    (error) => error.code === 'VERSION_CONFLICT'
  );

  await admin.unpublish({
    id: created.id,
    expectedVersion: edited.version,
    mutationId: 'unpublish-flow-1'
  }, actor, actualAdminWhilePreviewingFree);
  const afterUnpublish = await publicContent.home(member);
  assert.equal(afterUnpublish.courses.some((item) => item.id === created.id), false);
  await assert.rejects(
    () => publicContent.lesson(created.id, member),
    (error) => error.code === 'ITEM_NOT_FOUND'
  );
  const freeHome = await publicContent.home(free);
  assert.equal(freeHome.courses.some((item) => Object.hasOwn(item, 'subtitle')), false);
});

test('can hide a built-in lesson and rejects an image injected from another entry', async () => {
  const { admin, publicContent, media } = services();
  const builtInId = BUILTIN_ENTRIES.find((entry) => entry.kind === 'course').id;
  const hidden = await admin.unpublish({
    id: builtInId,
    expectedVersion: 0,
    mutationId: 'unpublish-builtin-1'
  }, actor, actualAdminWhilePreviewingFree);
  assert.equal(hidden.status, 'unpublished');
  const home = await publicContent.home(member);
  assert.equal(home.courses.some((item) => item.id === builtInId), false);
  await assert.rejects(
    () => publicContent.lesson(builtInId, member),
    (error) => error.code === 'ITEM_NOT_FOUND'
  );

  const created = await admin.create({
    kind: 'course',
    mutationId: 'create-injection-1'
  }, actor, actualAdminWhilePreviewingFree);
  const foreignMediaId = 'b'.repeat(48);
  media.documents.set(foreignMediaId, {
    _id: foreignMediaId,
    entryId: 'course_someone_else',
    fileId: 'cloud://test/foreign.jpg',
    status: 'draft'
  });
  await assert.rejects(
    () => admin.save({
      id: created.id,
      expectedVersion: created.version,
      mutationId: 'save-injection-001',
      draft: {
        ...created.draft,
        posters: [{ mediaId: foreignMediaId, alt: '不属于这篇内容' }]
      }
    }, actor, actualAdminWhilePreviewingFree),
    (error) => error.code === 'INVALID_REQUEST'
  );
});

test('does not truncate long image sets and signs temporary URLs in batches of fifty', async () => {
  const media = memoryMediaRepository();
  const batches = [];
  const { catalog } = services({
    media,
    getTempFileURL: async ({ fileList }) => {
      batches.push(fileList.length);
      return {
        fileList: fileList.map((fileID) => ({
          fileID,
          status: 0,
          tempFileURL: `https://media.example/${fileID.split('/').pop()}`
        }))
      };
    }
  });
  const posters = Array.from({ length: 121 }, (_, index) => {
    const mediaId = (index + 1).toString(16).padStart(48, '0');
    media.documents.set(mediaId, {
      _id: mediaId,
      entryId: 'course_many_images',
      fileId: `cloud://test/knowledge-column-media/course_many_images/${mediaId}.jpg`,
      status: 'draft'
    });
    return { mediaId, alt: `第 ${index + 1} 张` };
  });
  const content = normalizeEntryContent('course', {
    id: 'course_many_images',
    title: '很多图片',
    subtitle: '验证图片没有人为张数上限',
    track: 'understand',
    tags: ['多图', '内容运营'],
    order: 1,
    posters,
    sections: { summary: '批量签名' }
  }, 'course_many_images');
  const resolved = await catalog.resolveContent(content, { includeReferences: true });
  assert.equal(resolved.posters.length, 121);
  assert.deepEqual(batches, [50, 50, 21]);

  const form = editableForm({ id: content.id, kind: content.kind, draft: resolved });
  assert.equal(draftFromForm(form).posters.length, 121);
  assert.deepEqual(draftFromForm(form).tags, ['多图', '内容运营']);
});

test('retains administrator image references when URL signing fails and only forgets confirmed deletions', async () => {
  const mediaId = 'a'.repeat(48);
  const fileId = 'cloud://test/knowledge-column-media/course_orphaned/a.jpg';
  const media = memoryMediaRepository([{
    _id: mediaId,
    entryId: 'course_orphaned',
    fileId,
    status: 'orphaned',
    cleanupAfter: new Date('2026-07-26T08:00:00.000Z')
  }]);
  let confirmDeletion = false;
  const { catalog, admin } = services({
    media,
    getTempFileURL: async () => {
      throw new Error('temporary signer unavailable');
    },
    deleteFiles: async () => ({
      deletedFileIds: confirmDeletion ? [fileId] : [],
      retryFileIds: confirmDeletion ? [] : [fileId]
    })
  });
  const content = normalizeEntryContent('course', {
    id: 'course_orphaned',
    title: '图片签名失败测试',
    subtitle: '引用仍需保留',
    track: 'understand',
    order: 1,
    posters: [{ mediaId, alt: '仍然保留的替代说明' }],
    sections: { summary: '防止保存时误删图片' }
  }, 'course_orphaned');
  const resolved = await catalog.resolveContent(content, { includeReferences: true });
  assert.equal(resolved.posters.length, 1);
  assert.equal(resolved.posters[0].mediaId, mediaId);
  assert.equal(resolved.posters[0].image, '');

  const firstCleanup = await admin.cleanupExpired();
  assert.equal(firstCleanup.deleted, 0);
  assert.equal(media.documents.has(mediaId), true);
  confirmDeletion = true;
  const secondCleanup = await admin.cleanupExpired();
  assert.equal(secondCleanup.deleted, 1);
  assert.equal(media.documents.has(mediaId), false);
});

test('registers the administrator routes, actions, and ADMINONLY data contracts', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  assert.ok(app.pages.includes('pages/column-admin/index'));
  assert.ok(app.pages.includes('pages/column-editor/index'));

  const backend = fs.readFileSync(path.join(
    __dirname,
    '..',
    'cloudfunctions',
    'knowledgeFeed',
    'index.js'
  ), 'utf8');
  [
    'columnAdminList',
    'columnAdminGet',
    'columnAdminCreateDraft',
    'columnAdminSaveDraft',
    'columnAdminUploadMedia',
    'columnAdminPreview',
    'columnAdminPublish',
    'columnAdminUnpublish'
  ].forEach((action) => assert.match(backend, new RegExp(`\\b${action}\\b`)));

  const rules = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'cloud-database-rules.json'
  ), 'utf8'));
  assert.equal(rules.mode, 'adminOnly');
  assert.ok(rules.collections.includes('knowledge_column_entries'));
  assert.ok(rules.collections.includes('knowledge_column_media'));
});
