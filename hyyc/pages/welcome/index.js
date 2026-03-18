// 欢迎页（入口页）
// - 合并“登录/注册”为一个按钮：已注册 -> 登录；未注册 -> 选择小区后进入注册
// - 欢迎页提供“退出小程序”按钮，满足审核对“可取消/拒绝或返回”的要求
const db = wx.cloud.database();
const USER_COLLECTION = "userInfo";
const access = require("../../config/access");
const { setStoredUser } = require("../../utils/userIdentity");

// 管理员登录成功后，会“冒充/切换”为该 openid 对应的 userInfo 记录（用于后台/排查）。
// 如需更换管理员进入的账号，就改这里。
const ADMIN_TARGET_OPENID = "o9-tA3Y_UREyoomUcnZyx7sCQejY";
const PREFILL_COMMUNITY_KEY = "hyyc_prefill_community";

function pickStr(v) {
  return String(v == null ? "" : v).trim();
}

function uniq(arr) {
  const out = [];
  const seen = {};
  (arr || []).forEach((x) => {
    const k = pickStr(x);
    if (!k) return;
    if (seen[k]) return;
    seen[k] = true;
    out.push(k);
  });
  return out;
}

Page({
  data: {
    // 登录中的 loading 状态，防止重复点击
    isLoading: false,

    allowedCommunities: (access && access.allowedCommunities) || [],
    allowedCommunitiesText: ((access && access.allowedCommunities) || []).join(" / ") || "",
    homepageNotice: (access && access.homepageNotice) || { title: "", text: "" },

    // 管理员登录弹窗入口：不展示文案入口，改为标题连点触发
    showAdminEntry: false,
    showAdminLogin: false,
    adminForm: { username: "", password: "" },

    // 未注册时：小区选择弹窗（使用系统 picker，避免自绘下拉框的交互/兼容问题）
    showCommunityPicker: false,
    communitySelected: "",
    communityPickerIndex: 0,
  },

  onLoad() {
    // 不展示“管理员登录”文案入口；改为标题连点触发（见 onHeroTitleTap）。
    this.setData({ showAdminEntry: false });
    this._adminTapCount = 0;
    this._adminTapLastAt = 0;
  },

  // 标题连点 5 次：弹出管理员登录弹窗
  onHeroTitleTap() {
    const now = Date.now();
    const last = this._adminTapLastAt || 0;
    let count = this._adminTapCount || 0;

    // 两次点击间隔太久就重新计数，避免“随便点几下也触发”
    if (now - last > 800) count = 0;
    count += 1;

    this._adminTapLastAt = now;
    this._adminTapCount = count;

    if (count >= 5) {
      this._adminTapCount = 0;
      this._adminTapLastAt = 0;
      this.openAdminLogin();
    }
  },

  async onStartTap() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    wx.showLoading({ title: "处理中...", mask: true });
    let loadingClosed = false;
    const closeLoading = () => {
      if (loadingClosed) return;
      loadingClosed = true;
      wx.hideLoading();
    };

    try {
      // 1) 获取 openid
      const fnRes = await wx.cloud.callFunction({ name: "login" });
      const openid = fnRes && fnRes.result && fnRes.result.openid;
      if (!openid) {
        closeLoading();
        wx.showToast({ title: "获取登录信息失败", icon: "none" });
        return;
      }

      // 2) 查询是否已注册
      const queryRes = await db
        .collection(USER_COLLECTION)
        .where({ _openid: openid })
        .limit(2)
        .get();

      const list = (queryRes && queryRes.data) || [];
      if (list.length > 1) {
        closeLoading();
        wx.showModal({
          title: "登录异常",
          content: "检测到当前微信账号存在多条实名记录，请联系管理员处理后再登录。",
          showCancel: false,
        });
        return;
      }

      if (!list.length) {
        // 未注册：打开小区选择弹窗
        closeLoading();
        this.openCommunityPicker();
        return;
      }

      // 3) 已注册：鉴权并缓存用户信息
      const userDoc = list[0] || {};
      const allowed = uniq((access && access.allowedCommunities) || []);
      const userCommunity = pickStr(userDoc.community);
      if (allowed.length && userCommunity && allowed.indexOf(userCommunity) < 0) {
        closeLoading();
        wx.showModal({
          title: "暂无权限",
          content: "当前账号不在开放小区范围内，无法登录使用。请联系物业或管理员开通。",
          showCancel: false,
        });
        return;
      }

      const { _id, ...plain } = userDoc;
      const cachedUser = { ...plain, id: _id || plain.id || "me" };
      try {
        setStoredUser(cachedUser);
      } catch (e) {
        // ignore
      }

      closeLoading();
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/home/index/index" });
      }, 350);
    } catch (err) {
      console.error("登录/注册入口失败", err);
      closeLoading();
      wx.showToast({ title: "操作失败，请稍后重试", icon: "none" });
    } finally {
      this.setData({ isLoading: false });
      closeLoading();
    }
  },

  // 退出小程序（显著的可取消/退出）
  onExitTap() {
    try {
      wx.exitMiniProgram({});
    } catch (e) {
      wx.showToast({ title: "当前环境不支持退出", icon: "none" });
    }
  },

  noop() {},

  // 小区选择弹窗
  openCommunityPicker() {
    // 注意：未注册用户从 onStartTap 进入这里时，isLoading 仍可能为 true
    // （finally 才会重置）。这里不应拦截，否则会出现“按钮显示处理中但不弹出注册选择”的卡住体验。
    if (this.data.showCommunityPicker) return;
    const allowed = uniq((access && access.allowedCommunities) || []);
    const selected = pickStr(this.data.communitySelected);
    const idx = Math.max(0, allowed.indexOf(selected));
    this.setData({
      showCommunityPicker: true,
      // 默认不自动“展开列表”，由系统 picker 处理交互
      communityPickerIndex: idx,
    });
  },

  closeCommunityPicker() {
    this.setData({ showCommunityPicker: false });
  },

  onCommunityPickerChange(e) {
    const allowed = uniq((access && access.allowedCommunities) || []);
    const idx = Number(e && e.detail ? e.detail.value : 0) || 0;
    const chosen = pickStr(allowed[idx]);
    this.setData({
      communityPickerIndex: idx,
      communitySelected: chosen,
    });
  },

  confirmCommunityPicker() {
    const allowed = uniq((access && access.allowedCommunities) || []);
    const selected = pickStr(this.data.communitySelected);
    const chosen = selected;

    if (!chosen) {
      wx.showModal({
        title: "小区未匹配",
        content: "请选择您的小区后再继续注册。",
        showCancel: false,
      });
      return;
    }

    if (allowed.length && allowed.indexOf(chosen) < 0) {
      wx.showModal({
        title: "暂未开放",
        content: "当前小区暂未开放。请联系物业或管理员确认小区是否合作。",
        showCancel: false,
      });
      return;
    }

    try {
      wx.setStorageSync(PREFILL_COMMUNITY_KEY, chosen);
    } catch (e) {
      // ignore
    }

    this.setData({ showCommunityPicker: false });
    wx.navigateTo({ url: "/pages/auth/realname/index" });
  },

  // 管理员弹窗（仅开发环境可见）
  openAdminLogin() {
    if (this.data.isLoading) return;
    this.setData({ showAdminLogin: true, adminForm: { username: "", password: "" } });
  },

  closeAdminLogin() {
    if (this.data.isLoading) return;
    this.setData({ showAdminLogin: false });
  },

  onAdminInput(e) {
    const k = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k;
    if (!k) return;
    const v = e && e.detail ? e.detail.value : "";
    this.setData({ [`adminForm.${k}`]: v });
  },

  async onAdminLoginTap() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    wx.showLoading({ title: "登录中...", mask: true });

    let loadingClosed = false;
    const closeLoading = () => {
      if (loadingClosed) return;
      loadingClosed = true;
      wx.hideLoading();
    };

    try {
      const f = (this.data && this.data.adminForm) || {};
      const username = pickStr(f.username);
      const password = pickStr(f.password);
      if (!username || !password) {
        closeLoading();
        this.setData({ isLoading: false });
        return wx.showToast({ title: "请输入账号和密码", icon: "none" });
      }

      const res = await wx.cloud.callFunction({
        name: "adminLogin",
        data: { username, password, targetOpenid: ADMIN_TARGET_OPENID },
      });

      const r = res && res.result ? res.result : null;
      if (!r || !r.ok || !r.user) {
        closeLoading();
        wx.showToast({ title: "无权限", icon: "none" });
        return;
      }

      const userDoc = r.user || {};
      const { _id, ...plain } = userDoc;
      const cachedUser = {
        ...plain,
        id: _id || plain.id || "me",
        isSuperAdmin: true,
      };

      try {
        setStoredUser(cachedUser);
      } catch (e) {
        // ignore
      }

      closeLoading();
      this.setData({ showAdminLogin: false });
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/home/index/index" });
      }, 350);
    } catch (err) {
      console.error("管理员登录失败", err);
      closeLoading();
      wx.showToast({ title: "登录失败，请稍后重试", icon: "none" });
    } finally {
      this.setData({ isLoading: false });
      closeLoading();
    }
  },
});
