const { resolveAvatarURL, saveAvatarTempURLMap } = require('../../../utils/avatarCache');

const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const GOODS_COLLECTION = 'goods';
const TEMP_URL_BATCH_SIZE = 20;

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function safeDecode(v = '') {
  const raw = pickStr(v);
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
}

Page({
  data: {
    gid: '',
    sellerId: '',
    sellerOpenid: '',
    peerUserId: '',
    peerOpenid: '',
    goodsInfo: null,
    msgs: [],
    text: '',
    scrollTop: 0,
    scrollWithAnimation: false,
    isLoading: true,
    contentReady: false,
    me: null,
    meOpenid: '',
    peerDisplayName: '',
    meProfile: null,
    peerProfile: null,
    keyboardHeight: 0,
    isOwner: false,
  },

  _scrollTimer: null,
  _userScrolling: false,
  _roomDocs: [],
  _goodsReadFunctionMissing: false,

  _maskName(name = '') {
    if (!name) return '';
    const len = name.length;
    if (len <= 1) return name;
    if (len === 2) return `${name[0]}*`;
    return `${name[0]}${'*'.repeat(len - 2)}${name[len - 1]}`;
  },

  _getDisplayName(user = {}, fallbackName = '对方') {
    if (pickStr(user.nickname)) return pickStr(user.nickname);
    if (pickStr(user.name)) return this._maskName(pickStr(user.name));
    if (pickStr(user.displayName)) return pickStr(user.displayName);
    return fallbackName;
  },

  _isCloudFileID(v = '') {
    return String(v || '').indexOf('cloud://') === 0;
  },

  async _ensureOpenid() {
    const me = wx.getStorageSync('hyyc_user') || {};
    let openid = pickStr(me._openid, me.openid, me.openId);
    if (openid) return openid;
    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = pickStr(res && res.result && res.result.openid);
      if (openid) {
        try {
          wx.setStorageSync('hyyc_user', { ...me, _openid: openid });
        } catch (err) {
          // ignore
        }
      }
    } catch (err) {
      // ignore
    }
    return openid;
  },

  async _getTempFileURLMap(fileIDs = []) {
    const uniq = [];
    const seen = {};
    (Array.isArray(fileIDs) ? fileIDs : []).forEach((item) => {
      const fileID = pickStr(item);
      if (!fileID || !this._isCloudFileID(fileID) || seen[fileID]) return;
      seen[fileID] = true;
      uniq.push(fileID);
    });
    if (!uniq.length) return {};

    const map = {};
    for (let i = 0; i < uniq.length; i += TEMP_URL_BATCH_SIZE) {
      const res = await wx.cloud.getTempFileURL({
        fileList: uniq.slice(i, i + TEMP_URL_BATCH_SIZE).map((fileID) => ({
          fileID,
          maxAge: 60 * 30,
        })),
      });
      const list = (res && res.fileList) || [];
      list.forEach((entry) => {
        if (entry && entry.fileID && entry.tempFileURL) {
          map[entry.fileID] = entry.tempFileURL;
        }
      });
    }
    saveAvatarTempURLMap(map, 60 * 30);
    return map;
  },

  async _fetchPublicProfile(openid = '') {
    const targetOpenid = pickStr(openid);
    if (!targetOpenid) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserPublicProfile',
        data: { openid: targetOpenid },
      });
      const result = (res && res.result) || {};
      return result && result.ok ? (result.profile || null) : null;
    } catch (err) {
      console.warn('获取商品聊天公开资料失败', err);
      return null;
    }
  },

  _buildSellerProfile(goods = {}, me = {}, meOpenid = '') {
    const seller = {
      role: 'seller',
      userId: pickStr(goods.ownerId),
      openid: pickStr(goods._openid),
      nickname: pickStr(goods.ownerNickname),
      name: pickStr(goods.ownerName),
      avatarFileID: pickStr(goods.ownerAvatarFileID, goods.ownerAvatarUrl),
    };

    const meId = pickStr(me && me.id);
    if ((meId && meId === seller.userId) || (meOpenid && meOpenid === seller.openid)) {
      seller.nickname = pickStr(me.nickname, seller.nickname);
      seller.name = pickStr(me.name, seller.name);
      seller.avatarFileID = pickStr(me.avatarFileID, me.avatarUrl, seller.avatarFileID);
      seller.openid = pickStr(me._openid, me.openid, me.openId, seller.openid);
    }

    seller.avatarUrl = resolveAvatarURL(seller.avatarFileID, pickStr(me && me.avatarUrl));
    seller.displayName = this._getDisplayName(seller, '卖家');
    return seller;
  },

  _buildBuyerProfile(options = {}, me = {}, meOpenid = '') {
    const buyer = {
      role: 'buyer',
      userId: pickStr(options.peerUserId),
      openid: pickStr(options.peerOpenid),
      nickname: pickStr(options.peerName),
      name: '',
      avatarFileID: '',
    };

    const meId = pickStr(me && me.id);
    if ((meId && meId === buyer.userId) || (meOpenid && meOpenid === buyer.openid)) {
      buyer.nickname = pickStr(me.nickname, buyer.nickname);
      buyer.name = pickStr(me.name, buyer.name);
      buyer.avatarFileID = pickStr(me.avatarFileID, me.avatarUrl, buyer.avatarFileID);
      buyer.openid = pickStr(me._openid, me.openid, me.openId, buyer.openid);
    }

    buyer.avatarUrl = resolveAvatarURL(buyer.avatarFileID, pickStr(me && me.avatarUrl));
    buyer.displayName = this._getDisplayName(buyer, '买家');
    return buyer;
  },

  async _hydrateParticipantAvatarFast(meBase = {}, peerBase = {}) {
    const fileIDs = [];
    const meAvatar = pickStr(meBase.avatarFileID);
    const peerAvatar = pickStr(peerBase.avatarFileID);

    if (meAvatar && this._isCloudFileID(meAvatar) && !pickStr(meBase.avatarUrl)) {
      fileIDs.push(meAvatar);
    }
    if (peerAvatar && this._isCloudFileID(peerAvatar) && !pickStr(peerBase.avatarUrl)) {
      fileIDs.push(peerAvatar);
    }
    if (!fileIDs.length) return;

    try {
      const avatarMap = await this._getTempFileURLMap(fileIDs);
      const patch = {};
      if (meAvatar && avatarMap[meAvatar]) {
        patch['meProfile.avatarUrl'] = avatarMap[meAvatar];
      }
      if (peerAvatar && avatarMap[peerAvatar]) {
        patch['peerProfile.avatarUrl'] = avatarMap[peerAvatar];
      }
      if (Object.keys(patch).length) {
        this.setData(patch);
        this._refreshDecoratedMsgs();
      }
    } catch (err) {
      console.warn('快速加载商品聊天头像失败', err);
    }
  },

  async _hydrateParticipantProfile(baseProfile = {}, fallbackName = '对方') {
    const base = baseProfile && typeof baseProfile === 'object' ? { ...baseProfile } : {};
    const publicProfile = await this._fetchPublicProfile(base.openid);
    const merged = {
      ...base,
      ...(publicProfile || {}),
    };
    const displayName = this._getDisplayName(merged, fallbackName);
    const avatarSource = pickStr(merged.avatarFileID, merged.avatarUrl, base.avatarFileID, base.avatarUrl);
    let avatarUrl = resolveAvatarURL(avatarSource, merged.avatarUrl, base.avatarUrl);
    if (!avatarUrl && avatarSource && this._isCloudFileID(avatarSource)) {
      try {
        const avatarMap = await this._getTempFileURLMap([avatarSource]);
        avatarUrl = pickStr(avatarMap[avatarSource], avatarSource);
      } catch (err) {
        console.warn('加载商品聊天头像失败', err);
      }
    }
    return {
      ...merged,
      displayName,
      avatarUrl: avatarUrl && !this._isCloudFileID(avatarUrl) ? avatarUrl : '',
    };
  },

  async _loadGoodsForChat(gid = '', openid = '') {
    const goodsId = pickStr(gid);
    if (!goodsId) return null;

    const me = wx.getStorageSync('hyyc_user') || {};
    const community = pickStr(me.community);
    let goods = null;

    if (openid) {
      try {
        const ownRes = await db.collection(GOODS_COLLECTION)
          .where({ _id: goodsId, _openid: openid })
          .limit(1)
          .get();
        goods = (ownRes && ownRes.data && ownRes.data[0]) || null;
      } catch (err) {
        console.warn('按本人查询商品聊天信息失败', err);
      }
    }

    if (!goods && community) {
      try {
        const publicRes = await db.collection(GOODS_COLLECTION)
          .where({ _id: goodsId, status: 'posted', community })
          .limit(1)
          .get();
        goods = (publicRes && publicRes.data && publicRes.data[0]) || null;
      } catch (err) {
        console.warn('按公开商品查询聊天信息失败', err);
      }
    }

    if (!goods) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'getGoodsProfile',
          data: {
            action: 'get_goods_detail',
            goodsId
          }
        });
        const result = (res && res.result) || {};
        if (result && result.ok && result.doc) {
          goods = result.doc;
        }
      } catch (err) {
        console.warn('通过云函数兜底读取商品聊天信息失败', err);
      }
    }

    return goods;
  },

  _initParticipants(goods = {}, options = {}) {
    const me = this.data.me || {};
    const meOpenid = pickStr(this.data.meOpenid);
    const sellerProfile = this._buildSellerProfile(goods, me, meOpenid);
    const buyerProfile = this._buildBuyerProfile(options, me, meOpenid);
    const isOwner = !!this.data.isOwner;
    const meBase = isOwner ? sellerProfile : buyerProfile;
    const peerBase = isOwner ? buyerProfile : sellerProfile;

    this.setData({
      meProfile: meBase,
      peerProfile: peerBase,
      peerDisplayName: pickStr(peerBase.displayName, '对方'),
    });
    this._refreshDecoratedMsgs();
    this._hydrateParticipantAvatarFast(meBase, peerBase);

    Promise.all([
      this._hydrateParticipantProfile(meBase, isOwner ? '卖家' : '买家'),
      this._hydrateParticipantProfile(peerBase, isOwner ? '买家' : '卖家'),
    ]).then(([meProfile, peerProfile]) => {
      this.setData({
        meProfile,
        peerProfile,
        peerDisplayName: pickStr(peerProfile && peerProfile.displayName, peerBase.displayName, '对方'),
      });
      this._refreshDecoratedMsgs();
    }).catch((err) => {
      console.warn('初始化商品聊天参与方资料失败', err);
    });
  },

  _mergePeerProfileFromDocs(docs = []) {
    const current = this.data.peerProfile && typeof this.data.peerProfile === 'object'
      ? this.data.peerProfile
      : {};
    const targetUserId = this.data.isOwner
      ? pickStr(this.data.peerUserId)
      : pickStr(this.data.sellerId);
    let next = { ...current };
    let changed = false;

    (docs || []).some((doc) => {
      const isPeerMessage = pickStr(doc && doc.fromUserId) === targetUserId;
      if (!isPeerMessage) return false;

      const openid = this.data.isOwner
        ? pickStr(doc.fromOpenid, doc.peerOpenid)
        : pickStr(doc.fromOpenid, doc.sellerOpenid);
      const nickname = this.data.isOwner
        ? pickStr(doc.fromNickname, doc.peerNickname)
        : pickStr(doc.fromNickname, doc.sellerNickname);
      const avatarFileID = this.data.isOwner
        ? pickStr(doc.fromAvatarFileID, doc.peerAvatarFileID)
        : pickStr(doc.fromAvatarFileID, doc.sellerAvatarFileID);

      if (!pickStr(next.openid) && openid) {
        next.openid = openid;
        changed = true;
      }
      if (!pickStr(next.nickname, next.name) && nickname) {
        next.nickname = nickname;
        changed = true;
      }
      if (!pickStr(next.avatarFileID, next.avatarUrl) && avatarFileID) {
        next.avatarFileID = avatarFileID;
        changed = true;
      }
      return changed;
    });

    if (!changed) return;

    next.displayName = this._getDisplayName(next, pickStr(current.displayName, '对方'));
    next.avatarUrl = resolveAvatarURL(next.avatarFileID, next.avatarUrl, current.avatarUrl);
    this.setData({
      peerProfile: next,
      peerDisplayName: pickStr(next.displayName, '对方'),
    });
    this._refreshDecoratedMsgs();
    this._hydrateParticipantAvatarFast(this.data.meProfile || {}, next);
    if (pickStr(next.openid)) {
      const expectedUserId = this.data.isOwner
        ? pickStr(this.data.peerUserId)
        : pickStr(this.data.sellerId);
      this._hydrateParticipantProfile(next, '对方')
        .then((peerProfile) => {
          if (expectedUserId !== pickStr(next.userId, expectedUserId)) return;
          this.setData({
            peerProfile,
            peerDisplayName: pickStr(peerProfile.displayName, next.displayName, '对方'),
          });
          this._refreshDecoratedMsgs();
        })
        .catch((err) => {
          console.warn('补齐商品聊天对方资料失败', err);
        });
    }
  },

  _decorateMsgs(docs = []) {
    const userId = pickStr(this.data.me && this.data.me.id);
    const meProfile = this.data.meProfile && typeof this.data.meProfile === 'object' ? this.data.meProfile : {};
    const peerProfile = this.data.peerProfile && typeof this.data.peerProfile === 'object' ? this.data.peerProfile : {};
    const sortedDocs = (Array.isArray(docs) ? docs.slice() : []).sort((a, b) => this._getMsgTs(a) - this._getMsgTs(b));

    return sortedDocs.map((doc) => {
      const mine = !!(userId && pickStr(doc && doc.fromUserId) === userId);
      return {
        id: pickStr(doc && (doc._id || doc.id)),
        text: pickStr(doc && doc.text),
        type: pickStr(doc && doc.type, 'text'),
        imageUrl: pickStr(doc && doc.imageUrl),
        mine,
        avatarUrl: mine ? pickStr(meProfile.avatarUrl) : pickStr(peerProfile.avatarUrl),
      };
    });
  },

  _getMsgTs(doc = {}) {
    if (doc.createTime instanceof Date) return doc.createTime.getTime();
    if (typeof doc.createTime === 'number') return doc.createTime;
    if (doc.createTime && doc.createTime.$date) return doc.createTime.$date;
    return 0;
  },

  _getRoomQuery() {
    return {
      bizType: 'goods',
      gid: pickStr(this.data.gid),
      sellerId: pickStr(this.data.sellerId),
      peerUserId: pickStr(this.data.peerUserId),
    };
  },

  _getReadWhere() {
    const gid = pickStr(this.data.gid);
    const sellerOpenid = pickStr(this.data.sellerOpenid);
    const sellerId = pickStr(this.data.sellerId);
    const peerUserId = pickStr(this.data.peerUserId);
    if (!gid || !peerUserId) return null;
    const where = {
      bizType: 'goods',
      gid,
      peerUserId,
    };
    if (sellerOpenid) {
      where.sellerOpenid = sellerOpenid;
    } else if (sellerId) {
      where.sellerId = sellerId;
    } else {
      return null;
    }
    return where;
  },

  _refreshDecoratedMsgs() {
    if (!Array.isArray(this._roomDocs) || !this._roomDocs.length) return;
    this.setData({
      msgs: this._decorateMsgs(this._roomDocs),
    });
  },

  _isFunctionNotFoundError(err) {
    const text = pickStr(
      err && err.errMsg,
      err && err.message,
      err
    );
    return text.includes('FunctionName parameter could not be found')
      || text.includes('FUNCTION_NOT_FOUND')
      || text.includes('-501000');
  },

  _markRoomReadViaClient() {
    const where = this._getReadWhere();
    const readField = this.data.isOwner ? 'readBySeller' : 'readByBuyer';
    if (!where || !readField) return Promise.resolve();
    return db.collection(MSG_COLLECTION)
      .where(where)
      .update({
        data: {
          [readField]: true,
        },
      })
      .catch((err) => {
        console.warn('商品聊天前端兜底已读失败', err);
      });
  },

  _markRoomRead() {
    const gid = pickStr(this.data.gid);
    const sellerId = pickStr(this.data.sellerId);
    const peerUserId = pickStr(this.data.peerUserId);
    if (!gid || !sellerId || !peerUserId) return;

    if (this._goodsReadFunctionMissing) {
      this._markRoomReadViaClient();
      return;
    }

    wx.cloud.callFunction({
      name: 'markGoodsMessagesRead',
      data: {
        gid,
        sellerId,
        peerUserId,
        readerRole: this.data.isOwner ? 'seller' : 'buyer',
      },
    }).catch((err) => {
      if (this._isFunctionNotFoundError(err)) {
        this._goodsReadFunctionMissing = true;
        console.warn('markGoodsMessagesRead 未部署，改用前端兜底已读');
        this._markRoomReadViaClient();
        return;
      }
      console.error('调用 markGoodsMessagesRead 失败', err);
    });
  },

  _scrollToBottom() {
    if (this._userScrolling) return;
    this.setData({
      scrollTop: 999999,
      scrollWithAnimation: true,
    });
  },

  onScroll() {
    this._userScrolling = true;
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
    }
    this._scrollTimer = setTimeout(() => {
      this._userScrolling = false;
    }, 1500);
  },

  openWatch() {
    const roomQuery = this._getRoomQuery();
    if (!roomQuery.gid || !roomQuery.sellerId || !roomQuery.peerUserId) return;

    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }

    this._watcher = db.collection(MSG_COLLECTION)
      .where(roomQuery)
      .watch({
        onChange: (snapshot) => {
          const docs = (snapshot && snapshot.docs) || [];
          this._roomDocs = docs;
          this._mergePeerProfileFromDocs(docs);
          const oldLen = this.data.msgs.length;
          const msgs = this._decorateMsgs(docs);
          const last = msgs[msgs.length - 1];
          const firstLoad = !this.data.contentReady;
          const nextData = {
            msgs,
            isLoading: false,
            contentReady: true,
          };

          if (firstLoad && last && !this._userScrolling) {
            nextData.scrollTop = 999999;
            nextData.scrollWithAnimation = false;
          }

          this.setData(nextData);

          if (!firstLoad && msgs.length > oldLen && last) {
            this._scrollToBottom();
          }

          this._markRoomRead();
        },
        onError: (err) => {
          console.error('goods chat watch error', err);
        },
      });
  },

  async _initRoom(gid = '', me = {}, query = {}) {
    try {
      const meOpenid = await this._ensureOpenid();
      if (!meOpenid) throw new Error('获取用户身份失败，请重新登录');

      const goods = await this._loadGoodsForChat(gid, meOpenid);
      if (!goods) throw new Error('商品不存在或暂不可聊天');

      const sellerId = pickStr(goods.ownerId);
      const sellerOpenid = pickStr(goods._openid);
      if (!sellerId || !sellerOpenid) throw new Error('商品数据异常');

      const meId = pickStr(me.id);
      const isOwner = (meOpenid && meOpenid === sellerOpenid) || (meId && meId === sellerId);
      let peerUserId = '';
      let peerOpenid = '';

      if (isOwner) {
        peerUserId = pickStr(query.peerUserId, goods.buyerId);
        peerOpenid = pickStr(query.peerOpenid, goods.buyerOpenid, goods.buyer_openid, goods.buyerOpenId);
        if (!peerUserId) throw new Error('请选择要回复的咨询用户');
      } else {
        peerUserId = pickStr(meId);
        peerOpenid = meOpenid;
        if (!peerUserId) throw new Error('缺少当前用户信息');
        if (peerUserId === sellerId) throw new Error('不能和自己聊天');
      }

      const goodsInfo = {
        id: pickStr(goods._id, gid),
        title: pickStr(goods.title, goods.desc, '商品咨询'),
        image: pickStr(Array.isArray(goods.images) ? goods.images[0] : ''),
      };

      this.setData({
        gid: goodsInfo.id,
        sellerId,
        sellerOpenid,
        peerUserId,
        peerOpenid,
        goodsInfo,
        meOpenid,
        isOwner,
      });
      wx.setNavigationBarTitle({ title: isOwner ? '商品咨询' : '聊一聊' });
      this._initParticipants(goods, {
        peerUserId,
        peerOpenid,
        peerName: pickStr(query.peerName),
      });
      this._markRoomRead();
      this.openWatch();
    } catch (err) {
      console.error('初始化商品聊天失败', err);
      this.setData({ isLoading: false });
      wx.showToast({
        title: pickStr(err && err.message, '暂时无法进入聊天'),
        icon: 'none',
      });
    }
  },

  _buildMessagePayload(type = 'text', extra = {}) {
    const me = this.data.me || {};
    const meProfile = this.data.meProfile && typeof this.data.meProfile === 'object' ? this.data.meProfile : {};
    const peerProfile = this.data.peerProfile && typeof this.data.peerProfile === 'object' ? this.data.peerProfile : {};
    const goodsInfo = this.data.goodsInfo && typeof this.data.goodsInfo === 'object' ? this.data.goodsInfo : {};
    const sellerProfile = this.data.isOwner ? meProfile : peerProfile;
    const buyerProfile = this.data.isOwner ? peerProfile : meProfile;
    const fromUserId = pickStr(me.id);
    const isSellerSender = fromUserId === pickStr(this.data.sellerId);
    const isBuyerSender = fromUserId === pickStr(this.data.peerUserId);

    return {
      bizType: 'goods',
      gid: pickStr(this.data.gid),
      goodsTitle: pickStr(goodsInfo.title),
      goodsImage: pickStr(goodsInfo.image),
      sellerId: pickStr(this.data.sellerId),
      sellerOpenid: pickStr(this.data.sellerOpenid),
      sellerNickname: pickStr(sellerProfile.nickname, sellerProfile.displayName, '卖家'),
      sellerAvatarFileID: pickStr(sellerProfile.avatarFileID, sellerProfile.avatarUrl),
      peerUserId: pickStr(this.data.peerUserId),
      peerOpenid: pickStr(this.data.peerOpenid, peerProfile.openid),
      peerNickname: pickStr(buyerProfile.nickname, buyerProfile.displayName, '买家'),
      peerAvatarFileID: pickStr(buyerProfile.avatarFileID, buyerProfile.avatarUrl),
      fromUserId,
      fromOpenid: pickStr(this.data.meOpenid, me._openid, me.openid, me.openId),
      fromNickname: pickStr(me.nickname, meProfile.nickname, meProfile.displayName, me.name),
      fromAvatarFileID: pickStr(me.avatarFileID, me.avatarUrl, meProfile.avatarFileID, meProfile.avatarUrl),
      type,
      createTime: db.serverDate(),
      readBySeller: !!isSellerSender,
      readByBuyer: !!isBuyerSender,
      ...extra,
    };
  },

  onLoad(query) {
    const gid = pickStr(query && (query.gid || query.id));
    if (!gid) {
      wx.showToast({ title: '缺少商品信息', icon: 'none' });
      return;
    }

    const me = wx.getStorageSync('hyyc_user') || null;
    if (!me || !me.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    this.setData({
      gid,
      me,
      isLoading: true,
    });

    wx.onKeyboardHeightChange((res) => {
      this.setData({ keyboardHeight: Number(res && res.height) || 0 });
      if ((res && res.height) > 0) {
        setTimeout(() => this._scrollToBottom(), 100);
      }
    });

    this._initRoom(gid, me, {
      peerUserId: pickStr(query && query.peerUserId),
      peerOpenid: safeDecode(query && query.peerOpenid),
      peerName: safeDecode(query && query.peerName),
    });
  },

  onUnload() {
    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }
    this._watcher = null;
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
    this._roomDocs = [];
    wx.offKeyboardHeightChange();
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  openMediaActions() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const idx = Number(res && res.tapIndex);
        if (idx === 0) {
          this.chooseImage('camera');
        } else if (idx === 1) {
          this.chooseImage('album');
        }
      },
    });
  },

  send() {
    const text = pickStr(this.data.text);
    if (!text) return;
    if (!pickStr(this.data.gid) || !pickStr(this.data.sellerId) || !pickStr(this.data.peerUserId)) {
      wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
      return;
    }

    this.setData({ text: '' });
    db.collection(MSG_COLLECTION)
      .add({
        data: this._buildMessagePayload('text', { text }),
      })
      .catch((err) => {
        console.error('发送商品聊天文本失败', err);
        wx.showToast({ title: '发送失败', icon: 'none' });
      });
  },

  chooseImage(sourceType) {
    const userId = pickStr(this.data.me && this.data.me.id);
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (!pickStr(this.data.gid) || !pickStr(this.data.sellerId) || !pickStr(this.data.peerUserId)) {
      wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
      return;
    }

    let sourceTypes = ['album', 'camera'];
    if (sourceType === 'camera') sourceTypes = ['camera'];
    if (sourceType === 'album') sourceTypes = ['album'];

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: sourceTypes,
      success: (res) => {
        const filePath = pickStr(res && res.tempFilePaths && res.tempFilePaths[0]);
        if (!filePath) return;
        const cloudPath = `goods-chat-images/${userId}/${Date.now()}.jpg`;

        wx.cloud.uploadFile({
          cloudPath,
          filePath,
          success: (uploadRes) => {
            const fileID = pickStr(uploadRes && uploadRes.fileID);
            if (!fileID) return;
            db.collection(MSG_COLLECTION)
              .add({
                data: this._buildMessagePayload('image', { imageUrl: fileID }),
              })
              .catch((err) => {
                console.error('发送商品聊天图片失败', err);
                wx.showToast({ title: '发送图片失败', icon: 'none' });
              });
          },
          fail: (err) => {
            console.error('上传商品聊天图片失败', err);
            wx.showToast({ title: '上传失败', icon: 'none' });
          },
        });
      },
    });
  },
});
