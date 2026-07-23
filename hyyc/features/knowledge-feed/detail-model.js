const { DIRECT_WEBVIEW_HOSTS } = require('../../config/constants.js');
const { buildReadingGuide, buildRelatedItems, getOriginAction } = require('./reading.js');
const { decorateItemEngagement } = require('../engagement/model.js');
const { decorateSourcePresentation } = require('./source-presentation.js');

function formatDetailDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function previewSlides(fileIds, currentIndex = 0) {
  const values = Array.isArray(fileIds) ? fileIds : [];
  const total = values.length;
  const active = Math.max(0, Math.min(total - 1, Number(currentIndex) || 0));
  return values.map((fileId, index) => {
    const distance = Math.abs(index - active);
    const circularDistance = total > 1 ? Math.min(distance, total - distance) : distance;
    return { fileId, url: '', shouldLoad: circularDistance <= 1 };
  });
}

function decorateKnowledgeItem(item, feedItems = []) {
  const source = item && typeof item === 'object' ? item : {};
  const previewFileIds = Array.isArray(source.previewFileIds) ? source.previewFileIds : [];
  const related = source.relatedItems && source.relatedItems.length
    ? source.relatedItems
    : buildRelatedItems(feedItems, source);
  return decorateItemEngagement(decorateSourcePresentation({
    ...source,
    previewFileIds,
    previewSlides: previewSlides(previewFileIds, 0),
    publishedLabel: formatDetailDate(source.publishedAt),
    readingGuide: buildReadingGuide(source.summary),
    originAction: getOriginAction(source.url, DIRECT_WEBVIEW_HOSTS),
    relatedItems: related.map((entry) => decorateSourcePresentation({
      ...entry,
      publishedLabel: formatDetailDate(entry.publishedAt)
    }))
  }));
}

module.exports = { decorateKnowledgeItem, previewSlides };
