const { formatMoney, formatDateTime } = require('../../../utils/format');
const { isCloudFileID, resolveAvatarURL, saveAvatarTempURLMap } = require('../../../utils/avatarCache');

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

Page({
  data: {
    sellerOpenid: '',
    isLoading: true,
    seller: null,
    goodsList: [],
  },

  async onLoad(options) {
    const sellerOpenid = pickStr(options && options.openid, options && options._openid, options && options.openId);
    const sellerUserId = pickStr(options && options.userId, options && options.id);
    if (!sellerOpenid && !sellerUserId) {
      wx.showToast({ title: '卖家信息缺失', icon: 'none' });
      this.setData({ isLoading: false });
      return;
    }

    this.setData({
      sellerOpenid,
      sellerUserId,
      isLoading: true,
    });
    await this.loadSellerHomepage();
  },

  async _getTempUrlMap(fileIDs = []) {
    const uniq = [];
    const seen = {};
    (Array.isArray(fileIDs) ? fileIDs : []).forEach((item) => {
      const fileID = pickStr(item);
      if (!fileID || !isCloudFileID(fileID) || seen[fileID]) return;
      seen[fileID] = true;
      uniq.push(fileID);
    });
    if (!uniq.length) return {};

    const res = await wx.cloud.getTempFileURL({
      fileList: uniq.map((fileID) => ({ fileID, maxAge: 60 * 30 }))
    });
    const map = {};
    ((res && res.fileList) || []).forEach((item) => {
      if (item && item.fileID && item.tempFileURL) {
        map[item.fileID] = item.tempFileURL;
      }
    });
    saveAvatarTempURLMap(map, 60 * 30);
    return map;
  },

  async loadSellerHomepage() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getSellerHomepage',
        data: {
          openid: this.data.sellerOpenid,
          userId: this.data.sellerUserId,
        }
      });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true || !ret.seller) {
        throw new Error(pickStr(ret && ret.msg, '卖家主页加载失败'));
      }

      const seller = ret.seller || {};
      const goodsList = Array.isArray(ret.goodsList) ? ret.goodsList.slice() : [];
      const fileIDs = [];
      const avatarFileID = pickStr(seller.avatarFileID, seller.avatarUrl);
      if (avatarFileID) fileIDs.push(avatarFileID);
      goodsList.forEach((item) => {
        const coverImage = pickStr(item && item.coverImage);
        if (coverImage) fileIDs.push(coverImage);
      });
      const urlMap = await this._getTempUrlMap(fileIDs);

      const mappedSeller = {
        ...seller,
        avatarUrl: resolveAvatarURL(avatarFileID, pickStr(urlMap[avatarFileID]), pickStr(seller.avatarUrl)),
      };
      const mappedGoodsList = goodsList.map((item) => {
        const coverImage = pickStr(item && item.coverImage);
        const coverUrl = isCloudFileID(coverImage)
          ? pickStr(urlMap[coverImage])
          : coverImage;
        return {
          ...item,
          coverUrl,
          priceText: formatMoney(item && item.price),
          createdAtText: item && item.createdAt ? formatDateTime(item.createdAt) : '',
        };
      });

      wx.setNavigationBarTitle({
        title: pickStr(mappedSeller.displayName, '卖家主页'),
      });

      this.setData({
        seller: mappedSeller,
        goodsList: mappedGoodsList,
        isLoading: false,
      });
    } catch (err) {
      console.error('加载卖家主页失败', err);
      this.setData({ isLoading: false, seller: null, goodsList: [] });
      wx.showToast({ title: pickStr(err && err.message, '加载失败'), icon: 'none' });
    }
  },

  openGoodsDetail(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/goods/detail/index?id=${encodeURIComponent(id)}` });
  },
});
