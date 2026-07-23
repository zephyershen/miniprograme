const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIGEST_WINDOWS,
  normalizeDigestWindows,
  createDigestMaintenanceService
} = require('../cloudfunctions/knowledgeFeed/services/digest-maintenance-service');

const TOKEN = 'digest-maintenance-token-that-is-long-enough';

test('normalizes digest maintenance windows without duplicates', () => {
  assert.deepEqual(normalizeDigestWindows(), DIGEST_WINDOWS);
  assert.deepEqual(normalizeDigestWindows(['24h', '24h', '7d']), ['24h', '7d']);
  assert.throws(() => normalizeDigestWindows(['90d']), /简报时间范围无效/);
});

test('requires the maintenance token before forcing digest regeneration', async () => {
  const calls = [];
  const service = createDigestMaintenanceService({
    maintenanceToken: TOKEN,
    digestGenerationService: {
      async runDue(options) {
        calls.push(options);
        return { status: 'generated', generated: [] };
      }
    }
  });

  await assert.rejects(
    () => service.regenerate({ token: 'wrong-token-that-is-long-enough' }),
    (error) => error.code === 'AUTH_REQUIRED'
  );
  assert.equal(calls.length, 0);

  await service.regenerate({ token: TOKEN, windowKeys: ['7d', '30d'] });
  assert.deepEqual(calls, [{ force: true, windowKeys: ['7d', '30d'] }]);
});
