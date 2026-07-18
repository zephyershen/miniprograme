const test = require('node:test');
const assert = require('node:assert/strict');
const { COLUMN_LESSONS } = require('../features/ai-column/catalog');
const {
  createColumnView,
  lessonPosters,
  posterLoadWindow,
  posterPreviewUrls,
  validTrack
} = require('../features/ai-column/model');

test('teaches the foundational Agent, Skill and MCP concepts', () => {
  const ids = COLUMN_LESSONS.map((item) => item.id);
  assert.ok(ids.includes('agent'));
  assert.ok(ids.includes('skill'));
  assert.ok(ids.includes('mcp'));
  COLUMN_LESSONS.forEach((item) => {
    assert.ok(item.definition);
    assert.ok(item.example);
    assert.ok(item.takeaway);
    assert.equal(item.guide.posters.length, 3);
    item.guide.posters.forEach((poster) => {
      assert.match(poster.image, /^\/assets\/ai-column\/posters\/[a-z-]+-[1-3]\.jpg$/);
      assert.match(poster.previewImage, /^cloud:\/\/hyyc-[^/]+\/ai-column\/posters-hd\/v1\/[a-z-]+-[1-3]\.jpg$/);
      assert.ok(poster.alt);
    });
    assert.equal(item.guide.flow.length >= 4, true);
    assert.equal(item.guide.checks.length, 3);
  });
});

test('turns every lesson into a three-page illustrated carousel', () => {
  const imagePaths = [];
  COLUMN_LESSONS.forEach((lesson) => {
    const posters = lessonPosters(lesson);
    assert.equal(posters.length, 3);
    assert.deepEqual(posters.map((poster) => poster.page), ['01', '02', '03']);
    assert.deepEqual(posters.map((poster) => poster.position), ['1 / 3', '2 / 3', '3 / 3']);
    imagePaths.push(...posters.map((poster) => poster.image));
  });
  assert.equal(imagePaths.length, 18);
  assert.equal(new Set(imagePaths).size, 18);
});

test('loads only the active poster and its next neighbor', () => {
  assert.deepEqual(posterLoadWindow(0), [true, true, false]);
  assert.deepEqual(posterLoadWindow(1), [false, true, true]);
  assert.deepEqual(posterLoadWindow(2), [false, false, true]);
  assert.deepEqual(posterLoadWindow(99), [false, false, true]);
  assert.deepEqual(posterLoadWindow(0, 0), []);
});

test('prefers remote HD posters for the native swipe preview', () => {
  const view = createColumnView({ expandedId: 'agent' });
  const lesson = view.lessons.find((item) => item.id === 'agent');
  const urls = posterPreviewUrls(lesson);
  assert.equal(urls.length, 3);
  assert.match(urls[0], /\/ai-column\/posters-hd\/v1\/agent-1\.jpg$/);
});

test('filters column lessons by learning track and expands only the selected lesson', () => {
  const view = createColumnView({ trackKey: 'practice', expandedId: 'rag' });
  assert.ok(view.lessons.every((item) => item.track === 'practice'));
  assert.equal(view.lessons.filter((item) => item.expanded).length, 1);
  assert.equal(view.lessons.find((item) => item.expanded).id, 'rag');
  assert.equal(validTrack('unknown'), 'all');
});
