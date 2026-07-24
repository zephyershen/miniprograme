const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyAndReadBackDatabaseCollections,
  applyMissingDatabaseCollections,
  assertCollectionApplyConfirmation,
  buildCreateTableArgs,
  buildListTablesArgs,
  compareDatabaseCollectionState,
  databaseCollectionReport,
  extractCollectionNames,
  parseCollectionControlArgs,
  readDatabaseCollectionState
} = require('../scripts/lib/cloudbase-database-collection-control');
const {
  DATABASE_PERMISSION,
  loadReleaseContracts
} = require('../scripts/lib/cloudbase-release-control');

const ENV_ID = 'test-environment';

test('collection control derives all 26 resources from the existing database rules contract', () => {
  const collections = loadReleaseContracts().database.collections;
  assert.equal(collections.length, 26);
  assert.equal(collections.includes('knowledge_membership_checkout_locks'), true);
  assert.equal(collections.includes('knowledge_user_media'), true);
  assert.equal(collections.includes('knowledge_message_events'), true);
  assert.equal(collections.includes('knowledge_user_messages'), true);
  assert.equal(collections.includes('knowledge_user_profile_reviews'), true);
  assert.deepEqual(collections, [...collections].sort());
});

test('plan is safe by default and apply requires the exact target environment', () => {
  assert.equal(parseCollectionControlArgs([]).mode, 'plan');
  assert.equal(parseCollectionControlArgs(['dry-run']).mode, 'plan');
  assert.equal(parseCollectionControlArgs(['readback', '--json']).mode, 'readback');

  assert.doesNotThrow(() => assertCollectionApplyConfirmation(
    parseCollectionControlArgs(['apply', '--confirm-env', ENV_ID]),
    ENV_ID
  ));
  assert.throws(
    () => assertCollectionApplyConfirmation(
      parseCollectionControlArgs(['apply']),
      ENV_ID
    ),
    /no CloudBase collection changes were made/
  );
  assert.throws(
    () => assertCollectionApplyConfirmation(
      parseCollectionControlArgs(['apply', '--confirm-env', 'another-environment']),
      ENV_ID
    ),
    /no CloudBase collection changes were made/
  );
});

test('TCB commands allow only ListTables and ADMINONLY CreateTable', () => {
  const listArgs = buildListTablesArgs(ENV_ID, 0, 100);
  assert.equal(listArgs[2], 'ListTables');
  assert.deepEqual(JSON.parse(listArgs[listArgs.indexOf('--body') + 1]), {
    EnvId: ENV_ID,
    MgoOffset: 0,
    MgoLimit: 100
  });

  const createArgs = buildCreateTableArgs(ENV_ID, 'knowledge_user_media');
  assert.equal(createArgs[2], 'CreateTable');
  assert.deepEqual(JSON.parse(createArgs[createArgs.indexOf('--body') + 1]), {
    EnvId: ENV_ID,
    TableName: 'knowledge_user_media',
    PermissionInfo: {
      AclTag: DATABASE_PERMISSION,
      EnvId: ENV_ID
    }
  });
  assert.equal(createArgs.join(' ').includes('DeleteTable'), false);
});

test('ListTables extraction returns names only and drops documents and provider metadata', () => {
  const names = extractCollectionNames({
    data: {
      Data: {
        Tables: [{
          TableName: 'knowledge_feed_items',
          SampleDocument: { content: 'must-not-leak' },
          Environment: { TOKEN: 'must-not-leak' },
          Size: 123
        }, 'knowledge_user_media']
      }
    }
  });

  assert.deepEqual(names, ['knowledge_feed_items', 'knowledge_user_media']);
  assert.equal(JSON.stringify(names).includes('must-not-leak'), false);
});

test('readback paginates only through ListTables and preserves unknown collections', () => {
  const expected = ['knowledge_feed_items', 'knowledge_user_media'];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    TableName: index === 0
      ? 'knowledge_feed_items'
      : `unmanaged-${String(index).padStart(3, '0')}`,
    SampleDocument: { secret: 'must-not-leak' }
  }));
  const actions = [];
  const state = readDatabaseCollectionState(ENV_ID, expected, {
    invoke(args, options) {
      actions.push(args[2]);
      assert.equal(options.suppressFailureDetails, true);
      const body = JSON.parse(args[args.indexOf('--body') + 1]);
      return {
        data: {
          Data: {
            Tables: body.MgoOffset === 0
              ? firstPage
              : [{ TableName: 'another-unmanaged' }]
          }
        }
      };
    }
  });
  const comparison = compareDatabaseCollectionState(expected, state);

  assert.deepEqual(actions, ['ListTables', 'ListTables']);
  assert.deepEqual(comparison.presentCollections, ['knowledge_feed_items']);
  assert.deepEqual(comparison.missingCollections, ['knowledge_user_media']);
  assert.equal(comparison.unmanagedCollectionCount, 100);
});

test('readback report exposes only contract collection status and an unknown count', () => {
  const expected = ['knowledge_feed_items', 'knowledge_user_media'];
  const state = {
    onlineCollections: new Set([
      'knowledge_feed_items',
      'unmanaged-private-name'
    ])
  };
  const comparison = compareDatabaseCollectionState(expected, state);
  const report = databaseCollectionReport(
    'readback',
    ENV_ID,
    expected,
    state,
    comparison
  );
  const serialized = JSON.stringify(report);

  assert.deepEqual(report.collections, [
    { collection: 'knowledge_feed_items', exists: true },
    { collection: 'knowledge_user_media', exists: false }
  ]);
  assert.equal(report.unmanagedCollectionsPreserved, 1);
  assert.equal(serialized.includes('unmanaged-private-name'), false);
});

test('apply performs a complete preflight, creates only missing contract tables, and reads back', async () => {
  const expected = ['knowledge_feed_items', 'knowledge_user_media'];
  let mediaExists = false;
  const actions = [];
  const result = await applyAndReadBackDatabaseCollections(
    ENV_ID,
    expected,
    {
      readbackAttempts: 2,
      readbackDelayMs: 0,
      invoke(args, options) {
        const action = args[2];
        actions.push(action);
        assert.equal(options.suppressFailureDetails, true);
        if (action === 'ListTables') {
          return {
            data: {
              Data: {
                Tables: mediaExists
                  ? expected
                  : ['knowledge_feed_items']
              }
            }
          };
        }
        if (action === 'CreateTable') {
          const body = JSON.parse(args[args.indexOf('--body') + 1]);
          assert.equal(body.TableName, 'knowledge_user_media');
          assert.equal(body.PermissionInfo.AclTag, 'ADMINONLY');
          mediaExists = true;
          return { data: { RequestId: 'not-exported' } };
        }
        throw new Error(`Unexpected action: ${action}`);
      }
    }
  );

  assert.deepEqual(actions, ['ListTables', 'CreateTable', 'ListTables']);
  assert.equal(result.changeCount, 1);
  assert.equal(result.readback.ok, true);
  assert.equal(actions.includes('DeleteTable'), false);
});

test('apply rejects injected non-contract targets before the first create', () => {
  let called = false;
  assert.throws(
    () => applyMissingDatabaseCollections(
      ENV_ID,
      ['knowledge_feed_items'],
      {
        missingCollections: ['outside_contract']
      },
      {
        invoke() {
          called = true;
        }
      }
    ),
    /outside the contract/
  );
  assert.equal(called, false);
});

test('a concurrent create race is accepted only after an allowlisted read confirms existence', () => {
  const expected = ['knowledge_user_media'];
  const actions = [];
  let listCount = 0;
  const count = applyMissingDatabaseCollections(
    ENV_ID,
    expected,
    { missingCollections: expected },
    {
      invoke(args) {
        const action = args[2];
        actions.push(action);
        if (action === 'CreateTable') throw new Error('resource exists');
        if (action === 'ListTables') {
          listCount += 1;
          return {
            data: {
              Data: {
                Tables: ['knowledge_user_media']
              }
            }
          };
        }
        throw new Error(`Unexpected action: ${action}`);
      }
    }
  );

  assert.equal(count, 1);
  assert.equal(listCount, 1);
  assert.deepEqual(actions, ['CreateTable', 'ListTables']);
});
