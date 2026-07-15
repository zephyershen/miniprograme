const { getKnowledgeFeed } = require('../../utils/api');
const { decorateChannels, channelByKey } = require('../../utils/channels');

function formatFeedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hour}:${minute}`;
}

function decorateFeed(raw = { items: [] }, activeChannel = 'all') {
  const items = (raw.items || [])
    .filter((item) => Boolean(item.coverFileId))
    .map((item, index) => ({
      ...item,
      publishedLabel: formatFeedDate(item.publishedAt),
      scoreLabel: Number.isFinite(Number(item.score)) ? `热度 ${item.score}` : '编辑精选',
      sequenceLabel: String(index + 1).padStart(2, '0')
    }));
  const visibleItems = activeChannel === 'all'
    ? items
    : items.filter((item) => item.channelKey === activeChannel);
  const channel = channelByKey(activeChannel);

  return {
    items,
    visibleItems,
    leadItem: visibleItems[0] || null,
    remainingItems: visibleItems.slice(1),
    channels: decorateChannels(items, activeChannel),
    activeChannel,
    activeChannelLabel: channel.label
  };
}

Page({
  data: {
    loading: true,
    activeChannel: 'all',
    feedError: '',
    feed: decorateFeed()
  },

  onShow() {
    this.loadFeed(false);
  },

  onPullDownRefresh() {
    this.loadFeed(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeed(force) {
    this.setData({ loading: true, feedError: '' });
    try {
      this.rawFeed = await getKnowledgeFeed(force);
      this.present(this.data.activeChannel);
    } catch (error) {
      this.present(this.data.activeChannel, error.message);
    } finally {
      this.setData({ loading: false });
    }
  },

  present(activeChannel, feedError = '') {
    const feed = decorateFeed(this.rawFeed || { items: [] }, activeChannel);
    getApp().globalData.knowledgeFeed = feed;
    this.setData({ feed, activeChannel, feedError });
  },

  selectChannel(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeChannel) return;
    this.present(key);
  },

  retryFeed() {
    this.loadFeed(true);
  },

  openFeedItem(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  }
});
