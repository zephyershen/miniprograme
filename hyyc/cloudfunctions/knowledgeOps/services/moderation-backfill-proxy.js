function createModerationBackfillProxy({ authorize, callFunction, functionName = 'knowledgeFeed' }) {
  async function run(event = {}) {
    authorize(event.token);
    const response = await callFunction({
      name: functionName,
      data: {
        action: 'moderationBackfill',
        token: event.token,
        kind: event.kind,
        limit: event.limit,
        cursor: event.cursor
      }
    });
    const result = response && response.result;
    if (!result || result.ok !== true) {
      const error = new Error('MODERATION_BACKFILL_FAILED');
      error.code = result && result.error && result.error.code || 'MODERATION_BACKFILL_FAILED';
      throw error;
    }
    return result.data;
  }

  return { run };
}

module.exports = { createModerationBackfillProxy };
