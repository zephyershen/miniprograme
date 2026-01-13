// 登录/注册入口欢迎页：展示欢迎插画 + 登录/注册按钮
// 使用云开发数据库，登录时根据 _openid 查询 userInfo 集合
const db = wx.cloud.database();
const USER_COLLECTION = 'userInfo';

Page({
  data: {
    // 登录中的 loading 状态，防止重复点击
    isLoading: false
  },

  // 注册按钮：不再调用任何授权接口，只负责跳转到实名注册页
  onRegisterTap() {
    wx.navigateTo({ url: '/pages/auth/realname/index' });
  },

  // 登录按钮：根据 openid 查询 userInfo，如果已实名则直接进入首页，否则引导去注册
  async onLoginTap() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    // 顶部显示一个系统自带的「加载中」提示，并禁止点击背景
    wx.showLoading({ title: '登录中...', mask: true });

    try {
      // 1）通过云函数 login 获取当前用户在本小程序下的 openid
      const fnRes = await wx.cloud.callFunction({ name: 'login' });
      const openid = fnRes && fnRes.result && fnRes.result.openid;

      if (!openid) {
        wx.showToast({ title: '获取登录信息失败', icon: 'none' });
        return;
      }

      // 2）根据 _openid 查询 userInfo，看是否已经实名/注册
      const queryRes = await db.collection(USER_COLLECTION)
        .where({ _openid: openid })
        .limit(1)
        .get();

      const list = (queryRes && queryRes.data) || [];
      if (!list.length) {
        // 没找到实名信息，引导用户先去注册
        wx.showModal({
          title: '尚未注册',
          content: '未找到您的实名信息，请先完成注册。',
          confirmText: '去注册',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/auth/realname/index' });
            }
          }
        });
        return;
      }

      // 3）已找到实名信息：把用户信息存到本地缓存，并进入首页
      const userDoc = list[0] || {};
      const { _id, ...plain } = userDoc;
      // 兼容后续页面：提供一个通用的 id 字段，同时保留实名标记
      const cachedUser = {
        ...plain,
        id: _id || plain.id || 'me'
      };
      try {
        wx.setStorageSync('hyyc_user', cachedUser);
      } catch (e) {
        console.error('缓存用户信息失败', e);
      }

      wx.showToast({ title: '登录成功', icon: 'success' });

      // 稍微延时一下再跳转，避免 toast 还没显示就切页
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/index/index' });
      }, 400);
    } catch (err) {
      console.error('登录失败', err);
      wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
    } finally {
      // 不管成功还是失败，都在最后关闭 loading 状态
      this.setData({ isLoading: false });
      wx.hideLoading();
    }
  }
});
