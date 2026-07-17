function isScheduledTrigger(event, triggerName, triggerSource = process.env.TRIGGER_SRC) {
  return Boolean(
    event
    && event.Type === 'Timer'
    && event.TriggerName === triggerName
    && triggerSource === 'timer'
  );
}

function resolveScheduledTrigger(event, triggerNames, triggerSource = process.env.TRIGGER_SRC) {
  if (!event || event.Type !== 'Timer') return '';
  if (triggerSource !== 'timer') throw new Error('TIMER_SOURCE_REJECTED');
  const match = Object.entries(triggerNames || {})
    .find(([, triggerName]) => triggerName === event.TriggerName);
  if (!match) throw new Error('TIMER_NAME_REJECTED');
  return match[0];
}

module.exports = { isScheduledTrigger, resolveScheduledTrigger };
