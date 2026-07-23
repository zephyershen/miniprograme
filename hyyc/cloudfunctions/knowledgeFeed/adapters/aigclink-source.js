const crypto = require('node:crypto');
const { inferTopicKeys } = require('../lib/topics');

const PROPERTY_KEYS = Object.freeze({
  tags: '>Dc>',
  summary: '@r`I',
  projectUrl: 'FWPt',
  category: 'MkyH',
  score: 'V;i=',
  collectedAt: 'vuJC',
  title: 'title'
});

function cleanText(value, maximum = 1200) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function richText(value) {
  if (!Array.isArray(value)) return '';
  return cleanText(value.map((part) => Array.isArray(part) ? part[0] : '').join(''));
}

function validHttpsUrl(value) {
  try {
    const parsed = new URL(cleanText(value, 1000));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function collectedDate(value) {
  const annotations = value && value[0] && value[0][1];
  const dateAnnotation = Array.isArray(annotations)
    ? annotations.find((entry) => Array.isArray(entry) && entry[0] === 'd')
    : null;
  const date = dateAnnotation && dateAnnotation[1] && dateAnnotation[1].start_date;
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function sourceTags(value) {
  const seen = new Set();
  return richText(value).split(/[,，]/).reduce((tags, entry) => {
    const tag = cleanText(entry, 40);
    const key = tag.toLocaleLowerCase('zh-CN');
    if (!tag || seen.has(key) || tags.length >= 8) return tags;
    seen.add(key);
    tags.push(tag);
    return tags;
  }, []);
}

function pageValue(record) {
  return record && record.value && record.value.value || null;
}

function detailUrl(config, pageId) {
  return `${config.siteRoot}/${pageId.replace(/-/g, '')}?pvs=25`;
}

function normalizeAigclinkRecord(record, config) {
  const page = pageValue(record);
  const properties = page && page.properties || {};
  const rawId = cleanText(page && page.id, 40);
  const title = richText(properties[PROPERTY_KEYS.title]);
  const summary = richText(properties[PROPERTY_KEYS.summary]);
  const date = collectedDate(properties[PROPERTY_KEYS.collectedAt]);
  if (!/^[a-f0-9-]{36}$/i.test(rawId) || !title || !date) return null;

  const permalink = detailUrl(config, rawId);
  const projectUrl = validHttpsUrl(richText(properties[PROPERTY_KEYS.projectUrl]));
  const tags = sourceTags(properties[PROPERTY_KEYS.tags]);
  const rawScore = Number(richText(properties[PROPERTY_KEYS.score]));
  const normalized = {
    id: `aigclink_${rawId.replace(/-/g, '')}`,
    title,
    titleEn: '',
    summary,
    url: projectUrl || permalink,
    permalink,
    source: 'GitHub 开源库',
    publishedAt: new Date(`${date}T12:00:00+08:00`).toISOString(),
    category: 'open-source-library',
    categoryLabel: cleanText(richText(properties[PROPERTY_KEYS.category]), 40) || '开源方案',
    categoryMarker: 'OPEN SOURCE',
    channelKey: 'tech',
    coverTone: 'cyan',
    score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore * 10))) : null,
    selected: false,
    sourceTags: tags,
    sourceChannelKeys: ['openSource'],
    sourceAvatarFileId: config.sourceAvatarFileId,
    attribution: { source: 'AIGCLINK', canonical: permalink }
  };
  return { ...normalized, topicKeys: inferTopicKeys({ ...normalized, sourceTags: tags }) };
}

function queryBody(config, { limit = config.maxItems, beforeDate = '' } = {}) {
  const filters = [];
  if (Array.isArray(config.excludedTags) && config.excludedTags.length) {
    filters.push({
      filter: {
        value: config.excludedTags.map((value) => ({ type: 'exact', value })),
        operator: 'enum_does_not_contain'
      },
      property: PROPERTY_KEYS.tags
    });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    filters.push({
      filter: {
        value: { type: 'exact', value: { start_date: beforeDate } },
        operator: 'date_is_on_or_before'
      },
      property: PROPERTY_KEYS.collectedAt
    });
  }
  return {
    clientType: 'notion_app',
    source: { type: 'collection', id: config.collectionId, spaceId: config.spaceId },
    collectionView: { id: config.viewId, spaceId: config.spaceId },
    loader: {
      reducers: {
        collection_group_results: {
          type: 'results',
          limit,
          loadContentCover: false
        }
      },
      filter: {
        operator: 'and',
        filters
      },
      sort: [{ property: PROPERTY_KEYS.collectedAt, direction: 'descending' }],
      searchQuery: '',
      archiveStatus: 'NON_ARCHIVED',
      userTimeZone: 'Asia/Shanghai'
    }
  };
}

function itemFingerprint(items) {
  const values = (items || []).map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt,
    categoryLabel: item.categoryLabel,
    score: item.score,
    sourceTags: item.sourceTags
  }));
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function createAigclinkSource(config, fetchImpl = fetch) {
  async function loadSegment({ limit = config.maxItems, beforeDate = '' } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(config.queryRoot, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'KnowledgePlatform/1.0 (+WeChat Mini Program)'
        },
        body: JSON.stringify(queryBody(config, { limit, beforeDate })),
        signal: controller.signal,
        redirect: 'error'
      });
      if (!response.ok) throw new Error(`AIGCLINK_SOURCE_${response.status}`);
      const payload = await response.json();
      const reducer = payload && payload.result && payload.result.reducerResults
        && payload.result.reducerResults.collection_group_results;
      const blocks = payload && payload.recordMap && payload.recordMap.block || {};
      const ids = reducer && Array.isArray(reducer.blockIds) ? reducer.blockIds : [];
      const items = [];
      let invalidBlockCount = 0;
      ids.forEach((id) => {
        if (!blocks[id]) return;
        const item = normalizeAigclinkRecord(blocks[id], config);
        if (item) items.push(item);
        else invalidBlockCount += 1;
      });
      return {
        items,
        blockCount: ids.length,
        missingBlockCount: ids.filter((id) => !blocks[id]).length,
        invalidBlockCount,
        hasMore: reducer && reducer.hasMore === true
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function observeHead() {
    const result = await loadSegment({ limit: config.headItems || 30 });
    if (result.invalidBlockCount > 0) throw new Error('AIGCLINK_SOURCE_INCOMPLETE');
    if (!result.items.length) throw new Error('AIGCLINK_SOURCE_EMPTY');
    return {
      fingerprint: itemFingerprint(result.items),
      itemCount: result.items.length,
      latestPublishedAt: result.items[0].publishedAt
    };
  }

  async function loadItems() {
    const unique = new Map();
    let beforeDate = '';
    let segments = 0;
    while (segments < Math.max(1, Number(config.maxSegments) || 10)) {
      const result = await loadSegment({ beforeDate });
      segments += 1;
      if (result.invalidBlockCount > 0) throw new Error('AIGCLINK_SOURCE_INCOMPLETE');
      const sizeBefore = unique.size;
      result.items.forEach((item) => unique.set(item.id, item));
      const truncated = result.hasMore || result.missingBlockCount > 0;
      if (!truncated) {
        const items = [...unique.values()].sort((left, right) => (
          new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
          || left.id.localeCompare(right.id)
        ));
        if (!items.length) throw new Error('AIGCLINK_SOURCE_EMPTY');
        return { items, hasMore: false, segmentCount: segments };
      }
      const oldest = result.items.reduce((value, item) => {
        const date = item.publishedAt.slice(0, 10);
        return !value || date < value ? date : value;
      }, '');
      if (!oldest || oldest === beforeDate || unique.size === sizeBefore) break;
      beforeDate = oldest;
    }
    throw new Error('AIGCLINK_SOURCE_TRUNCATED');
  }

  return { provider: 'aigclink', observeHead, loadItems };
}

module.exports = {
  PROPERTY_KEYS,
  richText,
  collectedDate,
  sourceTags,
  normalizeAigclinkRecord,
  queryBody,
  itemFingerprint,
  createAigclinkSource
};
