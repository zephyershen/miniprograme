const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_CHROMIUM_MAJOR
} = require('../src/browser-runtime.js');

const ROOT = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageRoot(packageName) {
  let current = path.dirname(require.resolve(packageName, { paths: [ROOT] }));
  while (current !== path.dirname(current)) {
    const manifest = path.join(current, 'package.json');
    if (fs.existsSync(manifest) && readJson(manifest).name === packageName) return current;
    current = path.dirname(current);
  }
  throw new Error(`PACKAGE_ROOT_NOT_FOUND:${packageName}`);
}

function assertEqual(actual, expected, code) {
  if (actual !== expected) throw new Error(`${code}:${actual || 'missing'}!=${expected}`);
}

function main() {
  const project = readJson(path.join(ROOT, 'package.json'));
  const dockerProject = readJson(path.join(ROOT, 'docker', 'package.json'));
  const dockerLock = readJson(path.join(ROOT, 'docker', 'package-lock.json'));
  const playwrightCoreRoot = packageRoot('playwright-core');
  const playwrightCore = readJson(path.join(playwrightCoreRoot, 'package.json'));
  const sparticuz = readJson(path.join(packageRoot('@sparticuz/chromium'), 'package.json'));
  const chromium = readJson(path.join(playwrightCoreRoot, 'browsers.json'))
    .browsers.find((entry) => entry.name === 'chromium');
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

  assertEqual(
    project.dependencies['playwright-core'],
    dockerProject.dependencies.playwright,
    'PLAYWRIGHT_MANIFEST_MISMATCH'
  );
  assertEqual(
    dockerLock.packages['node_modules/playwright'].version,
    dockerProject.dependencies.playwright,
    'PLAYWRIGHT_DOCKER_LOCK_MISMATCH'
  );
  assertEqual(playwrightCore.version, project.dependencies['playwright-core'], 'PLAYWRIGHT_CORE_INSTALL_MISMATCH');
  assertEqual(sparticuz.version, project.dependencies['@sparticuz/chromium'], 'SPARTICUZ_INSTALL_MISMATCH');

  const playwrightChromiumMajor = Number(String(chromium.browserVersion).split('.')[0]);
  const sparticuzChromiumMajor = Number(sparticuz.version.split('.')[0]);
  assertEqual(playwrightChromiumMajor, EXPECTED_CHROMIUM_MAJOR, 'PLAYWRIGHT_CHROMIUM_MISMATCH');
  assertEqual(sparticuzChromiumMajor, EXPECTED_CHROMIUM_MAJOR, 'SPARTICUZ_CHROMIUM_MISMATCH');
  if (!dockerfile.includes(`mcr.microsoft.com/playwright:v${dockerProject.dependencies.playwright}-noble`)) {
    throw new Error('PLAYWRIGHT_DOCKER_IMAGE_MISMATCH');
  }
  if (!/FROM\s+mcr\.microsoft\.com\/playwright:[^\s]+@sha256:[a-f0-9]{64}/.test(dockerfile)) {
    throw new Error('PLAYWRIGHT_DOCKER_IMAGE_NOT_PINNED');
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    node: process.versions.node,
    playwright: dockerProject.dependencies.playwright,
    playwrightCore: playwrightCore.version,
    chromium: chromium.browserVersion,
    sparticuz: sparticuz.version,
    dockerImageMatched: true,
    dockerImagePinned: true
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Runtime compatibility check failed: ${error.message}\n`);
  process.exitCode = 1;
}
