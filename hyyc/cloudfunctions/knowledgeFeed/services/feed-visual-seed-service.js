const { entriesFromDocument } = require('../repositories/feed-day-index');

const DAY_MS = 24 * 60 * 60 * 1000;

function cutoffDate(currentTime, days) {
  return new Date(currentTime - (days * DAY_MS)).toISOString().slice(0, 10);
}

function createFeedVisualSeedService({
  itemRepository,
  dayIndexRepository,
  jobRepository,
  syncStateRepository,
  config,
  now = () => Date.now(),
  logger = console
}) {
  async function enqueue(items, state) {
    const updatedAt = new Date(now());
    const result = await jobRepository.enqueueMany(items, updatedAt);
    await itemRepository.markVisualQueued(result.queuedItems, updatedAt);
    return {
      ...state,
      visualSeedScanned: Number(state.visualSeedScanned || 0) + items.length,
      visualSeedEnqueued: Number(state.visualSeedEnqueued || 0) + result.inserted + result.reset,
      visualSeedRetained: Number(state.visualSeedRetained || 0) + result.retained,
      visualSeedUpdatedAt: updatedAt
    };
  }

  async function seedRecent(state) {
    const documents = await dayIndexRepository.listRange(
      cutoffDate(now(), config.recentWindowDays)
    );
    const itemIds = [...new Set(documents.flatMap((document) => entriesFromDocument(document)
      .map((entry) => entry.id)))];
    const offset = Math.max(0, Number(state.visualSeedRecentOffset) || 0);
    const batchIds = itemIds.slice(offset, offset + config.seedBatchSize);
    if (!batchIds.length) {
      return {
        ...state,
        visualSeedPhase: 'history',
        visualSeedRecentOffset: itemIds.length,
        visualSeedHistoryAfterId: '',
        visualSeedUpdatedAt: new Date(now())
      };
    }
    const items = await itemRepository.getManyByItemIds(batchIds);
    return enqueue(items, {
      ...state,
      visualSeedPhase: 'recent',
      visualSeedRecentOffset: offset + batchIds.length
    });
  }

  async function seedHistory(state) {
    const afterId = typeof state.visualSeedHistoryAfterId === 'string'
      ? state.visualSeedHistoryAfterId
      : '';
    const items = await itemRepository.listByIdCursor(afterId, config.seedBatchSize);
    if (!items.length) {
      return {
        ...state,
        visualSeedPhase: 'complete',
        visualSeedCompletedAt: new Date(now()),
        visualSeedUpdatedAt: new Date(now())
      };
    }
    return enqueue(items, {
      ...state,
      visualSeedPhase: 'history',
      visualSeedHistoryAfterId: items[items.length - 1]._id
    });
  }

  async function run({ restart = false, maxBatches = 1 } = {}) {
    let state = await syncStateRepository.get() || {};
    if (restart) {
      state = await syncStateRepository.patch({
        visualSeedPhase: 'recent',
        visualSeedRecentOffset: 0,
        visualSeedHistoryAfterId: '',
        visualSeedScanned: 0,
        visualSeedEnqueued: 0,
        visualSeedRetained: 0,
        visualSeedStartedAt: new Date(now()),
        visualSeedCompletedAt: null,
        visualSeedLastErrorCode: ''
      });
    }
    if (!state.visualSeedPhase) {
      state = await syncStateRepository.patch({
        visualSeedPhase: 'recent',
        visualSeedRecentOffset: 0,
        visualSeedHistoryAfterId: '',
        visualSeedScanned: 0,
        visualSeedEnqueued: 0,
        visualSeedRetained: 0,
        visualSeedStartedAt: new Date(now()),
        visualSeedCompletedAt: null,
        visualSeedLastErrorCode: ''
      });
    }
    if (state.visualSeedPhase === 'complete') return state;

    const limit = Math.max(1, Math.min(3, Number(maxBatches) || 1));
    try {
      for (let batch = 0; batch < limit && state.visualSeedPhase !== 'complete'; batch += 1) {
        state = state.visualSeedPhase === 'history'
          ? await seedHistory(state)
          : await seedRecent(state);
        state = await syncStateRepository.patch({
          visualSeedPhase: state.visualSeedPhase,
          visualSeedRecentOffset: state.visualSeedRecentOffset || 0,
          visualSeedHistoryAfterId: state.visualSeedHistoryAfterId || '',
          visualSeedScanned: state.visualSeedScanned || 0,
          visualSeedEnqueued: state.visualSeedEnqueued || 0,
          visualSeedRetained: state.visualSeedRetained || 0,
          visualSeedUpdatedAt: state.visualSeedUpdatedAt || new Date(now()),
          visualSeedCompletedAt: state.visualSeedCompletedAt || null,
          visualSeedLastErrorCode: ''
        });
      }
      return state;
    } catch (error) {
      logger.warn('Full feed visual seed failed', { message: error && error.message });
      await syncStateRepository.patch({
        visualSeedLastErrorCode: 'VISUAL_SEED_FAILED',
        visualSeedLastErrorAt: new Date(now())
      }).catch(() => {});
      throw error;
    }
  }

  return { run };
}

module.exports = { createFeedVisualSeedService, cutoffDate };
