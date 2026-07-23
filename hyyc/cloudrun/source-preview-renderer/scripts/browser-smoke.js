const runtime = String(process.argv[2] || 'docker').trim().toLowerCase();
if (!['docker', 'cloudbase-function'].includes(runtime)) {
  process.stderr.write('Usage: npm run smoke:browser -- docker|cloudbase-function\n');
  process.exit(2);
}
if (runtime === 'cloudbase-function' && (process.platform !== 'linux' || process.arch !== 'x64')) {
  process.stderr.write(
    'CloudBase Chromium smoke requires Linux x64. Run this gate in a clean Node 20 Linux job.\n'
  );
  process.exit(2);
}

if (runtime === 'cloudbase-function') {
  process.env.SOURCE_PREVIEW_EXECUTION_ENV = 'cloudbase-function';
} else {
  delete process.env.SOURCE_PREVIEW_EXECUTION_ENV;
  const fs = require('node:fs');
  const path = require('node:path');
  const Module = require('node:module');
  const dockerModules = path.resolve(__dirname, '..', 'docker', 'node_modules');
  if (fs.existsSync(dockerModules)) {
    process.env.NODE_PATH = [
      dockerModules,
      process.env.NODE_PATH || ''
    ].filter(Boolean).join(path.delimiter);
    Module._initPaths();
  }
}

const { launchBrowser } = require('../src/browser-runtime.js');

async function main() {
  let browser = null;
  let page = null;
  try {
    browser = await launchBrowser({
      headless: true,
      ...(runtime === 'docker' ? { channel: 'chromium' } : {}),
      args: ['--disable-dev-shm-usage']
    });
    page = await browser.newPage({ viewport: { width: 360, height: 253 } });
    await page.setContent(
      '<!doctype html><meta charset="utf-8"><title>runtime smoke</title>'
      + '<main style="font:24px sans-serif">source preview</main>'
    );
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 70 });
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      throw new Error('BROWSER_SMOKE_CAPTURE_INVALID');
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      runtime,
      node: process.versions.node,
      chromium: browser.version(),
      jpegBytes: jpeg.length
    })}\n`);
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

const watchdog = setTimeout(() => {
  process.stderr.write('Browser smoke timed out after 60 seconds.\n');
  process.exit(1);
}, 60000);

main()
  .catch((error) => {
    const hint = /Executable doesn't exist|browser.*not found/i.test(String(error && error.message || ''))
      ? ' Run "npx playwright install chromium" first.'
      : '';
    process.stderr.write(`Browser smoke failed: ${error.message}.${hint}\n`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
