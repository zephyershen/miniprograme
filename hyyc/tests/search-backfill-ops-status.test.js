const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  projectSearchBackfillState,
  createSearchBackfillStatusService
} = require('../cloudfunctions/knowledgeOps/services/search-backfill-status-service');

test('projects actionable search backfill progress without raw errors', () => {
  const state = projectSearchBackfillState({
    searchTokenBackfillVersion: 1,
    searchTokenBackfillTargetVersion: 1,
    searchTokenBackfillScanned: 1700,
    searchTokenBackfillUpdated: 1699,
    searchTokenBackfillFailureCount: 5,
    searchTokenBackfillStartedAt: '2026-07-27T08:00:00.000Z',
    searchTokenBackfillScanCompletedAt: '2026-07-27T08:10:00.000Z',
    searchTokenBackfillCompletedAt: '2026-07-27T08:10:00.000Z',
    searchTokenBackfillFailures: [{
      documentId: 'item_poison_0001',
      attempts: 5,
      lastErrorCode: 'INVALID_STORED_ROW',
      lastFailedAt: '2026-07-27T08:11:00.000Z',
      blocked: true,
      rawError: 'must never escape'
    }]
  });

  assert.equal(state.phase, 'blocked');
  assert.equal(state.ready, true);
  assert.equal(state.blockedCount, 1);
  assert.equal(state.failures[0].errorCode, 'INVALID_STORED_ROW');
  assert.equal(JSON.stringify(state).includes('must never escape'), false);
});

test('returns not_started for a missing sync-state document', async () => {
  const service = createSearchBackfillStatusService({
    db: {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw Object.assign(new Error('DOCUMENT_NOT_EXIST'), {
              code: 'DATABASE_DOCUMENT_NOT_EXIST'
            });
          }
        })
      })
    },
    collectionName: 'knowledge_feed_sync_state',
    documentId: 'aihot_all'
  });
  assert.equal((await service.get()).phase, 'not_started');
});

test('knowledgeOps status includes the search backfill projection', () => {
  const entrypoint = fs.readFileSync(
    path.join(__dirname, '../cloudfunctions/knowledgeOps/index.js'),
    'utf8'
  );
  assert.match(entrypoint, /searchBackfillStatusService\.get\(\)/);
  assert.match(entrypoint, /searchBackfill,/);
});
