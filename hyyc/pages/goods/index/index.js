const { formatMoney } = require('../../../utils/format');
const { getStoredUser } = require('../../../utils/userIdentity');

const db = wx.cloud.database();
const GOODS_COLLECTION = 'goods';

const GOODS_CATEGORY_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'digital', label: '电子数码' },
  { key: 'appliance', label: '家用电器' },
  { key: 'furniture', label: '家具家居' },
  { key: 'clothing', label: '服饰箱包' },
  { key: 'books', label: '图书文具' },
  { key: 'baby', label: '母婴玩具' },
  { key: 'sports', label: '运动户外' },
  { key: 'beauty', label: '美妆个护' },
  { key: 'other', label: '其他' }
];

const GOODS_CATEGORY_LABEL_MAP = GOODS_CATEGORY_OPTIONS.reduce((acc, it) => {
  acc[it.key] = it.label;
  return acc;
}, {});

const GOODS_CONDITION_LABEL_MAP = {
  new: '全新',
  '99': '99新',
  '95': '95新',
  '90': '9新',
  '80': '8新',
  '70': '7新及以下'
};

const GOODS_TRADE_LABEL_MAP = {
  face: '当面',
  mail: '邮寄'
};

// 云存储图片处理样式名：用于商品列表缩略图（在云开发控制台-存储-图片处理里创建）
const GOODS_THUMB_STYLE = 'goods_thumb';
// wx.cloud.getTempFileURL 单次 fileList 数量有上限，这里保守按 50 分批
const TEMP_URL_BATCH_SIZE = 50;
// 分页：每次从 DB 拉取的数量（后续可按体验调整）
const GOODS_PAGE_SIZE = 30;
// 发布商品后用于触发商品列表刷新
const GOODS_REFRESH_TOKEN_KEY = 'hyyc_goods_refresh_token';

// 商品瀑布流：封面高度 = 列宽 * coverRatio(height/width)，这里做一个夹逼，避免“海报图”极端拉长
const WATERFALL_COVER_RATIO_MIN = 0.85;
const WATERFALL_COVER_RATIO_MAX = 1.35;
// 图片预加载（缩略图）：并发/批次/缓存上限（按体验可调）
const THUMB_PREFETCH_CONCURRENCY = 4;
const THUMB_PREFETCH_BATCH = 12;
const THUMB_LOCAL_CACHE_MAX = 220;
// 版面：页面左右 padding 是 px-24（24rpx * 2），两列之间预留 16rpx 间距
const GOODS_WATERFALL_GAP_RPX = 16;
const PAGE_PADDING_X_RPX = 48;

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function toTimeMs(v) {
  if (!v) return 0;
  if (typeof v.getTime === 'function') return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function toMarkerFromAnchor(anchor) {
  if (!anchor) return null;
  return { t: toTimeMs(anchor.createdAt), id: pickStr(anchor.id) };
}

function toMarkerFromDoc(doc) {
  if (!doc) return null;
  return { t: toTimeMs(doc.createdAt || doc._createTime), id: pickStr(doc._id || doc.id) };
}

function isMarkerNewer(a, b) {
  if (!a || !a.id) return false;
  if (!b || !b.id) return true;
  if (a.t > b.t) return true;
  if (a.t < b.t) return false;
  // createdAt 相同：按 _id 做 tie-break（和列表 orderBy('_id','desc') 保持一致）
  return String(a.id) > String(b.id);
}

Page({
  data: {
    goodsCategory: 'all',
    goodsCategoryExpanded: false,
    goodsCategoryOptions: GOODS_CATEGORY_OPTIONS,
    currentGoodsCategoryLabel: GOODS_CATEGORY_LABEL_MAP.all,
    goodsTotal: 0,
    // 虚拟瀑布流：只渲染视口附近的 item
    renderLeft: [],
    renderRight: [],
    virtualLeftTopPx: 0,
    virtualLeftBottomPx: 0,
    virtualRightTopPx: 0,
    virtualRightBottomPx: 0,
    hasMore: true,
    isLoadingMore: false,
    loadMoreError: '',
    isLoading: true,
    // 顶部提示：有新商品（点击刷新）
    showNewGoodsTip: false
  },
  onLoad() {
    // Tab 页会被缓存：onShow 会频繁触发，但不希望每次都重刷列表。
    this._pageInited = false;
    this._handledRefreshToken = Number(wx.getStorageSync(GOODS_REFRESH_TOKEN_KEY) || 0) || 0;
    this._savedScrollTop = 0;

    // 新商品提示（watch：像“开着对讲机”，有新数据就会通知）
    this._newGoodsWatcher = null;
    this._newGoodsWatchKey = '';
    this._newGoodsWatchInited = false;
    this._newGoodsWatchLatest = null;

    // 缩略图预加载缓存：thumbUrl -> wxfile temp path
    this._thumbLocalByUrl = {};
    this._thumbLocalQueue = [];
    this._thumbPrefetching = {};
    this._thumbPrefetchTimer = null;
    this._thumbErrorRefreshTried = {};
    this._pendingStopPullDownRefresh = false;
  },
  onShow() {
    this._isVisible = true;
    const u = getStoredUser();
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }
    this._initVirtualEnv();

    const token = Number(wx.getStorageSync(GOODS_REFRESH_TOKEN_KEY) || 0) || 0;
    const needRefresh = token && token !== this._handledRefreshToken;

    // 首次进入 / 从发布页回来：刷新列表
    if (!this._pageInited || needRefresh) {
      this._pageInited = true;
      this._handledRefreshToken = token;
      this._savedScrollTop = 0;
      this._lastScrollTop = 0;
      if (wx.pageScrollTo) {
        wx.pageScrollTo({
          scrollTop: 0,
          duration: 0,
          complete: () => this.loadGoods(true)
        });
      } else {
        this.loadGoods(true);
      }
      return;
    }

    // 非刷新场景：保留列表 & 视情况恢复滚动位置
    this._virtualContainerTopPx = null;
    this._openNewGoodsWatch();
    setTimeout(() => this._restoreScrollIfNeeded(), 0);
  },
  onPageScroll(e) {
    this._lastScrollTop = Number(e && e.scrollTop) || 0;
    this._scheduleVirtualUpdate();
    this._maybePrefetchMore();
    this._scheduleThumbPrefetch();
  },
  onReachBottom() {
    this.loadMoreGoods();
  },
  onPullDownRefresh() {
    this._refreshGoodsFromTop({ stopPullDown: true });
  },
  onHide() {
    if (this.data.goodsCategoryExpanded) {
      this.setData({ goodsCategoryExpanded: false });
    }
    this._isVisible = false;
    this._savedScrollTop = Number(this._lastScrollTop || 0) || 0;
    this._clearVirtualTimers();
    this._clearNewGoodsWatch();
  },
  onUnload() {
    this._isVisible = false;
    this._clearVirtualTimers();
    this._clearNewGoodsWatch();
  },
  _clearNewGoodsWatch() {
    if (this._newGoodsWatcher && this._newGoodsWatcher.close) {
      this._newGoodsWatcher.close();
    }
    this._newGoodsWatcher = null;
    this._newGoodsWatchKey = '';
    this._newGoodsWatchInited = false;
    this._newGoodsWatchLatest = null;
  },
  _openNewGoodsWatch(force = false) {
    if (!this._isVisible) return;

    const u = getStoredUser();
    const community = pickStr(u.community);
    const c = pickStr(this.data.goodsCategory) || 'all';
    const key = `${community}::${c}`;

    if (!force && this._newGoodsWatcher && this._newGoodsWatchKey === key) return;

    this._clearNewGoodsWatch();
    this._newGoodsWatchKey = key;

    const where = { status: 'posted' };
    if (community) where.community = community;
    if (c && c !== 'all') where.category = c;

    try {
      this._newGoodsWatcher = db.collection(GOODS_COLLECTION)
        .where(where)
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .limit(1)
        .watch({
          onChange: (snapshot) => this._onNewGoodsWatchChange(snapshot),
          onError: (err) => {
            console.error('商品列表新商品 watch error', err);
          }
        });
    } catch (e) {
      console.error('开启新商品监听失败', e);
    }
  },
  _onNewGoodsWatchChange(snapshot) {
    if (!this._isVisible) return;
    const docs = (snapshot && snapshot.docs) || [];
    const latest = toMarkerFromDoc(docs[0]);
    if (!latest || !latest.id) return;

    // 列表还在加载时，不提示（刚进页面那次加载是最新的，不需要提示条）
    if (this.data.isLoading) {
      this._newGoodsWatchInited = true;
      this._newGoodsWatchLatest = latest;
      return;
    }

    const anchor = toMarkerFromAnchor(this._goodsAnchor);
    const hasAnyList = Number(this.data.goodsTotal || 0) > 0;

    // 第一次回调：只记录“当前最新”，不主动弹提示
    if (!this._newGoodsWatchInited) {
      this._newGoodsWatchInited = true;
      this._newGoodsWatchLatest = latest;

      // 如果页面已有列表，但顶部边界(anchor)比当前最新更旧，说明有新商品需要刷新
      if (hasAnyList && anchor && isMarkerNewer(latest, anchor)) {
        if (!this.data.showNewGoodsTip) this.setData({ showNewGoodsTip: true });
      }

      // 如果当前列表为空，但 watch 已经看到有商品了，也给个提示
      if (!hasAnyList && !this.data.showNewGoodsTip) {
        this.setData({ showNewGoodsTip: true });
      }
      return;
    }

    const prev = this._newGoodsWatchLatest;
    const changed = !prev || latest.id !== prev.id || latest.t !== prev.t;
    if (!changed) return;

    this._newGoodsWatchLatest = latest;

    // 已经有列表：只有当“最新商品”比本次列表会话的顶部边界更新时，才提示刷新
    if (hasAnyList) {
      if (anchor && isMarkerNewer(latest, anchor)) {
        if (!this.data.showNewGoodsTip) this.setData({ showNewGoodsTip: true });
      }
      return;
    }

    // 列表为空：有新商品时直接提示
    if (!this.data.showNewGoodsTip) this.setData({ showNewGoodsTip: true });
  },
  onTapNewGoodsTip() {
    this._refreshGoodsFromTop();
  },
  _finishPullDownRefresh() {
    if (!this._pendingStopPullDownRefresh) return;
    this._pendingStopPullDownRefresh = false;
    wx.stopPullDownRefresh();
  },
  _refreshGoodsFromTop(options = {}) {
    const stopPullDown = !!(options && options.stopPullDown);
    if (stopPullDown) this._pendingStopPullDownRefresh = true;

    this.setData({ showNewGoodsTip: false }, () => {
      if (wx.pageScrollTo) {
        wx.pageScrollTo({
          scrollTop: 0,
          duration: 0,
          complete: () => {
            this._lastScrollTop = 0;
            this.loadGoods(true);
          }
        });
      } else {
        this._lastScrollTop = 0;
        this.loadGoods(true);
      }
    });
  },
  _clearVirtualTimers() {
    if (this._virtualUpdateTimer) clearTimeout(this._virtualUpdateTimer);
    this._virtualUpdateTimer = null;
    if (this._heightCorrectTimer) clearTimeout(this._heightCorrectTimer);
    this._heightCorrectTimer = null;
    if (this._thumbPrefetchTimer) clearTimeout(this._thumbPrefetchTimer);
    this._thumbPrefetchTimer = null;
  },
  _getCoverThumbUrl(g) {
    const it0 = g && g.imagesPreview && g.imagesPreview[0];
    const url = it0 && it0.thumbUrl;
    return typeof url === 'string' ? url : '';
  },
  _isLocalFilePath(src = '') {
    const s = String(src || '');
    return s.indexOf('wxfile://') === 0;
  },
  _touchThumbCache(url = '') {
    const u = String(url || '');
    if (!u) return;
    this._thumbLocalQueue = this._thumbLocalQueue || [];
    // 用一个很小的 LRU 队列控制缓存上限（队列长度也不大，O(n) 足够）
    const q = this._thumbLocalQueue;
    const idx = q.indexOf(u);
    if (idx >= 0) q.splice(idx, 1);
    q.push(u);
    if (q.length <= THUMB_LOCAL_CACHE_MAX) return;

    // 简单 FIFO 回收：只移除 map 引用，不强制删除临时文件（避免频繁 IO）
    while (q.length > THUMB_LOCAL_CACHE_MAX) {
      const rm = q.shift();
      if (rm && this._thumbLocalByUrl && this._thumbLocalByUrl[rm]) {
        delete this._thumbLocalByUrl[rm];
      }
    }
  },
  _scheduleThumbPrefetch() {
    if (!this._isVisible) return;
    if (this.data.isLoading) return;
    if (this.data.isLoadingMore) return;
    if (!this._virtualMetaLeft || !this._virtualMetaRight) return;
    if (this._virtualContainerTopPx == null) {
      this._measureVirtualContainerTop(() => this._scheduleThumbPrefetch());
      return;
    }
    if (this._thumbPrefetchTimer) clearTimeout(this._thumbPrefetchTimer);
    // 等滚动停下来一小会再预取，避免滑动过程中抢占带宽/解码导致掉帧
    this._thumbPrefetchTimer = setTimeout(() => {
      this._thumbPrefetchTimer = null;
      this._prefetchThumbsNearViewport();
    }, 140);
  },
  _downloadThumb(url = '') {
    const u = String(url || '');
    if (!u) return Promise.reject(new Error('empty url'));
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: u,
        success: (res) => {
          const code = Number(res && res.statusCode);
          const path = res && res.tempFilePath;
          if (code >= 200 && code < 300 && path) resolve(path);
          else reject(new Error(`download fail: ${code}`));
        },
        fail: reject
      });
    });
  },
  async _prefetchThumbsNearViewport() {
    if (!this._isVisible) return;
    if (this.data.isLoading) return;
    const leftMeta = this._virtualMetaLeft;
    const rightMeta = this._virtualMetaRight;
    if (!leftMeta || !rightMeta) return;
    if (this._virtualContainerTopPx == null) return;

    const wh = Number(this._windowHeightPx || 0) || 667;
    const bufferPx = this._getVirtualBufferPx();
    const scrollTopPx = Number(this._lastScrollTop || 0) || 0;
    const relTopPx = scrollTopPx - Number(this._virtualContainerTopPx || 0);

    // 可视区（不含 buffer）
    const visStartY = relTopPx;
    const visEndY = relTopPx + wh;
    // 渲染区（含 buffer）
    const renderStartY = relTopPx - bufferPx;
    const renderEndY = relTopPx + wh + bufferPx;
    // 预取区：在渲染区基础上再向前/向后扩一屏左右
    const extraPx = Math.max(500, Math.min(Math.round(wh * 1.4), 1400));
    const preStartY = renderStartY - extraPx;
    const preEndY = renderEndY + extraPx;

    const visL = this._calcVirtualRange(leftMeta, visStartY, visEndY);
    const visR = this._calcVirtualRange(rightMeta, visStartY, visEndY);
    const rendL = this._calcVirtualRange(leftMeta, renderStartY, renderEndY);
    const rendR = this._calcVirtualRange(rightMeta, renderStartY, renderEndY);
    const preL = this._calcVirtualRange(leftMeta, preStartY, preEndY);
    const preR = this._calcVirtualRange(rightMeta, preStartY, preEndY);

    const cand = [];
    const pushRange = (meta, startIdx, endIdx) => {
      const s = Number(startIdx);
      const e = Number(endIdx);
      if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return;
      const items = meta.items || [];
      for (let i = s; i <= e; i += 1) {
        const g = items[i];
        if (!g || !g.id) continue;
        const url = this._getCoverThumbUrl(g);
        if (!url) continue;
        cand.push({ id: g.id, url });
      }
    };

    // 优先顺序：下方 buffer → 更远的下方 → 上方 buffer → 更远的上方
    pushRange(leftMeta, visL.end + 1, rendL.end);
    pushRange(rightMeta, visR.end + 1, rendR.end);
    pushRange(leftMeta, rendL.end + 1, preL.end);
    pushRange(rightMeta, rendR.end + 1, preR.end);
    pushRange(leftMeta, rendL.start, visL.start - 1);
    pushRange(rightMeta, rendR.start, visR.start - 1);
    pushRange(leftMeta, preL.start, rendL.start - 1);
    pushRange(rightMeta, preR.start, rendR.start - 1);

    if (!cand.length) return;

    this._thumbLocalByUrl = this._thumbLocalByUrl || {};
    this._thumbPrefetching = this._thumbPrefetching || {};

    const seen = {};
    const toDownload = [];
    let needRenderRefresh = false;
    const vs = this._virtualState || {};

    for (let i = 0; i < cand.length && toDownload.length < THUMB_PREFETCH_BATCH; i += 1) {
      const { id, url } = cand[i];
      if (!id || !url) continue;
      if (seen[url]) continue;
      seen[url] = true;

      const cached = this._thumbLocalByUrl[url];
      if (cached) {
        const g = this._goodsById && this._goodsById[id];
        if (g && !this._isLocalFilePath(g.coverSrc) && g.coverSrc !== cached) {
          g.coverSrc = cached;
          const pos = this._goodsPos && this._goodsPos[id];
          if (pos && pos.col === 'left' && pos.idx >= vs.ls && pos.idx <= vs.le) needRenderRefresh = true;
          if (pos && pos.col === 'right' && pos.idx >= vs.rs && pos.idx <= vs.re) needRenderRefresh = true;
        }
        continue;
      }

      if (this._thumbPrefetching[url]) continue;

      // 若 item 已经是本地 src，就没必要再预取
      const g0 = this._goodsById && this._goodsById[id];
      if (g0 && this._isLocalFilePath(g0.coverSrc)) continue;

      toDownload.push({ id, url });
    }

    if (!toDownload.length) {
      if (needRenderRefresh) this._scheduleVirtualUpdate(true);
      return;
    }

    const queue = toDownload.slice();
    const worker = async () => {
      if (!this._isVisible) return;
      const task = queue.shift();
      if (!task) return;
      const { id, url } = task;

      this._thumbPrefetching[url] = true;
      try {
        const localPath = await this._downloadThumb(url);
        if (!localPath) return;
        this._thumbLocalByUrl[url] = localPath;
        this._touchThumbCache(url);

        const g = this._goodsById && this._goodsById[id];
        if (g && !this._isLocalFilePath(g.coverSrc)) {
          g.coverSrc = localPath;
          const pos = this._goodsPos && this._goodsPos[id];
          if (pos && pos.col === 'left' && pos.idx >= vs.ls && pos.idx <= vs.le) needRenderRefresh = true;
          if (pos && pos.col === 'right' && pos.idx >= vs.rs && pos.idx <= vs.re) needRenderRefresh = true;
        }
      } catch (e) {
        // ignore
      } finally {
        delete this._thumbPrefetching[url];
      }

      return worker();
    };

    const n = Math.max(1, Math.min(THUMB_PREFETCH_CONCURRENCY, queue.length));
    await Promise.all(Array.from({ length: n }, worker));
    if (needRenderRefresh) this._scheduleVirtualUpdate(true);
  },
  _restoreScrollIfNeeded() {
    if (!this._isVisible) return;
    if (!wx.pageScrollTo) return;
    const target = Number(this._savedScrollTop || 0) || 0;
    if (target <= 0) {
      // 即便不需要恢复，也刷新一次虚拟渲染范围（从其他 tab 切回来可能布局有变化）
      this._scheduleVirtualUpdate(true);
      return;
    }

    const query = wx.createSelectorQuery().in(this);
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const viewport = res && res[0];
      const cur = Number(viewport && viewport.scrollTop);
      // 若系统已帮我们保留滚动位置，就不强行 pageScrollTo，避免闪一下。
      if (Number.isFinite(cur) && Math.abs(cur - target) < 2) {
        this._lastScrollTop = cur;
        this._scheduleVirtualUpdate(true);
        return;
      }
      if (Number.isFinite(cur) && cur > 2) {
        // 用户已经在新的滚动位置（比如手动拖动滚动条），尊重当前状态。
        this._lastScrollTop = cur;
        this._scheduleVirtualUpdate(true);
        return;
      }

      wx.pageScrollTo({
        scrollTop: target,
        duration: 0,
        complete: () => {
          this._lastScrollTop = target;
          this._scheduleVirtualUpdate(true);
        }
      });
    });
  },
  _getGoodsCategoryLabel(category = 'all') {
    const k = pickStr(category) || 'all';
    return GOODS_CATEGORY_LABEL_MAP[k] || GOODS_CATEGORY_LABEL_MAP.all || '全部';
  },
  toggleGoodsCategoryExpand() {
    this.setData({ goodsCategoryExpanded: !this.data.goodsCategoryExpanded });
  },
  closeGoodsCategoryDrawer() {
    if (!this.data.goodsCategoryExpanded) return;
    this.setData({ goodsCategoryExpanded: false });
  },
  noop() {},
  _applyGoodsCategory(k = 'all') {
    const nextKey = pickStr(k) || 'all';
    const nextLabel = this._getGoodsCategoryLabel(nextKey);
    if (nextKey === this.data.goodsCategory) {
      this.setData({
        goodsCategoryExpanded: false,
        currentGoodsCategoryLabel: nextLabel
      });
      return;
    }
    this.setData({
      goodsCategory: nextKey,
      goodsCategoryExpanded: false,
      currentGoodsCategoryLabel: nextLabel
    }, () => {
      // 切换分类后回到顶部：避免在旧滚动位置刷新，导致虚拟列表范围计算不准/出现空白。
      if (wx.pageScrollTo) {
        wx.pageScrollTo({
          scrollTop: 0,
          duration: 0,
          complete: () => {
            this._lastScrollTop = 0;
            this.loadGoods(true);
          }
        });
      } else {
        this._lastScrollTop = 0;
        this.loadGoods(true);
      }
    });
  },
  changeGoodsCategory(e) {
    const k = e.currentTarget.dataset.k || 'all';
    this._applyGoodsCategory(k);
  },
  retryLoadMore() {
    this.loadMoreGoods(true);
  },
  // 列表卡片点击：进入商品详情
  toGoodsDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/goods/detail/index?id=${encodeURIComponent(id)}`
    });
  },
  _getWindowInfoSafe() {
    // wx.getSystemInfoSync 已被标记为 deprecated；优先使用 getWindowInfo。
    // 仅在低基础库缺失 getWindowInfo 时才回退旧接口（可能会有 warning，但兼容不崩）。
    if (wx.getWindowInfo) return wx.getWindowInfo();
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync();
    return {};
  },
  _initVirtualEnv() {
    const win = this._getWindowInfoSafe();
    this._windowHeightPx = Number(win.windowHeight || 0) || 667;
    this._windowWidthPx = Number(win.windowWidth || 0) || 375;
    this._rpx2px = (Number(this._windowWidthPx || 0) || 375) / 750;
    // 记录最新滚动位置（单位 px）
    if (!Number.isFinite(this._lastScrollTop)) this._lastScrollTop = 0;
  },
  _getVirtualBufferPx() {
    const wh = Number(this._windowHeightPx || 0) || 667;
    // 预渲染 1 屏左右，避免快速滑动时出现大面积空白
    return Math.max(260, Math.min(Math.round(wh * 1.0), 1100));
  },
  _getPrefetchDistancePx() {
    const wh = Number(this._windowHeightPx || 0) || 667;
    // 距离底部约 1~1.5 屏时开始预取下一页，减少用户“滑到底才开始等”的感知
    return Math.max(360, Math.min(Math.round(wh * 1.2), 1400));
  },
  _lowerBound(arr, target) {
    const a = Array.isArray(arr) ? arr : [];
    let lo = 0;
    let hi = a.length;
    const t = Number(target) || 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(a[mid]) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  },
  _buildVirtualColumnMeta(items = [], gapPx = 0) {
    const list = Array.isArray(items) ? items : [];
    const n = list.length;
    const g = Math.max(0, Number(gapPx) || 0);

    const prefixHeights = new Array(n + 1);
    prefixHeights[0] = 0;
    for (let i = 0; i < n; i += 1) {
      const h = Math.max(0, Number(list[i] && list[i]._predHeightPx) || 0);
      prefixHeights[i + 1] = prefixHeights[i] + h;
    }

    // bottom(i) = top(i) + height(i) = prefixHeights[i+1] + gap * i
    const bottoms = new Array(n);
    for (let i = 0; i < n; i += 1) {
      bottoms[i] = prefixHeights[i + 1] + g * i;
    }

    const totalHeight = n ? (prefixHeights[n] + g * (n - 1)) : 0;
    return {
      items: list,
      prefixHeights,
      bottoms,
      gapPx: g,
      totalHeight
    };
  },
  _calcVirtualRange(meta, startY, endY) {
    const m = meta || {};
    const n = (m.items && m.items.length) || 0;
    if (!n) {
      return {
        start: 0,
        end: -1,
        topPx: 0,
        bottomPx: 0
      };
    }

    const sY = Number(startY) || 0;
    const eY = Number(endY) || 0;

    let start = this._lowerBound(m.bottoms, sY);
    if (start < 0) start = 0;
    if (start >= n) start = n - 1;

    // end：最后一个 top <= eY 的 item
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const top = (m.prefixHeights[mid] || 0) + (m.gapPx || 0) * mid;
      if (top <= eY) lo = mid + 1;
      else hi = mid;
    }
    let end = lo - 1;
    if (end < start) end = start;
    if (end >= n) end = n - 1;

    const topPx = (m.prefixHeights[start] || 0) + (m.gapPx || 0) * start;
    const bottomPx = Math.max(0, (m.totalHeight || 0) - (m.bottoms[end] || 0));
    return { start, end, topPx, bottomPx };
  },
  _measureVirtualContainerTop(cb) {
    if (this._measuringVirtualTop) return;
    this._measuringVirtualTop = true;
    const query = wx.createSelectorQuery().in(this);
    query.select('#goodsVirtual').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      this._measuringVirtualTop = false;
      const rect = res && res[0];
      const viewport = res && res[1];
      if (rect) {
        const vst = viewport ? viewport.scrollTop : undefined;
        const scrollTop = Number.isFinite(Number(vst)) ? Number(vst) : (Number(this._lastScrollTop) || 0);
        this._virtualContainerTopPx = Number(rect.top || 0) + scrollTop;
      } else {
        // 没有节点时给一个兜底，避免 update → measure → update 无限循环
        this._virtualContainerTopPx = 0;
      }
      if (typeof cb === 'function') cb(this._virtualContainerTopPx);
    });
  },
  _scheduleVirtualUpdate(force = false) {
    if (!this._virtualMetaLeft && !this._virtualMetaRight) return;
    if (force) {
      this._updateVirtualRender(true);
      return;
    }
    if (this._virtualUpdateTimer) return;
    this._virtualUpdateTimer = setTimeout(() => {
      this._virtualUpdateTimer = null;
      this._updateVirtualRender(false);
    }, 32);
  },
  _updateVirtualRender(force = false) {
    const leftMeta = this._virtualMetaLeft;
    const rightMeta = this._virtualMetaRight;
    if (!leftMeta || !rightMeta) return;

    // 未测到容器顶部时，先测一次（异步），再执行 render 更新
    if (this._virtualContainerTopPx == null) {
      this._measureVirtualContainerTop(() => this._updateVirtualRender(true));
      return;
    }

    const wh = Number(this._windowHeightPx || 0) || 667;
    const bufferPx = this._getVirtualBufferPx();
    const scrollTopPx = Number(this._lastScrollTop || 0) || 0;
    const relTopPx = scrollTopPx - Number(this._virtualContainerTopPx || 0);

    const startY = relTopPx - bufferPx;
    const endY = relTopPx + wh + bufferPx;

    const leftRange = this._calcVirtualRange(leftMeta, startY, endY);
    const rightRange = this._calcVirtualRange(rightMeta, startY, endY);

    const nextState = {
      ls: leftRange.start,
      le: leftRange.end,
      rs: rightRange.start,
      re: rightRange.end
    };
    const prev = this._virtualState || {};
    const sameRange = prev.ls === nextState.ls
      && prev.le === nextState.le
      && prev.rs === nextState.rs
      && prev.re === nextState.re;

    if (!force && sameRange) return;
    this._virtualState = nextState;

    const nextLeft = (leftMeta.items || []).slice(leftRange.start, leftRange.end + 1);
    const nextRight = (rightMeta.items || []).slice(rightRange.start, rightRange.end + 1);

    this.setData({
      renderLeft: nextLeft,
      renderRight: nextRight,
      virtualLeftTopPx: Math.max(0, Math.round(leftRange.topPx || 0)),
      virtualLeftBottomPx: Math.max(0, Math.round(leftRange.bottomPx || 0)),
      virtualRightTopPx: Math.max(0, Math.round(rightRange.topPx || 0)),
      virtualRightBottomPx: Math.max(0, Math.round(rightRange.bottomPx || 0))
    }, () => {
      this._scheduleHeightCorrection();
    });
  },
  _scheduleHeightCorrection() {
    if (this.data.isLoading) return;
    if (!this._virtualMetaLeft || !this._virtualMetaRight) return;
    if (this._heightCorrectTimer) clearTimeout(this._heightCorrectTimer);
    // 等用户滚动停下来再测量/校正，减少滚动过程中的抖动
    this._heightCorrectTimer = setTimeout(() => {
      this._heightCorrectTimer = null;
      this._correctHeightsFromDOM();
    }, 180);
  },
  _correctHeightsFromDOM() {
    const leftMeta = this._virtualMetaLeft;
    const rightMeta = this._virtualMetaRight;
    if (!leftMeta || !rightMeta) return;
    if (!this._goodsById) return;

    const query = wx.createSelectorQuery().in(this);
    query.selectAll('#goodsVirtual .goods-card').fields({ dataset: true, size: true }, (nodes) => {
      const list = Array.isArray(nodes) ? nodes : [];
      if (!list.length) return;

      this._measuredCardHeight = this._measuredCardHeight || {};
      let leftChanged = false;
      let rightChanged = false;

      list.forEach((it) => {
        const ds = (it && it.dataset) ? it.dataset : {};
        const id = ds.id;
        const h = Number(it && it.height);
        if (!id || !Number.isFinite(h) || h <= 0) return;

        const prevMeasured = Number(this._measuredCardHeight[id]);
        if (Number.isFinite(prevMeasured) && Math.abs(prevMeasured - h) < 1) return;
        this._measuredCardHeight[id] = h;

        const g = this._goodsById[id];
        if (!g) return;
        const old = Number(g._predHeightPx) || 0;
        if (!old) return;

        const delta = h - old;
        // 差异太小就不更新，避免因为字体渲染/小数取整导致反复抖动
        if (Math.abs(delta) < 2) return;

        g._predHeightPx = h;
        if (ds.col === 'left') leftChanged = true;
        else if (ds.col === 'right') rightChanged = true;
        else {
          // dataset 丢失时用位置表兜底
          const pos = this._goodsPos && this._goodsPos[id];
          if (pos && pos.col === 'left') leftChanged = true;
          if (pos && pos.col === 'right') rightChanged = true;
        }
      });

      if (!leftChanged && !rightChanged) return;

      const gapPx = Number(this._waterfallGapPx) || 0;
      if (leftChanged) this._virtualMetaLeft = this._buildVirtualColumnMeta(this._leftItems || [], gapPx);
      if (rightChanged) this._virtualMetaRight = this._buildVirtualColumnMeta(this._rightItems || [], gapPx);

      // meta 更新后，刷新一次可视范围 & spacer
      this._scheduleVirtualUpdate(true);
    });
    query.exec();
  },
  _maybePrefetchMore() {
    if (!this.data.hasMore) return;
    if (this.data.isLoading || this.data.isLoadingMore) return;
    const leftMeta = this._virtualMetaLeft;
    const rightMeta = this._virtualMetaRight;
    if (!leftMeta || !rightMeta) return;
    if (this._virtualContainerTopPx == null) return;

    const wh = Number(this._windowHeightPx || 0) || 667;
    const prefetchPx = this._getPrefetchDistancePx();
    const scrollTopPx = Number(this._lastScrollTop || 0) || 0;
    const contentHeight = Math.max(Number(leftMeta.totalHeight || 0), Number(rightMeta.totalHeight || 0));
    const bottomPx = Number(this._virtualContainerTopPx || 0) + contentHeight;

    if (scrollTopPx + wh + prefetchPx >= bottomPx) {
      this.loadMoreGoods();
    }
  },
  _maybeFillViewport() {
    if (!this.data.hasMore) return;
    if (this.data.isLoading || this.data.isLoadingMore) return;
    const leftMeta = this._virtualMetaLeft;
    const rightMeta = this._virtualMetaRight;
    if (!leftMeta || !rightMeta) return;

    const wh = Number(this._windowHeightPx || 0) || 667;
    const contentHeight = Math.max(Number(leftMeta.totalHeight || 0), Number(rightMeta.totalHeight || 0));
    // 内容不够一屏时，用户无法滚动触发 onReachBottom，这里主动补一页
    if (contentHeight > 0 && contentHeight < wh * 1.05) {
      this.loadMoreGoods();
    }
  },
  _getRpx2px() {
    const cached = Number(this._rpx2px);
    if (Number.isFinite(cached) && cached > 0) return cached;

    const win = this._getWindowInfoSafe();
    const ww = Number(win.windowWidth || 0) || 375;
    this._windowWidthPx = ww;
    if (win && win.windowHeight != null) this._windowHeightPx = Number(win.windowHeight || 0) || this._windowHeightPx || 667;
    this._rpx2px = ww / 750;
    return this._rpx2px;
  },
  _getGoodsColumnWidthPx() {
    const rpx2px = this._getRpx2px();
    const ww = Number(this._windowWidthPx || 0) || 375;
    const gapPx = GOODS_WATERFALL_GAP_RPX * rpx2px;
    const padPx = PAGE_PADDING_X_RPX * rpx2px;
    const w = (ww - padPx - gapPx) / 2;
    return w > 0 ? w : (ww / 2);
  },
  _estimateTextLines(text = '', colWidthRpx = 0, fontSizeRpx = 28, maxLines = 2) {
    const t = String(text || '').trim();
    if (!t) return 0;
    const w = Math.max(0, Number(colWidthRpx) || 0);
    const fs = Math.max(1, Number(fontSizeRpx) || 1);
    // goods-body 左右 padding 各 18rpx
    const innerW = Math.max(0, w - 36);
    const perLine = Math.max(6, Math.floor(innerW / fs));
    const lines = Math.ceil(t.length / perLine);
    return Math.min(Math.max(1, lines), Math.max(1, Number(maxLines) || 1));
  },
  _estimateGoodsCardBaseHeightRpx(g = {}, colWidthRpx = 0) {
    const hasTags = !!(g.categoryLabel || g.conditionLabel || g.tradeTypeLabel);
    const hasDesc = !!(g.desc && String(g.desc).trim());
    const hasSub = !!(g.subText && String(g.subText).trim());

    // 估算值：用于虚拟列表 + “往更短的列放”的决策；做得越准，滚动越不抖
    let rpx = 0;
    rpx += 36;               // .goods-body padding
    if (hasTags) rpx += 36;  // 一行 tag
    // title：font-size 28rpx, line-height 1.35，单行约 38rpx；title 自带 mt-12
    const titleLines = this._estimateTextLines(g.title, colWidthRpx, 28, 2) || 1;
    rpx += 12 + titleLines * 38;
    // desc：font-size 24rpx, line-height 1.35，单行约 32rpx；desc 自带 mt-8
    if (hasDesc) {
      const descLines = this._estimateTextLines(g.desc, colWidthRpx, 24, 2) || 1;
      rpx += 8 + descLines * 32;
    }
    rpx += 46;               // 价格行 + 间距
    if (hasSub) rpx += 32;   // subText + 间距
    return rpx;
  },
  // 将图片处理样式拼接到 tempFileURL 上（样式要放在 ? 查询参数之前）
  _applyImageStyle(tempFileURL = '', styleName = '') {
    const url = String(tempFileURL || '');
    const style = String(styleName || '').trim();
    if (!url || !style) return url;

    const hashIdx = url.indexOf('#');
    const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const hashPart = hashIdx >= 0 ? url.slice(hashIdx) : '';

    const qIdx = beforeHash.indexOf('?');
    if (qIdx < 0) return `${beforeHash}/${style}${hashPart}`;
    return `${beforeHash.slice(0, qIdx)}/${style}${beforeHash.slice(qIdx)}${hashPart}`;
  },
  // 批量把 cloud://fileID 转成（可选）带样式的 tempFileURL，返回 map：{ [fileID]: url }
  _getTempFileURLMap(fileIDs = [], styleName = '') {
    const ids = Array.from(new Set(
      (Array.isArray(fileIDs) ? fileIDs : [])
        .filter((x) => typeof x === 'string' && x.indexOf('cloud://') === 0)
    ));
    if (!ids.length) return Promise.resolve({});

    const batches = [];
    for (let i = 0; i < ids.length; i += TEMP_URL_BATCH_SIZE) {
      batches.push(ids.slice(i, i + TEMP_URL_BATCH_SIZE));
    }

    const tasks = batches.map((batch) => new Promise((resolve, reject) => {
      wx.cloud.getTempFileURL({
        fileList: batch.map((fileID) => ({ fileID })),
        success: resolve,
        fail: reject
      });
    }));

    return Promise.all(tasks).then((results) => {
      const map = {};
      (results || []).forEach((res) => {
        (res.fileList || []).forEach((it) => {
          if (it && it.fileID && it.tempFileURL) {
            map[it.fileID] = this._applyImageStyle(it.tempFileURL, styleName);
          }
        });
      });
      return map;
    });
  },
  _resetGoodsState() {
    // 清掉旧的虚拟列表状态，避免闪烁/错误复用
    this._virtualMetaLeft = null;
    this._virtualMetaRight = null;
    this._virtualState = null;
    this._virtualContainerTopPx = null;
    this._goodsById = {};
    this._leftItems = [];
    this._rightItems = [];
    this._goodsPos = {};
    this._measuredCardHeight = {};
    this._waterfallGapPx = null;

    // 缩略图错误刷新状态：换分类/刷新列表时重置，避免误判“已尝试过”
    this._thumbErrorRefreshTried = {};

    // 分页游标：用 (createdAt, _id) 做 cursor，避免 skip 大数据量时性能差/上限问题
    this._goodsCursor = null; // { createdAt, id }
    // 快照上界：固定“本次列表会话”的最大边界，避免分页过程中有新商品插入导致翻页漏/乱序
    this._goodsAnchor = null; // { createdAt, id }
    this._goodsHasMore = true;
    this._isFetchingMore = false;
  },
  // 加载商品列表（reset=true 会从第一页重新加载）
  loadGoods(reset = false) {
    if (reset) this._resetGoodsState();

    this.setData({
      isLoading: true,
      goodsTotal: 0,
      renderLeft: [],
      renderRight: [],
      virtualLeftTopPx: 0,
      virtualLeftBottomPx: 0,
      virtualRightTopPx: 0,
      virtualRightBottomPx: 0,
      hasMore: true,
      isLoadingMore: false,
      loadMoreError: '',
      showNewGoodsTip: false
    });

    // 刷新/切换分类后，重新开启新商品监听（避免监听条件还是旧的）
    if (reset) this._openNewGoodsWatch(true);

    // 首次加载一页
    this.loadMoreGoods(true);
  },
  _queryGoodsPage(cursor = null, limit = GOODS_PAGE_SIZE) {
    const u = getStoredUser();
    const community = (u.community || '').trim();
    const c = this.data.goodsCategory || 'all';
    const _ = db.command;

    return new Promise((resolve, reject) => {
      // cursor 分页：用 (createdAt desc, _id desc) 做稳定排序
      // 下一页条件：createdAt < lastCreatedAt OR (createdAt == lastCreatedAt AND _id < lastId)
      const baseWhere = {};
      if (community) baseWhere.community = community;
      if (c && c !== 'all') baseWhere.category = c;
      // 只展示已上架（posted）的商品：
      // 审核中（pending）/需修改（need_fix）的内容不会出现在商品广场里。
      baseWhere.status = 'posted';

      let cursorWhere = null;
      if (cursor && cursor.createdAt) {
        if (cursor.id) {
          cursorWhere = _.or([
            { createdAt: _.lt(cursor.createdAt) },
            { createdAt: cursor.createdAt, _id: _.lt(cursor.id) }
          ]);
        } else {
          cursorWhere = { createdAt: _.lt(cursor.createdAt) };
        }
      }

      let anchorWhere = null;
      const anchor = this._goodsAnchor;
      if (anchor && anchor.createdAt) {
        // createdAt < anchorAt OR (createdAt == anchorAt AND _id <= anchorId)
        if (anchor.id) {
          anchorWhere = _.or([
            { createdAt: _.lt(anchor.createdAt) },
            { createdAt: anchor.createdAt, _id: _.lte(anchor.id) }
          ]);
        } else {
          anchorWhere = { createdAt: _.lte(anchor.createdAt) };
        }
      }

      const andParts = [];
      if (Object.keys(baseWhere).length) andParts.push(baseWhere);
      if (anchorWhere) andParts.push(anchorWhere);
      if (cursorWhere) andParts.push(cursorWhere);

      const whereCond = andParts.length === 1 ? andParts[0] : (andParts.length ? _.and(andParts) : null);

      let q = db.collection(GOODS_COLLECTION);
      if (whereCond) q = q.where(whereCond);

      q
        .orderBy('createdAt', 'desc')
        // 作为同一 createdAt 下的稳定 tie-breaker，避免分页漏数据
        .orderBy('_id', 'desc')
        .limit(Math.max(1, Number(limit) || 1))
        .get({
          success: resolve,
          fail: reject
        });
    });
  },
  _mapGoodsDoc(doc = {}) {
    const categoryKey = doc.category || 'other';
    const conditionKey = doc.condition || '';
    const tradeKey = doc.tradeType || '';
    const images = Array.isArray(doc.images) ? doc.images : [];

    const subParts = [];
    if (doc.community) subParts.push(doc.community);
    if (doc.building) subParts.push(doc.building);

    return {
      ...doc,
      id: doc._id,
      categoryLabel: GOODS_CATEGORY_LABEL_MAP[categoryKey] || '其他',
      priceText: formatMoney(doc.price),
      originalPriceText: (doc.originalPrice != null && doc.originalPrice !== '')
        ? formatMoney(doc.originalPrice)
        : '',
      conditionLabel: GOODS_CONDITION_LABEL_MAP[conditionKey] || '',
      tradeTypeLabel: GOODS_TRADE_LABEL_MAP[tradeKey] || '',
      subText: subParts.join(' · '),
      images,
      coverRatio: (doc.coverRatio != null && doc.coverRatio !== '') ? Number(doc.coverRatio) : null,
      imagesPreview: images.slice(0, 3).map((fileID, idx) => ({
        fileID,
        index: idx,
        thumbUrl: (typeof fileID === 'string' && fileID.indexOf('cloud://') === 0) ? '' : (fileID || '')
      }))
    };
  },
  async loadMoreGoods(force = false) {
    if (!this._goodsHasMore) {
      if (this.data.hasMore) this.setData({ hasMore: false });
      return;
    }
    if (this._isFetchingMore) return;
    if (!force && this.data.loadMoreError) {
      // 上一次失败后，让用户点“重试”触发，避免滚动过程中反复打请求
      return;
    }

    this._isFetchingMore = true;
    const isFirstPage = !this._goodsCursor;

    if (isFirstPage) {
      this.setData({ isLoading: true, loadMoreError: '' });
    } else {
      this.setData({ isLoadingMore: true, loadMoreError: '' });
    }

    try {
      const res = await this._queryGoodsPage(this._goodsCursor, GOODS_PAGE_SIZE);
      const raw = (res && res.data) ? res.data : [];
      // 固定本次列表会话的快照上界：避免分页过程中插入的新数据导致“翻页漏/乱序”
      if (!this._goodsAnchor && raw.length) {
        const first = raw[0];
        if (first && first.createdAt) this._goodsAnchor = { createdAt: first.createdAt, id: first._id };
      }
      if (raw.length < GOODS_PAGE_SIZE) this._goodsHasMore = false;
      if (raw.length) {
        const last = raw[raw.length - 1];
        if (last && last.createdAt) {
          this._goodsCursor = { createdAt: last.createdAt, id: last._id };
        }
      }

      // 兼容旧数据：status 为空时也视为 posted
      const filtered = (raw || []).filter((doc) => !doc.status || doc.status === 'posted');

      let newItems = (filtered || []).map((doc) => this._mapGoodsDoc(doc));

      // 缩略图 URL（仅处理本次新增部分）
      try {
        const previewFileIDs = [];
        (newItems || []).forEach((g) => {
          (g.imagesPreview || []).forEach((it) => {
            if (it && it.fileID) previewFileIDs.push(it.fileID);
          });
        });
        const thumbMap = await this._getTempFileURLMap(previewFileIDs, GOODS_THUMB_STYLE);
        newItems = (newItems || []).map((g) => ({
          ...g,
          imagesPreview: (g.imagesPreview || []).map((it) => ({
            ...it,
            thumbUrl: thumbMap[it.fileID] || it.thumbUrl || ''
          }))
        }));
      } catch (err) {
        console.error('生成商品缩略图失败', err);
      }

      // 预估每个新增商品的卡片高度（用于虚拟列表/瀑布流分流）
      const colWidthPx = this._getGoodsColumnWidthPx();
      const rpx2px = this._getRpx2px();
      const colWidthRpx = rpx2px ? (colWidthPx / rpx2px) : 0;
      if (this._waterfallGapPx == null) this._waterfallGapPx = GOODS_WATERFALL_GAP_RPX * rpx2px;
      const verticalGapPx = Number(this._waterfallGapPx) || 0;

      // 你这边所有商品都有 coverRatio：无需额外 getImageInfo（会明显拖慢分页加载）
      newItems = (newItems || []).map((g) => {
        const coverUrl = this._getCoverThumbUrl(g);
        const cachedCover = (coverUrl && this._thumbLocalByUrl) ? this._thumbLocalByUrl[coverUrl] : '';
        const coverSrc = cachedCover || coverUrl || '';

        let ratio = Number(g && g.coverRatio);
        if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
        ratio = Math.max(WATERFALL_COVER_RATIO_MIN, Math.min(WATERFALL_COVER_RATIO_MAX, ratio));
        const coverPct = Math.round(ratio * 100);
        const coverHeightPx = colWidthPx * ratio;
        const basePx = this._estimateGoodsCardBaseHeightRpx(g, colWidthRpx) * rpx2px;
        const predHeightPx = coverHeightPx + basePx;
        return { ...g, coverSrc, coverPct, _predHeightPx: predHeightPx };
      });

      // 按“更短的列”继续分流追加
      const left = this._leftItems || [];
      const right = this._rightItems || [];
      let leftH = this._virtualMetaLeft ? Number(this._virtualMetaLeft.totalHeight || 0) : 0;
      let rightH = this._virtualMetaRight ? Number(this._virtualMetaRight.totalHeight || 0) : 0;

      (newItems || []).forEach((g) => {
        if (!g || !g.id) return;
        // 去重：防止重复加载导致同一 id 多次出现
        if (this._goodsById && this._goodsById[g.id]) return;

        const h = Number(g._predHeightPx) || 0;
        if (leftH <= rightH) {
          left.push(g);
          leftH += h + (left.length > 1 ? verticalGapPx : 0);
          this._goodsPos[g.id] = { col: 'left', idx: left.length - 1 };
        } else {
          right.push(g);
          rightH += h + (right.length > 1 ? verticalGapPx : 0);
          this._goodsPos[g.id] = { col: 'right', idx: right.length - 1 };
        }
        this._goodsById[g.id] = g;
      });

      // 重建 meta（O(n)）；分页加载时 n 不会暴涨得太快
      this._leftItems = left;
      this._rightItems = right;
      this._virtualMetaLeft = this._buildVirtualColumnMeta(left, verticalGapPx);
      this._virtualMetaRight = this._buildVirtualColumnMeta(right, verticalGapPx);

      const total = Object.keys(this._goodsById || {}).length;
      this.setData({
        goodsTotal: total,
        hasMore: !!this._goodsHasMore,
        isLoading: false,
        isLoadingMore: false
      }, () => {
        if (isFirstPage) this._finishPullDownRefresh();
        // 首次加载需要测容器位置；后续 load more 直接刷新可视范围即可
        if (this._virtualContainerTopPx == null) {
          wx.nextTick(() => {
            this._measureVirtualContainerTop(() => this._scheduleVirtualUpdate(true));
          });
        } else {
          this._scheduleVirtualUpdate(true);
        }
        // 商品就位后，空闲时预取一下相邻缩略图，提升连续滑动“秒出图”的观感
        setTimeout(() => this._scheduleThumbPrefetch(), 220);
        // 如果内容不足一屏，自动再补一页，避免无法滚动触发加载更多
        setTimeout(() => this._maybeFillViewport(), 50);
      });
    } catch (err) {
      console.error('加载更多商品失败', err);
      this.setData({
        isLoading: false,
        isLoadingMore: false,
        loadMoreError: 'load_failed'
      });
      if (isFirstPage) {
        this._finishPullDownRefresh();
        wx.showToast({ title: '商品加载失败', icon: 'none' });
      }
    } finally {
      this._isFetchingMore = false;
    }
  },
  // 封面图加载失败时的兜底：
  // - 本地缓存路径失效：回退到 thumbUrl
  // - thumbUrl 可能过期：重新换取一次 tempFileURL（单张）
  async onCoverImageError(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const g = (this._goodsById && this._goodsById[id]) ? this._goodsById[id] : null;
    if (!g) return;

    const remoteThumb = this._getCoverThumbUrl(g);
    const curSrc = String(g.coverSrc || '');

    // 1) 本地临时文件失效：直接回退到远端 thumbUrl（通常能立即恢复）
    if (this._isLocalFilePath(curSrc) && remoteThumb) {
      g.coverSrc = remoteThumb;
      this._scheduleVirtualUpdate(true);
      return;
    }

    // 2) 远端 thumbUrl 失败：可能是 temp url 过期，尝试重新换一次
    const it0 = g && g.imagesPreview && g.imagesPreview[0];
    const fileID = it0 && it0.fileID;
    if (typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) return;

    this._thumbErrorRefreshTried = this._thumbErrorRefreshTried || {};
    if (this._thumbErrorRefreshTried[fileID]) return;
    this._thumbErrorRefreshTried[fileID] = true;

    try {
      const map = await this._getTempFileURLMap([fileID], GOODS_THUMB_STYLE);
      const nextUrl = map[fileID] || '';
      if (!nextUrl) return;

      // 更新 thumbUrl + coverSrc
      it0.thumbUrl = nextUrl;
      const cached = (this._thumbLocalByUrl && this._thumbLocalByUrl[nextUrl]) ? this._thumbLocalByUrl[nextUrl] : '';
      g.coverSrc = cached || nextUrl;
      this._scheduleVirtualUpdate(true);
    } catch (err) {
      console.error('刷新商品缩略图链接失败', err);
    }
  },
  // 预览商品图片：点击后才换取原图链接
  async previewGoodsImage(e) {
    const id = e.currentTarget.dataset.id;
    const idx = Number(e.currentTarget.dataset.index || 0);
    if (!id) return;
    const g = (this._goodsById && this._goodsById[id]) ? this._goodsById[id] : null;
    if (!g || !g.images || !g.images.length) return;

    wx.showLoading({ title: '加载图片...', mask: true });
    try {
      const rawUrls = Array.isArray(g.images) ? g.images : [];
      // 复用统一的 tempFileURL 逻辑（内部含 50 个一批的分片），避免图片太多时触发接口上限。
      const cloudMap = await this._getTempFileURLMap(rawUrls, '');

      const urls = rawUrls
        .map((u) => (typeof u === 'string' && u.indexOf('cloud://') === 0) ? (cloudMap[u] || '') : u)
        .filter(Boolean);

      if (!urls.length) throw new Error('empty url list');
      const safeIdx = Math.max(0, Math.min(Number(idx) || 0, urls.length - 1));
      wx.hideLoading();
      wx.previewImage({
        current: urls[safeIdx] || urls[0],
        urls
      });
    } catch (err) {
      console.error('预览商品图片失败', err);
      wx.hideLoading();
      wx.showToast({ title: '图片加载失败', icon: 'none' });
    }
  }
});
