const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMissingDatabaseIndexes,
  assertIndexApplyConfirmation,
  buildCreateIndexArgs,
  buildDescribeTableArgs,
  buildListTablesArgs,
  compareDatabaseIndexState,
  extractTableIndexes,
  loadDatabaseIndexContract,
  parseIndexControlArgs,
  readDatabaseIndexState,
  validateDatabaseIndexContract
} = require('../scripts/lib/cloudbase-database-index-control');

const ENV_ID = 'test-environment';

function expectedIndex(collection, name, keys) {
  return {
    collection,
    name,
    unique: false,
    keys,
    owner: 'test-owner',
    reason: 'Exercise one production query.'
  };
}

function contract(indexes) {
  return validateDatabaseIndexContract({
    schemaVersion: 1,
    mode: 'additive',
    preserveUnknownIndexes: true,
    indexes
  });
}

function observed(index) {
  return {
    collection: index.collection,
    name: index.name,
    unique: index.unique,
    keys: index.keys
  };
}

test('versioned index contract covers media, feed, engagement, and billing hot paths', () => {
  const loaded = loadDatabaseIndexContract();
  const identifiers = new Set(loaded.contract.indexes.map(
    (index) => `${index.collection}/${index.name}`
  ));

  [
    'knowledge_user_media/cleanup_after_1',
    'knowledge_user_media/cleanup_claim_expires_at_1',
    'knowledge_user_profile_reviews/status_next_attempt_at_1',
    'knowledge_user_profile_reviews/status_claim_expires_at_1',
    'knowledge_user_messages/owner_unread_delivered_at',
    'knowledge_user_messages/owner_created_at',
    'knowledge_user_profiles/avatar_file_id_1',
    'knowledge_feed_comments/attachments_file_id_1',
    'knowledge_feed_comments/itemId_1',
    'knowledge_feed_comments/item_status_author_created_id',
    'knowledge_feed_comments/review_state_next_attempt',
    'knowledge_feed_comments/review_state_claim_expires',
    'knowledge_feed_user_engagements/ownerKey_1',
    'knowledge_membership_orders/status_next_check_at_1',
    'knowledge_membership_orders/owner_status_created_at',
    'knowledge_message_events/status_next_attempt_at',
    'knowledge_message_events/status_claim_expires_at',
    'knowledge_feed_archive/date_desc',
    'knowledge_feed_items/ps_sc_tags_pub_id',
    'knowledge_feed_items/ps_sc_tags_score_pub_id'
  ].forEach((identifier) => assert.equal(identifiers.has(identifier), true, identifier));

  assert.equal(loaded.contract.preserveUnknownIndexes, true);
  assert.equal(loaded.contract.indexes.every((index) => index.unique === false), true);
  assert.deepEqual(
    loaded.contract.indexes.find(
      (index) => index.name === 'item_status_author_created_id'
    ).keys,
    [
      { field: 'itemId', direction: '1' },
      { field: 'status', direction: '1' },
      { field: 'authorKey', direction: '1' },
      { field: 'createdAt', direction: '-1' },
      { field: '_id', direction: '-1' }
    ]
  );
  assert.deepEqual(
    loaded.contract.indexes.find(
      (index) => index.name === 'owner_status_created_at'
    ).keys,
    [
      { field: 'ownerKey', direction: '1' },
      { field: 'status', direction: '1' },
      { field: 'createdAt', direction: '-1' }
    ]
  );
});

test('plan is the default and apply requires the exact target environment', () => {
  assert.equal(parseIndexControlArgs([]).mode, 'plan');
  assert.equal(parseIndexControlArgs(['readback', '--json']).mode, 'readback');
  assert.equal(parseIndexControlArgs(['dry-run']).mode, 'plan');

  assert.doesNotThrow(() => assertIndexApplyConfirmation(
    parseIndexControlArgs(['apply', '--confirm-env', ENV_ID]),
    ENV_ID
  ));
  assert.throws(
    () => assertIndexApplyConfirmation(parseIndexControlArgs(['apply']), ENV_ID),
    /no CloudBase index changes were made/
  );
  assert.throws(
    () => assertIndexApplyConfirmation(
      parseIndexControlArgs(['apply', '--confirm-env', 'different-env']),
      ENV_ID
    ),
    /no CloudBase index changes were made/
  );
});

test('TCB commands are allowlisted and preserve JSON as one argv element', () => {
  const listArgs = buildListTablesArgs(ENV_ID, 0, 100);
  assert.equal(listArgs[2], 'ListTables');
  assert.deepEqual(JSON.parse(listArgs[listArgs.indexOf('--body') + 1]), {
    EnvId: ENV_ID,
    MgoOffset: 0,
    MgoLimit: 100
  });

  const describeArgs = buildDescribeTableArgs(ENV_ID, 'knowledge_feed_items');
  assert.equal(describeArgs[2], 'DescribeTable');
  assert.deepEqual(JSON.parse(describeArgs[describeArgs.indexOf('--body') + 1]), {
    EnvId: ENV_ID,
    TableName: 'knowledge_feed_items'
  });

  const createArgs = buildCreateIndexArgs(
    ENV_ID,
    expectedIndex('knowledge_user_media', 'cleanup_after_1', [
      { field: 'cleanupAfter', direction: '1' }
    ])
  );
  assert.equal(createArgs[2], 'UpdateTable');
  const body = JSON.parse(createArgs[createArgs.indexOf('--body') + 1]);
  assert.deepEqual(body.CreateIndexes, [{
    IndexName: 'cleanup_after_1',
    MgoKeySchema: {
      MgoIsUnique: false,
      MgoIndexKeys: [{ Name: 'cleanupAfter', Direction: '1' }]
    }
  }]);
  assert.equal(Object.hasOwn(body, 'DropIndexes'), false);
});

test('DescribeTable extraction returns only allowlisted index metadata', () => {
  const indexes = extractTableIndexes({
    data: {
      Indexes: [{
        Name: 'status_next_check_at_1',
        Unique: false,
        Keys: [
          { Name: 'status', Direction: '1' },
          { Name: 'nextCheckAt', Direction: '1' }
        ],
        Accesses: { Ops: 99, Since: 'not-exported' },
        Size: 12345,
        RuntimeEnvironment: { SECRET: 'not-exported' },
        SampleDocument: { status: 'not-exported' }
      }]
    }
  }, 'knowledge_membership_orders');

  assert.deepEqual(indexes, [{
    collection: 'knowledge_membership_orders',
    name: 'status_next_check_at_1',
    unique: false,
    keys: [
      { field: 'status', direction: '1' },
      { field: 'nextCheckAt', direction: '1' }
    ]
  }]);
  assert.equal(JSON.stringify(indexes).includes('not-exported'), false);
});

test('readback only invokes ListTables and DescribeTable and never returns documents', () => {
  const desired = contract([
    expectedIndex('knowledge_feed_comments', 'itemId_1', [
      { field: 'itemId', direction: '1' }
    ])
  ]);
  const actions = [];
  const state = readDatabaseIndexState(ENV_ID, desired, {
    invoke(args, options) {
      const action = args[2];
      actions.push(action);
      assert.equal(options.suppressFailureDetails, true);
      if (action === 'ListTables') {
        return {
          data: {
            Tables: [{
              TableName: 'knowledge_feed_comments',
              SampleDocument: { content: 'must-not-leak' }
            }]
          }
        };
      }
      if (action === 'DescribeTable') {
        return {
          data: {
            Indexes: [{
              Name: 'itemId_1',
              Keys: [{ Name: 'itemId', Direction: '1' }],
              Unique: false,
              Documents: [{ content: 'must-not-leak' }]
            }]
          }
        };
      }
      throw new Error(`Unexpected action: ${action}`);
    }
  });

  assert.deepEqual(actions, ['ListTables', 'DescribeTable']);
  assert.equal(JSON.stringify([...state.collections.values()]).includes('must-not-leak'), false);
});

test('comparison treats equivalent aliases as converged and preserves unknown indexes', () => {
  const desiredIndex = expectedIndex('knowledge_feed_comments', 'itemId_1', [
    { field: 'itemId', direction: '1' }
  ]);
  const desired = contract([desiredIndex]);
  const state = {
    collections: new Map([[
      'knowledge_feed_comments',
      {
        exists: true,
        indexes: [
          observed({ ...desiredIndex, name: 'legacy_item_lookup' }),
          observed(expectedIndex('knowledge_feed_comments', 'moderation_state_1', [
            { field: 'moderation.state', direction: '1' }
          ]))
        ]
      }
    ]])
  };
  const comparison = compareDatabaseIndexState(desired, state);

  assert.equal(comparison.converged, true);
  assert.deepEqual(comparison.equivalentAliases, [{
    collection: 'knowledge_feed_comments',
    expectedName: 'itemId_1',
    actualName: 'legacy_item_lookup'
  }]);
  assert.deepEqual(
    comparison.unmanagedIndexes.map((index) => index.name),
    ['moderation_state_1']
  );
});

test('comparison distinguishes missing collections, missing indexes, and name conflicts', () => {
  const first = expectedIndex('knowledge_feed_comments', 'itemId_1', [
    { field: 'itemId', direction: '1' }
  ]);
  const second = expectedIndex('knowledge_user_media', 'cleanup_after_1', [
    { field: 'cleanupAfter', direction: '1' }
  ]);
  const desired = contract([first, second]);
  const state = {
    collections: new Map([
      ['knowledge_feed_comments', {
        exists: true,
        indexes: [observed({
          ...first,
          keys: [{ field: 'createdAt', direction: '-1' }]
        })]
      }],
      ['knowledge_user_media', { exists: false, indexes: [] }]
    ])
  };
  const comparison = compareDatabaseIndexState(desired, state);

  assert.equal(comparison.converged, false);
  assert.deepEqual(comparison.missingCollections, ['knowledge_user_media']);
  assert.deepEqual(
    comparison.missingIndexes.map((index) => `${index.collection}/${index.name}`),
    ['knowledge_user_media/cleanup_after_1']
  );
  assert.deepEqual(
    comparison.conflicts.map((index) => `${index.collection}/${index.name}`),
    ['knowledge_feed_comments/itemId_1']
  );
});

test('apply emits only additive UpdateTable calls and refuses missing collections or conflicts', () => {
  const missing = expectedIndex('knowledge_user_profiles', 'avatar_file_id_1', [
    { field: 'avatarFileId', direction: '1' }
  ]);
  const calls = [];
  const count = applyMissingDatabaseIndexes(ENV_ID, {
    missingCollections: [],
    conflicts: [],
    missingIndexes: [missing]
  }, {
    invoke(args, options) {
      calls.push(args);
      assert.equal(options.suppressFailureDetails, true);
      return { data: { RequestId: 'not-exported' } };
    }
  });

  assert.equal(count, 1);
  assert.equal(calls[0][2], 'UpdateTable');
  assert.equal(calls[0].join(' ').includes('DropIndexes'), false);
  assert.throws(
    () => applyMissingDatabaseIndexes(ENV_ID, {
      missingCollections: ['knowledge_user_media'],
      conflicts: [],
      missingIndexes: [missing]
    }),
    /collections are missing/
  );
  assert.throws(
    () => applyMissingDatabaseIndexes(ENV_ID, {
      missingCollections: [],
      conflicts: [{ name: 'avatar_file_id_1' }],
      missingIndexes: []
    }),
    /different definition/
  );
});
