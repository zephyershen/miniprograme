const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AIGCLINK_SOURCE_CONFIG,
  ITEM_STORE_CONFIG,
  TIMER_CONFIG
} = require('../cloudfunctions/knowledgeFeed/config');
const {
  createScheduledWorkService
} = require('../cloudfunctions/knowledgeFeed/services/scheduled-work-service');

test('shares one fingerprint observation and cache snapshot across the source timer', async () => {
  const fingerprintObservation = {
    etag: 'fingerprint-v2', selected: 'selected-v2', all: 'all-v2'
  };
  const cacheDocument = { items: [{ id: 'item0001' }] };
  let allSyncOptions = null;
  const service = createScheduledWorkService({
    sourceSyncService: {
      run: async () => ({
        status: 'updated',
        changed: true,
        pendingVisualItemIds: ['item0001'],
        fingerprintObservation,
        cacheDocument
      })
    },
    allFeedSyncService: {
      run: async (options) => {
        allSyncOptions = options;
        return { status: 'updated' };
      }
    }
  });

  const result = await service.syncSource({ Type: 'Timer', force: true });
  assert.equal(allSyncOptions.fingerprintObservation, fingerprintObservation);
  assert.equal(allSyncOptions.legacyCache, cacheDocument);
  assert.equal(allSyncOptions.force, true);
  assert.equal(result.itemStore.status, 'updated');
  assert.equal(Object.hasOwn(result, 'fingerprintObservation'), false);
  assert.equal(Object.hasOwn(result, 'cacheDocument'), false);
  assert.equal(Object.hasOwn(result, 'pendingVisualItemIds'), false);
});

test('polls AIGCLINK before the heavier AI HOT source chain', async () => {
  const calls = [];
  const service = createScheduledWorkService({
    aigclinkSyncService: {
      run: async () => {
        calls.push('aigclink');
        return { status: 'unchanged' };
      }
    },
    sourceSyncService: {
      run: async () => {
        calls.push('source');
        return { status: 'unchanged' };
      }
    },
    allFeedSyncService: {
      run: async () => {
        calls.push('item-store');
        return { status: 'unchanged' };
      }
    }
  });

  await service.syncSource({ Type: 'Timer' });
  assert.deepEqual(calls, ['aigclink', 'source', 'item-store']);
});

test('declares isolated timer names and schedules instead of one serial minute chain', () => {
  assert.equal(new Set(Object.values(TIMER_CONFIG)).size, 10);
  const cloudbase = JSON.parse(fs.readFileSync(path.join(__dirname, '../../cloudbaserc.json'), 'utf8'));
  const knowledgeFeed = cloudbase.functions.find((entry) => entry.name === 'knowledgeFeed');
  const schedules = new Map(knowledgeFeed.triggers.map((trigger) => [trigger.name, trigger.config]));
  assert.equal(schedules.get(TIMER_CONFIG.source), '0 * * * * * *');
  assert.equal(schedules.get(TIMER_CONFIG.visualWorker), '10,25,40,55 * * * * * *');
  assert.equal(schedules.get(TIMER_CONFIG.intelligenceWorker), '30 */10 * * * * *');
  assert.equal(schedules.get(TIMER_CONFIG.profileReviewWorker), '20 * * * * * *');
  assert.equal(schedules.get(TIMER_CONFIG.dailyDigest), '0 0 8 * * * *');
  assert.equal(schedules.get(TIMER_CONFIG.weeklyDigest), '0 5 8 ? * 1 *');
  assert.equal(schedules.has(TIMER_CONFIG.weeklyColumn), false);
  assert.equal(schedules.get(TIMER_CONFIG.monthlyDigest), '0 10 8 1 * ? *');
  const entrypoint = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/knowledgeFeed/index.js'),
    'utf8'
  );
  assert.match(entrypoint, /if \(event && event\.Type === 'Timer'\) throw error/);
});

test('keeps source-store leases beyond the production function timeout', () => {
  const cloudbase = JSON.parse(fs.readFileSync(path.join(__dirname, '../../cloudbaserc.json'), 'utf8'));
  const knowledgeFeed = cloudbase.functions.find((entry) => entry.name === 'knowledgeFeed');
  const timeoutMs = Number(knowledgeFeed.timeout) * 1000;
  assert.ok(AIGCLINK_SOURCE_CONFIG.leaseMs > timeoutMs);
  assert.ok(ITEM_STORE_CONFIG.syncLeaseMs > timeoutMs);
});
