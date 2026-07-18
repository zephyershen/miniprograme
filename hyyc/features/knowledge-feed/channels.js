const CHANNELS = Object.freeze([
  { key: 'all', label: '全部', marker: 'ALL', tone: 'ink' },
  { key: 'ai', label: 'AI 前沿', marker: 'AI', tone: 'cobalt' },
  { key: 'tech', label: '科技', marker: 'TECH', tone: 'cobalt' },
  { key: 'entertainment', label: '娱乐', marker: 'FUN', tone: 'coral' },
  { key: 'society', label: '社会', marker: 'NOW', tone: 'amber' },
  { key: 'games', label: '游戏', marker: 'PLAY', tone: 'lime' },
  { key: 'english', label: '英语', marker: 'EN', tone: 'cyan' }
]);

const CHANNEL_RULES = Object.freeze([
  { key: 'ai', pattern: /openai|chatgpt|grok|deepseek|glm|gpt|人工智能|大模型|模型|智谱|深度求索|生成式\s*ai|\bai\b/i },
  { key: 'games', pattern: /游戏|电竞|steam|xbox|playstation|nintendo|switch|手游|主机/i },
  { key: 'english', pattern: /英语|英文|english|vocabulary|grammar|口语|听力|雅思|托福/i },
  { key: 'entertainment', pattern: /娱乐|电影|音乐|综艺|演出|票房|剧集|明星|动漫/i },
  { key: 'society', pattern: /社会|城市|教育|政策|民生|公共|文化|就业|生活/i },
  { key: 'tech', pattern: /科技|技术|芯片|软件|硬件|开发|github|apple|google|microsoft|互联网|机器人/i }
]);

const FEATURED_SHORTCUT = Object.freeze({
  key: 'featured',
  label: '精选',
  tone: 'cobalt',
  premium: true,
  navigation: true,
  active: false,
  count: 0
});

function channelByKey(key) {
  return CHANNELS.find((channel) => channel.key === key) || CHANNELS[0];
}

function inferChannel(entry = {}) {
  const text = [entry.sourceHost, entry.sourceTitle, entry.summaryZh].filter(Boolean).join(' ');
  const rule = CHANNEL_RULES.find((candidate) => candidate.pattern.test(text));
  return channelByKey(rule ? rule.key : 'all');
}

function decorateChannels(entries, activeKey = 'all') {
  return CHANNELS.map((channel) => ({
    ...channel,
    active: channel.key === activeKey,
    count: channel.key === 'all'
      ? entries.length
      : entries.filter((entry) => entry.channelKey === channel.key).length
  }));
}

function decorateChannelCounts(countByKey = {}, activeKey = 'all') {
  return CHANNELS.map((channel) => ({
    ...channel,
    active: channel.key === activeKey,
    count: Math.max(0, Number(countByKey[channel.key]) || 0)
  }));
}

function addFeaturedShortcut(channels = []) {
  if (!channels.length) return [{ ...FEATURED_SHORTCUT }];
  return [channels[0], { ...FEATURED_SHORTCUT }, ...channels.slice(1)];
}

module.exports = {
  CHANNELS,
  FEATURED_SHORTCUT,
  channelByKey,
  inferChannel,
  decorateChannels,
  decorateChannelCounts,
  addFeaturedShortcut
};
