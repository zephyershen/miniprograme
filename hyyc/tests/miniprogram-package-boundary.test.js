const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');
const projectConfig = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'project.config.json'), 'utf8')
);

test('keeps server and development roots out of every mini-program upload', () => {
  const miniProgramRoot = path.resolve(repositoryRoot, projectConfig.miniprogramRoot);
  const cloudFunctionRoot = path.resolve(repositoryRoot, projectConfig.cloudfunctionRoot);
  const cloudFunctionPackagePath = path.relative(miniProgramRoot, cloudFunctionRoot)
    .split(path.sep)
    .join('/');
  const ignoredFolders = new Set(
    (projectConfig.packOptions && projectConfig.packOptions.ignore || [])
      .filter((entry) => entry && entry.type === 'folder')
      .map((entry) => String(entry.value || '').replaceAll('\\', '/'))
  );

  assert.equal(cloudFunctionPackagePath, 'cloudfunctions');
  assert.deepEqual(
    ['cloudfunctions', 'cloudrun', 'scripts', 'tests']
      .filter((folder) => !ignoredFolders.has(folder)),
    []
  );
});
