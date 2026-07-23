const FUNCTION_RUNTIME = 'cloudbase-function';
const EXPECTED_CHROMIUM_MAJOR = 143;

function isCloudBaseFunctionRuntime() {
  return process.env.SOURCE_PREVIEW_EXECUTION_ENV === FUNCTION_RUNTIME;
}

function assertCompatibleBrowser(browser) {
  const version = browser && typeof browser.version === 'function'
    ? String(browser.version())
    : '';
  const major = Number(version.match(/^(\d+)\./)?.[1] || 0);
  if (major !== EXPECTED_CHROMIUM_MAJOR) {
    throw new Error(`CHROMIUM_VERSION_MISMATCH:${version || 'unknown'}`);
  }
  return browser;
}

async function launchBrowser(options = {}) {
  let browser;
  if (!isCloudBaseFunctionRuntime()) {
    const { chromium } = require('playwright');
    browser = await chromium.launch(options);
  } else {
    const sparticuz = require('@sparticuz/chromium');
    const { chromium } = require('playwright-core');
    const launchOptions = { ...options };
    delete launchOptions.channel;
    launchOptions.executablePath = await sparticuz.executablePath();
    launchOptions.args = [...new Set([
      ...sparticuz.args,
      ...(Array.isArray(options.args) ? options.args : [])
    ])];
    launchOptions.headless = true;
    browser = await chromium.launch(launchOptions);
  }

  try {
    return assertCompatibleBrowser(browser);
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  FUNCTION_RUNTIME,
  EXPECTED_CHROMIUM_MAJOR,
  isCloudBaseFunctionRuntime,
  assertCompatibleBrowser,
  launchBrowser
};
