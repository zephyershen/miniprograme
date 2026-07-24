const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DATABASE_PERMISSION,
  assertApplyConfirmation,
  buildDescribeDatabaseArgs,
  buildModifyDatabaseArgs,
  buildUpdateStorageArgs,
  compareDatabasePermissions,
  compareStorageRules,
  extractDatabasePermissions,
  extractStorageRules,
  loadReleaseContracts,
  parseControlArgs,
  parseFirstJsonObject,
  waitForReadback
} = require('../scripts/lib/cloudbase-release-control');

const ENV_ID = 'hyyc-1gi3f5sqc5becabf';

test('loads versioned release contracts without credentials', () => {
  const contracts = loadReleaseContracts();
  assert.equal(contracts.envId, ENV_ID);
  assert.equal(contracts.database.mode, 'adminOnly');
  assert.equal(contracts.database.collections.length, 26);
  assert.equal(
    contracts.database.collections.includes('knowledge_membership_checkout_locks'),
    true
  );
  assert.equal(contracts.storage.write, 'false');
});

test('dry-run is the safe default and apply requires an exact environment confirmation', () => {
  assert.equal(parseControlArgs([]).mode, 'plan');
  assert.equal(parseControlArgs(['dry-run', '--json']).mode, 'plan');
  assert.doesNotThrow(() => {
    assertApplyConfirmation(parseControlArgs(['apply', '--confirm-env', ENV_ID]), ENV_ID);
  });
  assert.throws(
    () => assertApplyConfirmation(parseControlArgs(['apply']), ENV_ID),
    /no CloudBase changes were made/
  );
  assert.throws(
    () => assertApplyConfirmation(
      parseControlArgs(['apply', '--confirm-env', 'another-env']),
      ENV_ID
    ),
    /no CloudBase changes were made/
  );
});

test('database CLI arguments keep JSON in one argv element and request ADMINONLY', () => {
  const describe = buildDescribeDatabaseArgs(ENV_ID, ['knowledge_feed_items']);
  const describeBody = JSON.parse(describe[describe.indexOf('--body') + 1]);
  assert.deepEqual(describeBody, {
    EnvId: ENV_ID,
    ResourceType: 'collection',
    Resources: ['knowledge_feed_items']
  });

  const modify = buildModifyDatabaseArgs(ENV_ID, 'knowledge_feed_items');
  const modifyBody = JSON.parse(modify[modify.indexOf('--body') + 1]);
  assert.equal(modifyBody.Permission, DATABASE_PERMISSION);
  assert.equal(modifyBody.Resource, 'knowledge_feed_items');
});

test('storage CLI arguments apply the complete versioned custom rule', () => {
  const expected = loadReleaseContracts().storage;
  const args = buildUpdateStorageArgs(ENV_ID, expected);
  assert.equal(args[args.indexOf('--acl') + 1], 'CUSTOM');
  assert.deepEqual(JSON.parse(args[args.indexOf('--rule') + 1]), expected);
});

test('parses TCB JSON around banners and loading output', () => {
  const parsed = parseFirstJsonObject(
    'i → TCB.DescribeResourcePermission\n'
      + '{"data":{"Data":{"PermissionList":[{"Resource":"knowledge_feed_items",'
      + '"Permission":"ADMINONLY"}]}}}\n- Loading data...'
  );
  const permissions = extractDatabasePermissions(parsed);
  assert.equal(permissions.get('knowledge_feed_items'), 'ADMINONLY');
});

test('database readback reports missing and non-admin collections as drift', () => {
  const observed = extractDatabasePermissions({
    data: {
      Data: {
        PermissionList: [
          { Resource: 'knowledge_feed_items', Permission: 'ADMINONLY' },
          { Resource: 'knowledge_user_media', Permission: 'PRIVATE' }
        ]
      }
    }
  });
  assert.deepEqual(
    compareDatabasePermissions([
      'knowledge_feed_items',
      'knowledge_memberships',
      'knowledge_user_media'
    ], observed),
    [
      { resource: 'knowledge_memberships', expected: 'ADMINONLY', actual: null },
      { resource: 'knowledge_user_media', expected: 'ADMINONLY', actual: 'PRIVATE' }
    ]
  );
});

test('storage readback ignores formatting but detects semantic drift', () => {
  const expected = loadReleaseContracts().storage;
  const observed = extractStorageRules({
    data: {
      acl: 'CUSTOM',
      rule: {
        read: expected.read.replace(/\s+/g, ''),
        write: 'false'
      }
    }
  });
  assert.deepEqual(compareStorageRules(expected, observed), []);

  observed.write = 'auth.openid == resource.openid';
  assert.deepEqual(
    compareStorageRules(expected, observed).map((entry) => entry.field),
    ['write']
  );
});

test('readback retries until the control plane converges', async () => {
  let attempt = 0;
  const result = await waitForReadback(() => {
    attempt += 1;
    return { ok: attempt === 3 };
  }, { attempts: 4, delayMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
});
