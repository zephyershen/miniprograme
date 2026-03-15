const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast } = require('../../../utils/ui');
const { loadGoodsCollections, setGoodsFavorite } = require('../../../utils/userGoodsStore');

const GOODS_THUMB_STYLE = 'goods_thumb';
const TEMP_URL_BATCH_SIZE = 50;

const STATUS_TEXT_MAP = {
  posted: '在售',
  sold: '已售出',
  off_shelf: '已下架',
  pending: '审核中',
  need_fix: '需修改'
};

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function toTimeMs(v) {
  if (!v) return 0;
  if (typeof v.getTime === 'function') return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

Page({
  data: {
    tab: 'favorite',
    favorites: [],
    history: [],
    list: [],
    isLoading: true
  },
  onShow() {
    this.load();
  },
  setTab(e) {
    const tab = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab, 'favorite');
    this.setData({ tab }, () => this.syncList());
  },
  _isCloudFileID(v = '') {
    return String(v || '').indexOf('cloud://') === 0;
  },
  async _getTempFileURLMap(fileIDs = [], style = '') {
    const raw = Array.isArray(fileIDs) ? fileIDs : [];
    const uniq = [];
    const seen = {};
    raw.forEach((id) => {
      const k = String(id || '');
      if (!k || seen[k]) return;
      seen[k] = true;
      uniq.push(k);
    });
    if (!uniq.length) return {};

    const map = {};
    for (let i = 0; i < uniq.length; i += TEMP_URL_BATCH_SIZE) {
      const res = await wx.cloud.getTempFileURL({
        fileList: uniq.slice(i, i + TEMP_URL_BATCH_SIZE).map((fileID) => ({
          fileID,
          maxAge: 60 * 30,
          ...(style ? { style } : {})
        }))
      });
      const list = (res && res.fileList) || [];
      list.forEach((item) => {
        if (item && item.fileID && item.tempFileURL) {
          map[item.fileID] = item.tempFileURL;
        }
      });
    }
    return map;
  },
  async _attachCoverUrls(list = []) {
    const raw = Array.isArray(list) ? list : [];
    const fileIDs = raw
      .map((item) => pickStr(item.coverImage, Array.isArray(item.images) ? item.images[0] : ''))
      .filter((fileID) => this._isCloudFileID(fileID));

    let urlMap = {};
    if (fileIDs.length) {
      try {
        urlMap = await this._getTempFileURLMap(fileIDs, GOODS_THUMB_STYLE);
      } catch (err) {
        console.error('加载收藏商品缩略图失败', err);
      }
    }

    return raw.map((item) => {
      const coverImage = pickStr(item.coverImage, Array.isArray(item.images) ? item.images[0] : '');
      return {
        ...item,
        coverImageUrl: this._isCloudFileID(coverImage) ? (urlMap[coverImage] || '') : coverImage
      };
    });
  },
  mapGoodsList(list = [], tab = 'favorite', favoriteIdMap = {}) {
    return (Array.isArray(list) ? list : []).map((item) => {
      const goodsId = pickStr(item.goodsId, item.id, item._id);
      const price = Number(item.price);
      const originalPrice = item.originalPrice;
      const timeMs = tab === 'favorite' ? toTimeMs(item.favoritedAtTs) : toTimeMs(item.viewedAtTs);
      const coverImage = pickStr(item.coverImageUrl, item.coverImage, Array.isArray(item.images) ? item.images[0] : '');
      const subParts = [];
      if (item.community) subParts.push(item.community);
      if (item.building) subParts.push(item.building);

      return {
        ...item,
        id: goodsId,
        goodsId,
        coverImage,
        priceText: Number.isFinite(price) ? formatMoney(price) : '',
        originalPriceText: (originalPrice != null && originalPrice !== '' && Number.isFinite(Number(originalPrice)))
          ? formatMoney(Number(originalPrice))
          : '',
        statusText: STATUS_TEXT_MAP[pickStr(item.status, 'posted')] || '已保存',
        timeText: timeMs ? formatDateTime(timeMs) : '',
        timeLabel: tab === 'favorite' ? '收藏于' : '浏览于',
        subText: subParts.join(' · '),
        isFavorite: !!favoriteIdMap[goodsId]
      };
    });
  },
  syncList() {
    const source = this.data.tab === 'history' ? this.data.history : this.data.favorites;
    this.setData({ list: source || [] });
  },
  async load() {
    this.setData({ isLoading: true });
    try {
      const { favorites, history } = await loadGoodsCollections();
      const favoriteIdMap = {};
      favorites.forEach((item) => {
        const goodsId = pickStr(item && item.goodsId);
        if (goodsId) favoriteIdMap[goodsId] = true;
      });

      const favoritesWithCovers = await this._attachCoverUrls(favorites);
      const historyWithCovers = await this._attachCoverUrls(history);

      let tab = this.data.tab || 'favorite';
      if (tab === 'favorite' && !favoritesWithCovers.length && historyWithCovers.length) {
        tab = 'history';
      }

      this.setData({
        tab,
        favorites: this.mapGoodsList(favoritesWithCovers, 'favorite', favoriteIdMap),
        history: this.mapGoodsList(historyWithCovers, 'history', favoriteIdMap),
        isLoading: false
      }, () => this.syncList());
    } catch (err) {
      console.error('加载收藏页失败', err);
      this.setData({
        favorites: [],
        history: [],
        list: [],
        isLoading: false
      });
      toast('加载失败，请稍后重试');
    }
  },
  onOpenGoods(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/goods/detail/index?id=${id}` });
  },
  async onToggleFavorite(e) {
    if (this._favoriteUpdating) return;

    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;

    const list = this.data.list || [];
    const current = list.find((item) => pickStr(item && item.goodsId, item && item.id) === id);
    if (!current) return;

    this._favoriteUpdating = true;
    try {
      const nextState = !current.isFavorite;
      await setGoodsFavorite(current, nextState);
      toast(nextState ? '已收藏' : '已取消收藏');
      await this.load();
    } catch (err) {
      console.error('切换收藏状态失败', err);
      toast('操作失败，请稍后重试');
    } finally {
      this._favoriteUpdating = false;
    }
  }
});
