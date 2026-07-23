const { spawnSync } = require('node:child_process');
const path = require('node:path');

const envId = process.argv[2];
const tcbEntry = process.argv[3];
const sourceUrl = process.argv[4] || 'https://x.com/rohanpaul_ai/status/2079465855797334131';

if (!envId || !tcbEntry) {
  throw new Error('Usage: node invoke-source-preview-canary.js <env-id> <tcb-entry> [source-url]');
}

const config = require(path.resolve(__dirname, '../../wiki/secrets/SourcePreviewConfig.js'));
const cloudPathStem = `knowledge-previews/source/canary-post-decommission-${Date.now()}-${process.pid}`;
const event = JSON.stringify({
  action: 'capture',
  token: config.sourcePreviewRendererToken,
  url: sourceUrl,
  cloudPathStem,
  captureVersion: 3,
  maxSegments: 1
});

const invoked = spawnSync(process.execPath, [
  tcbEntry,
  '-e',
  envId,
  'fn',
  'invoke',
  'sourcePreviewWorker',
  '-d',
  event,
  '--json'
], {
  cwd: path.resolve(__dirname, '../..'),
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  timeout: 140 * 1000
});

const raw = `${invoked.stdout || ''}\n${invoked.stderr || ''}`;
const normalized = raw.replaceAll('\\"', '"');
const ok = normalized.includes('"ok":true');
if (invoked.error || invoked.status !== 0 || !ok) {
  const safe = normalized.replace(/"data":"[^"]+"/g, '"data":"<redacted>"');
  throw new Error(`SCF_X_CANARY_FAILED: ${invoked.error?.message || safe.trim()}`);
}

const segmentCount = Number(normalized.match(/"segmentCount":(\d+)/)?.[1] || 0);
const targetMatched = normalized.includes('"targetMatched":true');
const qualityAccepted = normalized.includes('"decision":"accept"')
  || normalized.includes('"accepted":true')
  || normalized.includes('"verdict":"accept"');
const uploadedJpegs = new Set(normalized.match(/cloud:\/\/[^"\\]+\.jpg/g) || []).size;
const egressMode = normalized.match(
  /"egressMode":"(direct|direct-x-embed|foreign-proxy|foreign-proxy-x-embed)"/
)?.[1] || 'unknown';

console.log(JSON.stringify({
  ok,
  segmentCount,
  targetMatched,
  qualityAccepted,
  uploadedJpegs,
  egressMode,
  cloudPathStem
}));
