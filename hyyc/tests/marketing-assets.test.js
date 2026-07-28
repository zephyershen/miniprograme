const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const MARKETING_ROOT = path.join(REPOSITORY_ROOT, 'marketing');
const MAX_GIT_FILE_BYTES = 100 * 1024 * 1024;

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function localAssetPaths(manifest) {
  const values = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(add);
      return;
    }
    if (typeof value !== 'string') return;
    if (/^[a-z]+:\/\//i.test(value) || path.isAbsolute(value)) return;
    values.push(value);
  };

  add(manifest.assets);
  add(manifest.exports);
  add(manifest.exportsV2);
  add(manifest.exportsV4Compliant);
  add(manifest.visualAssets);
  add(manifest.contentFile);
  add(manifest.verification && manifest.verification.visualFramesReviewed);
  add(manifest.source && manifest.source.images);
  if (typeof manifest.source === 'string') add(manifest.source);
  if (typeof manifest.copy === 'string') add(manifest.copy);
  return [...new Set(values)];
}

function assertMediaHeader(file) {
  const extension = path.extname(file).toLowerCase();
  const header = fs.readFileSync(file).subarray(0, 16);
  if (extension === '.png') {
    assert.deepEqual([...header.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } else if (extension === '.jpg' || extension === '.jpeg') {
    assert.deepEqual([...header.subarray(0, 3)], [255, 216, 255]);
  } else if (extension === '.wav') {
    assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(header.subarray(8, 12).toString('ascii'), 'WAVE');
  } else if (extension === '.mp4') {
    assert.equal(header.subarray(4, 8).toString('ascii'), 'ftyp');
  }
}

test('keeps every archived marketing campaign self-contained and Git-safe', () => {
  const files = walk(MARKETING_ROOT);
  const manifests = files.filter((file) => path.basename(file) === 'manifest.json');

  assert.equal(manifests.length, 4);
  files.forEach((file) => {
    const stats = fs.statSync(file);
    assert.ok(stats.size > 0, `${path.relative(REPOSITORY_ROOT, file)} is empty`);
    assert.ok(
      stats.size < MAX_GIT_FILE_BYTES,
      `${path.relative(REPOSITORY_ROOT, file)} exceeds GitHub's hard file limit`
    );
    assertMediaHeader(file);
  });

  manifests.forEach((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    const manifest = JSON.parse(raw);
    const campaignRoot = path.dirname(file);
    assert.doesNotMatch(raw, /["'][A-Za-z]:[\\/]/);

    localAssetPaths(manifest).forEach((relativePath) => {
      const asset = path.resolve(campaignRoot, relativePath);
      assert.ok(
        asset.startsWith(`${campaignRoot}${path.sep}`),
        `${relativePath} escapes its campaign directory`
      );
      assert.ok(
        fs.existsSync(asset),
        `${path.relative(REPOSITORY_ROOT, file)} references missing ${relativePath}`
      );
    });
  });
});

test('keeps published campaign copy aligned with its publication manifest', () => {
  const campaign = path.join(
    MARKETING_ROOT,
    'xiaohongshu',
    'hotspots',
    '2026-07-26-meta-ai-tasks'
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(campaign, 'manifest.json'), 'utf8'));
  const copy = fs.readFileSync(path.join(campaign, 'copy.md'), 'utf8');

  assert.equal(manifest.status, 'published');
  assert.match(copy, /发布状态：2026-07-26 10:03 已人工发布/);
  assert.doesNotMatch(copy, /草稿状态：待审核/);
});
