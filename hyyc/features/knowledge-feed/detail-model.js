const { DIRECT_WEBVIEW_HOSTS } = require('../../config/constants.js');
const { buildReadingGuide, buildRelatedItems, getOriginAction } = require('./reading.js');

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

function decorateKnowledgeItem(item, feedItems = []) {
  const related = item.relatedItems && item.relatedItems.length ? item.relatedItems : buildRelatedItems(feedItems, item);
  return {
    ...item,
    publishedLabel: formatDetailDate(item.publishedAt),
    readingGuide: buildReadingGuide(item.summary),
    originAction: getOriginAction(item.url, DIRECT_WEBVIEW_HOSTS),
    relatedItems: related.map((entry) => ({ ...entry, publishedLabel: formatDetailDate(entry.publishedAt) }))
  };
}

module.exports = { decorateKnowledgeItem };
