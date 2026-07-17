const {
  refreshMembershipAccess,
  changeMembershipRolePreview
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');

function coveragePresentation(access) {
  const coverage = access && access.coverage || {};
  const completeFrom = new Date(coverage.completeFrom);
  const dateLabel = Number.isNaN(completeFrom.getTime())
    ? ''
    : `${completeFrom.getFullYear()}.${String(completeFrom.getMonth() + 1).padStart(2, '0')}.${String(completeFrom.getDate()).padStart(2, '0')}`;
  return {
    stateLabel: coverage.state === 'complete' ? '数据覆盖完整' : '数据仍在持续补全',
    dateLabel
  };
}

Page({
  data: {
    loading: true,
    roleSwitching: false,
    switchingRole: '',
    error: '',
    membership: membershipPresentation(null),
    coverage: coveragePresentation(null)
  },

  onShow() {
    this.loadMembership();
  },

  onPullDownRefresh() {
    this.loadMembership().finally(() => wx.stopPullDownRefresh());
  },

  async loadMembership() {
    this.setData({ loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force: true });
      this.setData({
        loading: false,
        membership: membershipPresentation(access),
        coverage: coveragePresentation(access)
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '身份状态暂时无法加载' });
    }
  },

  async selectRolePreview(event) {
    const role = event.currentTarget.dataset.role;
    if (this.data.roleSwitching || !this.data.membership.canPreviewRoles
      || !this.data.membership.roleOptions.some((item) => item.key === role)
      || role === this.data.membership.role) return;
    this.setData({ roleSwitching: true, switchingRole: role });
    try {
      const access = await changeMembershipRolePreview(role);
      this.setData({
        membership: membershipPresentation(access),
        coverage: coveragePresentation(access)
      });
      wx.showToast({ title: '预览身份已切换', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '切换失败', icon: 'none' });
    } finally {
      this.setData({ roleSwitching: false, switchingRole: '' });
    }
  },

  openCards() {
    wx.navigateTo({ url: '/pages/cards/index' });
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  openFeed() {
    wx.switchTab({ url: '/pages/inbox/index' });
  }
});
