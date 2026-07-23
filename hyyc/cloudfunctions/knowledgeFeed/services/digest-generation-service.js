const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const WINDOW_DEFINITIONS = Object.freeze({
  '24h': Object.freeze({ cadence: 'daily', dueMinute: (8 * 60), minSources: 3 }),
  '7d': Object.freeze({ cadence: 'weekly', dueMinute: (8 * 60) + 5, minSources: 5 }),
  '30d': Object.freeze({ cadence: 'monthly', dueMinute: (8 * 60) + 10, minSources: 8 })
});

function shanghaiClock(timestamp) {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  return {
    dateKey: `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}${String(shifted.getUTCDate()).padStart(2, '0')}`,
    minuteOfDay: (shifted.getUTCHours() * 60) + shifted.getUTCMinutes()
  };
}

function shanghaiCalendar(timestamp) {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    ...shanghaiClock(timestamp)
  };
}

function shanghaiMidnightUtc(year, month, day) {
  return Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS;
}

function calendarPeriod(windowKey, timestamp) {
  const definition = WINDOW_DEFINITIONS[windowKey];
  if (!definition) throw new Error('DIGEST_WINDOW_INVALID');
  const calendar = shanghaiCalendar(timestamp);
  const todayStart = shanghaiMidnightUtc(calendar.year, calendar.month, calendar.day);
  if (definition.cadence === 'daily') {
    const start = todayStart - DAY_MS;
    return {
      periodKey: shanghaiClock(start).dateKey,
      windowStart: new Date(start),
      windowEnd: new Date(todayStart)
    };
  }
  if (definition.cadence === 'weekly') {
    const start = todayStart - (7 * DAY_MS);
    return {
      periodKey: `${shanghaiClock(start).dateKey}_${shanghaiClock(todayStart - DAY_MS).dateKey}`,
      windowStart: new Date(start),
      windowEnd: new Date(todayStart)
    };
  }
  const currentMonthStart = shanghaiMidnightUtc(calendar.year, calendar.month, 1);
  const previousMonth = new Date(Date.UTC(calendar.year, calendar.month - 1, 1));
  const previousMonthStart = shanghaiMidnightUtc(
    previousMonth.getUTCFullYear(),
    previousMonth.getUTCMonth(),
    1
  );
  return {
    periodKey: `${previousMonth.getUTCFullYear()}${String(previousMonth.getUTCMonth() + 1).padStart(2, '0')}`,
    windowStart: new Date(previousMonthStart),
    windowEnd: new Date(currentMonthStart)
  };
}

function digestScheduleIsDue(windowKey, timestamp) {
  const definition = WINDOW_DEFINITIONS[windowKey];
  if (!definition) return false;
  const calendar = shanghaiCalendar(timestamp);
  if (calendar.minuteOfDay < definition.dueMinute) return false;
  if (definition.cadence === 'weekly') return calendar.weekday === 1;
  if (definition.cadence === 'monthly') return calendar.day === 1;
  return true;
}

function dueWindowKeys(timestamp) {
  return Object.keys(WINDOW_DEFINITIONS)
    .filter((windowKey) => digestScheduleIsDue(windowKey, timestamp));
}

function referenceIds(result) {
  const ids = [];
  for (const key of ['mustKnow', 'radar', 'followUps']) {
    for (const entry of (Array.isArray(result && result[key]) ? result[key] : [])) {
      ids.push(...(Array.isArray(entry.sourceItemIds) ? entry.sourceItemIds : []));
    }
  }
  return [...new Set(ids)];
}

function publicEntry(entry, index) {
  return {
    index: String(index + 1).padStart(2, '0'),
    itemId: entry.sourceItemIds[0],
    sourceItemIds: entry.sourceItemIds,
    title: entry.title,
    name: entry.title,
    why: entry.copy,
    copy: entry.copy,
    tags: entry.tags || []
  };
}

function digestDocument({ windowKey, periodKey, windowStart, windowEnd, generatedAt, result, items, coverage }) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = referenceIds(result).filter((itemId) => byId.has(itemId));
  const references = ids.map((itemId) => {
    const item = byId.get(itemId);
    return {
      itemId,
      title: item.title || '',
      summary: item.summary || '',
      source: item.source || '',
      publishedAt: item.publishedAt || null,
      url: item.url || ''
    };
  });
  return {
    _id: `digest_${windowKey}_${periodKey}`,
    windowKey,
    periodKey,
    windowStart,
    windowEnd,
    generatedAt,
    executiveSummary: result.executiveSummary,
    mustKnow: result.mustKnow.map(publicEntry),
    radar: result.radar.map(publicEntry),
    followUps: result.followUps.map(publicEntry),
    sourceIndex: references.map((item) => ({
      itemId: item.itemId,
      title: item.title,
      source: item.source
    })),
    references,
    coverage: {
      state: coverage.ratio >= 0.95 && !coverage.truncated ? 'complete' : 'partial',
      ratio: coverage.ratio
    },
    intelligenceProvider: result.provider || '',
    model: result.model || '',
    usage: result.usage || null
  };
}

function createDigestGenerationService({
  provider,
  digestRepository,
  itemRepository,
  config = {},
  now = () => Date.now()
}) {
  async function generateWindow(windowKey, { force = false } = {}) {
    const definition = WINDOW_DEFINITIONS[windowKey];
    if (!definition) throw new Error('DIGEST_WINDOW_INVALID');
    const currentTime = now();
    if (!force && !digestScheduleIsDue(windowKey, currentTime)) {
      return { status: 'not-due', windowKey };
    }
    const period = calendarPeriod(windowKey, currentTime);
    const documentId = `digest_${windowKey}_${period.periodKey}`;
    if (!force && await digestRepository.get(documentId)) {
      return { status: 'current', windowKey, digestId: documentId };
    }
    const { windowStart, windowEnd } = period;
    const page = await itemRepository.queryPage({
      since: windowStart.toISOString(),
      until: windowEnd.toISOString(),
      channel: 'all', topicKeys: [], qualityTier: 'curated', sort: 'importance',
      offset: 0, cursor: '', limit: Math.max(10, Number(config.digestSourceLimit) || 40),
      includeCount: false
    });
    const items = (page.items || []).filter((item) => item.publicState === 'active');
    if (items.length < definition.minSources) {
      return { status: 'insufficient-sources', windowKey, sourceCount: items.length };
    }
    const previous = await digestRepository.latest(windowKey);
    const result = await provider.generateDigest({
      windowKey,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString()
    }, items, previous);
    const coverage = await itemRepository.analysisCoverage(windowStart, windowEnd);
    const published = await digestRepository.publish(digestDocument({
      windowKey,
      periodKey: period.periodKey,
      windowStart,
      windowEnd,
      generatedAt: new Date(currentTime),
      result,
      items,
      coverage
    }));
    return {
      status: 'generated',
      windowKey,
      digestId: published._id,
      sourceCount: published.sourceIndex.length,
      coverage: published.coverage
    };
  }

  async function runDue({ force = false, windowKeys = null } = {}) {
    if (!provider || provider.enabled !== true || config.digestGenerationEnabled !== true) {
      return { status: 'disabled', generated: [] };
    }
    const scheduledWindows = Array.isArray(windowKeys)
      ? windowKeys
      : (force ? Object.keys(WINDOW_DEFINITIONS) : dueWindowKeys(now()));
    if (!scheduledWindows.length) return { status: 'idle', generated: [] };
    const generated = [];
    for (const windowKey of scheduledWindows) {
      generated.push(await generateWindow(windowKey, { force }));
    }
    return {
      status: generated.some((item) => item.status === 'generated') ? 'generated' : 'idle',
      generated
    };
  }

  return { runDue, generateWindow };
}

module.exports = {
  WINDOW_DEFINITIONS,
  shanghaiClock,
  shanghaiCalendar,
  calendarPeriod,
  digestScheduleIsDue,
  dueWindowKeys,
  referenceIds,
  digestDocument,
  createDigestGenerationService
};
