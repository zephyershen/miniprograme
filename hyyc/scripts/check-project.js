const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(root, '..');
const skipped = new Set(['node_modules', 'miniprogram_npm']);
const componentExtensions = ['.js', '.json', '.wxml', '.wxss'];
const mainPackageLimitBytes = 2 * 1024 * 1024;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function assertExactRelativePath(relativePath, source = relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  let directory = root;
  for (const segment of segments) {
    const entries = fs.readdirSync(directory);
    if (!entries.includes(segment)) {
      const insensitiveMatch = entries.find((entry) => (
        entry.toLocaleLowerCase('en-US') === segment.toLocaleLowerCase('en-US')
      ));
      if (insensitiveMatch) {
        throw new Error(
          `Path casing mismatch in ${source}: expected ${segment}, found ${insensitiveMatch}`
        );
      }
      throw new Error(`Missing path in ${source}: ${relativePath}`);
    }
    directory = path.join(directory, segment);
  }
  return directory;
}

function referencedPath(file, request, source = path.relative(root, file)) {
  const cleanRequest = String(request || '').split(/[?#]/, 1)[0];
  const absolute = cleanRequest.startsWith('/')
    ? path.join(root, cleanRequest.slice(1))
    : path.resolve(path.dirname(file), cleanRequest);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes mini-program root in ${source}: ${request}`);
  }
  return relative;
}

function assertComponentDeclarations(file, config) {
  for (const componentPath of Object.values(config.usingComponents || {})) {
    if (typeof componentPath !== 'string' || componentPath.startsWith('plugin://')) continue;
    const relative = referencedPath(file, componentPath);
    for (const extension of componentExtensions) {
      assertExactRelativePath(`${relative}${extension}`, path.relative(root, file));
    }
  }
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

const parsedJson = new Map();
for (const file of jsonFiles) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  parsedJson.set(file, config);
  assertComponentDeclarations(file, config);
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
  for (const match of content.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
    const request = match[1];
    if (!['.js', '.json'].includes(path.extname(request))) {
      throw new Error(`Mini-program relative require must include an extension: ${path.relative(root, file)} -> ${request}`);
    }
    assertExactRelativePath(referencedPath(file, request), path.relative(root, file));
  }
  if (content.includes('wx.cloud.callFunction')
    && path.relative(root, file) !== path.join('services', 'cloud-functions.js')) {
    throw new Error(`Cloud function calls must use the guarded transport: ${path.relative(root, file)}`);
  }
}

for (const file of files.filter((entry) => entry.endsWith('.wxml'))) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\b(?:src|poster)=["']([^"'{}]+)["']/g)) {
    const request = match[1];
    if (/^(?:https?:|cloud:|data:|wxfile:|plugin:|\/\/)/.test(request)) continue;
    assertExactRelativePath(referencedPath(file, request), path.relative(root, file));
  }
}

for (const file of files.filter((entry) => entry.endsWith('.wxss'))) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/@import\s+["']([^"']+)["']/g)) {
    assertExactRelativePath(referencedPath(file, match[1]), path.relative(root, file));
  }
}

const appConfig = parsedJson.get(path.join(root, 'app.json'));
for (const page of appConfig.pages) {
  for (const extension of componentExtensions) {
    assertExactRelativePath(`${page}${extension}`, 'app.json');
  }
}

for (const item of (appConfig.tabBar && appConfig.tabBar.list) || []) {
  if (!appConfig.pages.includes(item.pagePath)) {
    throw new Error(`Tab page is not registered in app.json pages: ${item.pagePath}`);
  }
}

for (const file of files.filter((entry) => ['.js', '.json', '.wxml'].includes(path.extname(entry)))) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\/(pages\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)/g)) {
    assertExactRelativePath(`${match[1]}.js`, path.relative(root, file));
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

const projectConfig = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'project.config.json'), 'utf8')
);
if (path.resolve(repositoryRoot, projectConfig.miniprogramRoot || '') !== root) {
  throw new Error(`project.config.json miniprogramRoot must resolve to ${root}`);
}
if (projectConfig.compileType !== 'miniprogram') {
  throw new Error(`Unexpected compileType: ${projectConfig.compileType}`);
}
if (!/^wx[a-z0-9]{16}$/i.test(String(projectConfig.appid || ''))) {
  throw new Error('project.config.json must contain a valid mini-program AppID');
}
if (!/^\d+\.\d+\.\d+$/.test(String(projectConfig.libVersion || ''))) {
  throw new Error(`Invalid mini-program base library version: ${projectConfig.libVersion}`);
}

const ignoredPackageFolders = new Set(
  (((projectConfig.packOptions || {}).ignore) || [])
    .filter((entry) => entry && entry.type === 'folder')
    .map((entry) => String(entry.value || '').replaceAll('/', path.sep))
);
for (const expectedIgnore of ['cloudrun', 'scripts', 'tests']) {
  if (!ignoredPackageFolders.has(expectedIgnore)) {
    throw new Error(`project.config.json must exclude ${expectedIgnore} from the mini-program package`);
  }
  assertExactRelativePath(expectedIgnore, 'project.config.json packOptions.ignore');
}

const clientPackageFiles = files.filter((file) => {
  const relative = path.relative(root, file);
  const topLevel = relative.split(path.sep, 1)[0];
  return topLevel !== 'cloudfunctions'
    && !ignoredPackageFolders.has(topLevel)
    && !skipped.has(topLevel);
});
const clientPackageBytes = clientPackageFiles.reduce((total, file) => (
  total + fs.statSync(file).size
), 0);
if (clientPackageBytes > mainPackageLimitBytes) {
  throw new Error(
    `Mini-program source package is ${(clientPackageBytes / 1024 / 1024).toFixed(2)} MiB, `
    + `over the ${(mainPackageLimitBytes / 1024 / 1024).toFixed(0)} MiB main-package gate`
  );
}

const cloudbaseConfig = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'cloudbaserc.json'), 'utf8')
);
const deployedFunctions = (cloudbaseConfig.functions || [])
  .map((entry) => entry && entry.name)
  .filter(Boolean)
  .sort();
const expectedFunctions = [
  'knowledgeFeed', 'knowledgeOps', 'membershipBilling', 'sourcePreviewWorker'
].sort();
if (JSON.stringify(deployedFunctions) !== JSON.stringify(expectedFunctions)) {
  throw new Error(`Unexpected production functions: ${deployedFunctions.join(', ')}`);
}

for (const retiredName of ['digestIngest', 'digestStore']) {
  if (deployedFunctions.includes(retiredName)) {
    throw new Error(`Retired cloud function remains deployable: ${retiredName}`);
  }
}

const deployablePackageRoots = [
  path.join(root, 'cloudfunctions', 'knowledgeFeed'),
  path.join(root, 'cloudfunctions', 'knowledgeOps'),
  path.join(root, 'cloudfunctions', 'membershipBilling'),
  path.join(root, 'cloudrun', 'source-preview-renderer'),
  path.join(root, 'cloudrun', 'source-preview-renderer', 'docker')
];
for (const packageRoot of deployablePackageRoots) {
  const packagePath = path.join(packageRoot, 'package.json');
  const lockPath = path.join(packageRoot, 'package-lock.json');
  if (!fs.existsSync(packagePath) || !fs.existsSync(lockPath)) {
    throw new Error(`Deployable package must include package.json and package-lock.json: ${
      path.relative(root, packageRoot)
    }`);
  }
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const rootLock = lock.packages && lock.packages[''];
  if (!rootLock || rootLock.name !== manifest.name || rootLock.version !== manifest.version) {
    throw new Error(`Package lock root does not match manifest: ${path.relative(root, packageRoot)}`);
  }
}

console.log(
  `Checked ${jsonFiles.length} JSON files, ${jsFiles.length} JavaScript files, `
  + `${appConfig.pages.length} pages and a ${(clientPackageBytes / 1024 / 1024).toFixed(2)} MiB client package.`
);
