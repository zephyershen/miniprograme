const COMMENT_LINK_MESSAGE = '评论不能包含链接，请删除后再发布';

const DOMAIN_SUFFIXES = [
  'app', 'ai', 'biz', 'cc', 'club', 'cn', 'co', 'com', 'dev', 'info',
  'io', 'link', 'live', 'me', 'net', 'online', 'org', 'pro', 'shop',
  'site', 'store', 'tech', 'top', 'tv', 'vip', 'work', 'xyz'
].join('|');

const DOMAIN_PATTERN = new RegExp(
  `(?:^|[^a-z0-9_-])(?:[a-z0-9\\u4e00-\\u9fff](?:[a-z0-9\\u4e00-\\u9fff-]{0,61}[a-z0-9\\u4e00-\\u9fff])?\\s*\\.\\s*)+(?:${DOMAIN_SUFFIXES})(?=$|[^a-z0-9_-])`,
  'i'
);
const OBFUSCATED_DOMAIN_PATTERN = new RegExp(
  `[a-z0-9-]{2,}\\s*(?:点|dot)\\s*(?:${DOMAIN_SUFFIXES})(?=$|[^a-z0-9_-])`,
  'i'
);

function normalizedCommentText(value) {
  const source = typeof value === 'string' ? value : '';
  const normalized = typeof source.normalize === 'function'
    ? source.normalize('NFKC')
    : source;
  return normalized
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[。｡﹒]/g, '.')
    .replace(/[／⁄]/g, '/')
    .toLowerCase();
}

function commentContainsLink(value) {
  const content = normalizedCommentText(value);
  if (!content) return false;
  return /(?:^|[^a-z0-9_])[a-z][a-z0-9+.-]{1,15}\s*:\s*\/{2}/i.test(content)
    || /(?:^|[^a-z0-9_])www\s*\./i.test(content)
    || /(?:^|[^\d])(?:\d{1,3}\s*\.\s*){3}\d{1,3}(?=$|[^\d])/i.test(content)
    || /(?:#?小程序|微信)\s*:\s*\/{2}/i.test(content)
    || DOMAIN_PATTERN.test(content)
    || OBFUSCATED_DOMAIN_PATTERN.test(content);
}

module.exports = {
  COMMENT_LINK_MESSAGE,
  commentContainsLink,
  normalizedCommentText
};
