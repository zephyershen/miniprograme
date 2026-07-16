const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skipped = new Set(['node_modules', 'miniprogram_npm']);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(root);
const jsonFiles = files.filter((file) => file.endsWith('.json'));
const jsFiles = files.filter((file) => file.endsWith('.js'));
const runtimeClientFiles = jsFiles.filter((file) => {
  const relative = path.relative(root, file);
  return !relative.startsWith(`cloudfunctions${path.sep}`)
    && !relative.startsWith(`scripts${path.sep}`)
    && !relative.startsWith(`tests${path.sep}`);
});

for (const file of jsonFiles) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
}

for (const file of jsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  if (/\.\.\.\s*require\s*\(/.test(content)) {
    throw new Error(`Unsupported mini-program require spread found: ${path.relative(root, file)}`);
  }
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path.relative(root, file)}\n${result.stderr}`);
}

for (const file of runtimeClientFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const extensionlessRequire = /require\(\s*['"](\.\.?\/[^'"]+)(?<!\.js)(?<!\.json)['"]\s*\)/.exec(content);
  if (extensionlessRequire) {
    throw new Error(`Mini-program relative require must include an extension: ${path.relative(root, file)} -> ${extensionlessRequire[1]}`);
  }
}

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
for (const page of appConfig.pages) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    const pageFile = path.join(root, `${page}${extension}`);
    if (!fs.existsSync(pageFile)) throw new Error(`Missing page file: ${path.relative(root, pageFile)}`);
  }
}

const appJsonText = fs.readFileSync(path.join(root, 'app.json'), 'utf8');
for (const forbidden of ['requiredPrivateInfos', 'scope.userLocation', 'getLocation']) {
  if (appJsonText.includes(forbidden)) throw new Error(`Forbidden legacy permission found: ${forbidden}`);
}

const publicUiFiles = files.filter((file) => {
  const relative = path.relative(root, file);
  return relative.startsWith(`pages${path.sep}`) && ['.js', '.wxml'].includes(path.extname(file));
});
const forbiddenPublicUiTerms = [
  'AI HOT',
  'AIHOT',
  '公开 API',
  '缓存内容',
  'DAILY KNOWLEDGE INDEX',
  '今天看什么',
  '导入文章',
  'cover-fallback',
  'cover-grid'
];
for (const file of publicUiFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const forbidden of forbiddenPublicUiTerms) {
    if (content.includes(forbidden)) {
      throw new Error(`Forbidden public UI term found in ${path.relative(root, file)}: ${forbidden}`);
    }
  }
}

const cloudFunctionRoot = path.join(root, 'cloudfunctions');
const cloudFunctions = fs.readdirSync(cloudFunctionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const expectedFunctions = ['digestIngest', 'digestStore', 'knowledgeFeed'];
if (JSON.stringify(cloudFunctions) !== JSON.stringify(expectedFunctions)) {
  throw new Error(`Unexpected cloud functions: ${cloudFunctions.join(', ')}`);
}

console.log(`Checked ${jsonFiles.length} JSON files, ${jsFiles.length} JavaScript files and ${appConfig.pages.length} pages.`);
