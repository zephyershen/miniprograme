const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFeedSyncMaintenanceService
} = require('../cloudfunctions/knowledgeFeed/services/feed-sync-maintenance-service');

const TOKEN = 's'.repeat(40);

test('forces a full feed refresh only behind the maintenance token', async () => {
  const calls = [];
  const service = createFeedSyncMaintenanceService({
    maintenanceToken: TOKEN,
    allFeedSyncService: {
      run: async (options) => {
        calls.push(options);
        return { status: 'updated', itemCount: 12 };
      }
    }
  });

  await assert.rejects(() => service.refresh({ token: 'wrong' }), {
    code: 'AUTH_REQUIRED'
  });
  assert.deepEqual(await service.refresh({ token: TOKEN }), {
    status: 'updated', itemCount: 12
  });
  assert.deepEqual(calls, [{ force: true }]);
});
