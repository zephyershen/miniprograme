const { AppError } = require('../lib/errors');

function isVisualMaintenanceEvent(event, triggerName, triggerSource = process.env.TRIGGER_SRC) {
  return Boolean(
    event
    && event.Type === 'Timer'
    && event.TriggerName === triggerName
    && triggerSource === 'timer'
  );
}

function createVisualMaintenanceService({
  cloud,
  feedService,
  coverService,
  previewService,
  previewMaintenanceToken,
  config,
  triggerSource = process.env.TRIGGER_SRC,
  logger = console
}) {
  function assertScheduledContext(event) {
    if (!isVisualMaintenanceEvent(event, config.triggerName, triggerSource)) {
      throw new AppError('TEMPORARY_FAILURE', '该操作仅供定时维护');
    }
  }

  async function run(event) {
    assertScheduledContext(event);
    const feed = await feedService.getFeed({ limit: 1 });
    const covers = await coverService.hydrateCovers(config.coverBatchSize, false, true);
    const previews = await previewService.hydratePreviews(
      config.previewBatchSize,
      false,
      previewMaintenanceToken
    );
    const status = await previewService.maintenanceStatus(previewMaintenanceToken);
    const result = {
      triggerName: config.triggerName,
      updatedAt: feed.updatedAt,
      stale: feed.stale,
      covers,
      previews,
      status
    };
    logger.info('Knowledge feed visual maintenance completed', result);
    return result;
  }

  return { run };
}

module.exports = { isVisualMaintenanceEvent, createVisualMaintenanceService };
