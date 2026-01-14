const db = wx.cloud.database();
const LEGAL_COLLECTION = 'legal_docs';

function normalizeContent(raw) {
  let t = String(raw || '');
  // 真实换行
  t = t.replace(/\r\n/g, '\n');
  // 兼容数据库里存了 "\\n" 的情况（页面上会看到 \n）
  t = t.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  return t;
}

function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // 兼容 "2026-01-14-v1" 这种：只取前 10 位日期
    const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:-v(\d+))?/);
    if (m) {
      const t = Date.parse(m[1]);
      if (!Number.isNaN(t)) return t + (m[2] ? Number(m[2]) : 0);
    }
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    return 0;
  }
  if (v && typeof v.getTime === 'function') return v.getTime();
  return 0;
}

function docTs(doc) {
  const d = doc || {};
  return Math.max(
    toTs(d.updatedAt),
    toTs(d.effectiveAt),
    toTs(d.createdAt),
    toTs(d.effectiveDate),
    toTs(d.version)
  );
}

function pickLatest(list) {
  let best = null;
  let bestTs = -1;
  const arr = list || [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item) continue;
    const ts = docTs(item);
    if (ts > bestTs) {
      best = item;
      bestTs = ts;
    }
  }
  return best || arr[0] || null;
}

function buildBlocks(text, docTitle) {
  const lines = String(text || '').split('\n');
  const blocks = [];

  // 如果正文第一行是标题，且后面紧跟“更新日期/生效日期”，就去掉第一行避免重复
  const first = (lines[0] || '').trim();
  const second = (lines[1] || '').trim();
  const titleStr = String(docTitle || '').trim();
  const looksLikeTitle = first && (
    first === titleStr ||
    first.indexOf('用户协议') !== -1 ||
    first.indexOf('隐私政策') !== -1
  );
  const looksLikeMeta = /^(更新日期|生效日期)[:：]/.test(second);
  let startIndex = (looksLikeTitle && looksLikeMeta) ? 1 : 0;

  let lastWasSpacer = false;
  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i] || '';
    const s = rawLine.trim();
    if (!s) {
      if (!lastWasSpacer) {
        blocks.push({ type: 'spacer' });
        lastWasSpacer = true;
      }
      continue;
    }
    lastWasSpacer = false;

    if (/^\d+\.\s*/.test(s)) {
      blocks.push({ type: 'h2', text: s });
      continue;
    }
    if (/^[（(][0-9]+[）)]/.test(s)) {
      blocks.push({ type: 'li', text: s });
      continue;
    }
    if (/^[a-zA-Z]\.\s*/.test(s)) {
      blocks.push({ type: 'li-alpha', text: s });
      continue;
    }
    blocks.push({ type: 'p', text: s });
  }

  // 去掉开头/结尾多余空白
  while (blocks.length && blocks[0].type === 'spacer') blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].type === 'spacer') blocks.pop();

  return blocks;
}

Page({
  data: {
    isLoading: true,
    type: '',
    doc: null,
    blocks: []
  },

  onLoad(q) {
    const type = (q && q.type) || '';
    if (!type) {
      wx.showToast({ title: '缺少协议类型', icon: 'none' });
      this.setData({ isLoading: false, doc: null });
      return;
    }
    this.setData({ type });
  },

  onShow() {
    const type = this.data.type;
    if (!type) return;
    this.loadDoc(type);
  },

  async loadDoc(type) {
    this.setData({ isLoading: true, doc: null, blocks: [] });
    try {
      const res = await db.collection(LEGAL_COLLECTION)
        .where({ type })
        .limit(20)
        .get();

      const list = (res && res.data) || [];
      // 优先取 active 的那一条；如果有多条 active，按时间字段尽量取最新
      const activeList = list.filter(d => d && d.status === 'active');
      const doc = activeList.length ? pickLatest(activeList) : pickLatest(list);

      if (!doc) {
        wx.showToast({ title: '未配置协议内容', icon: 'none' });
        this.setData({ isLoading: false, doc: null });
        return;
      }

      // 设置标题（用户在数据库里改 title 后，这里会自动生效）
      wx.setNavigationBarTitle({ title: doc.title || '协议' });

      const content = normalizeContent(doc.content);
      const blocks = buildBlocks(content, doc.title);
      this.setData({
        isLoading: false,
        doc: { ...doc, content },
        blocks
      });
    } catch (err) {
      console.error('加载协议失败', err);
      wx.showToast({ title: '协议加载失败', icon: 'none' });
      this.setData({ isLoading: false, doc: null, blocks: [] });
    }
  },

  onPullDownRefresh() {
    const type = this.data.type;
    if (!type) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadDoc(type).finally(() => wx.stopPullDownRefresh());
  }
});
