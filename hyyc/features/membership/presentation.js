const MEMBERSHIP_BENEFITS = Object.freeze([
  { key: 'curated', title: '重要资讯精选', copy: '从每天的新资讯中优先留下真正值得花时间的变化。' },
  { key: 'briefing', title: '24 小时 / 7 天 / 30 天简报', copy: '先看结论与影响，再决定是否继续阅读来源。' },
  { key: 'history', title: '30 天完整历史', copy: '简报里的重要引用可以继续回看，不止停留在摘要。' }
]);
const ROLE_PREVIEW_OPTIONS = Object.freeze([
  { key: 'free', label: '普通用户' },
  { key: 'member', label: 'Pro 会员' },
  { key: 'admin', label: '管理员' }
]);

function formatPeriodEnd(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function membershipPresentation(access) {
  const viewer = (access && access.viewer) || { role: 'free', membershipStatus: 'inactive' };
  const role = viewer.role || 'free';
  const roleLabel = role === 'admin' ? '管理员' : role === 'member' ? 'Pro 会员' : '普通用户';
  const roleCopy = role === 'admin'
    ? '已拥有全部已归档资讯与所有会员能力。'
    : role === 'member'
      ? '已开放 30 天历史、精选与三种滚动简报。'
      : '默认可查看最近 7 天的全部资讯。';
  return {
    role,
    roleLabel,
    roleCopy,
    isPrivileged: role === 'member' || role === 'admin',
    isAdmin: role === 'admin',
    canPreviewRoles: viewer.canPreviewRoles === true,
    isRolePreview: viewer.isRolePreview === true,
    previewRole: viewer.previewRole || role,
    roleOptions: ROLE_PREVIEW_OPTIONS.map((item) => ({ ...item, active: item.key === role })),
    periodEndLabel: formatPeriodEnd(viewer.currentPeriodEnd),
    renewalLabel: viewer.renewalState === 'cancel_at_period_end'
      ? '已停止续费，到期前仍可使用'
      : viewer.renewalState === 'auto_renew' ? '自动续费' : '',
    benefits: MEMBERSHIP_BENEFITS
  };
}

module.exports = {
  MEMBERSHIP_BENEFITS,
  ROLE_PREVIEW_OPTIONS,
  membershipPresentation,
  formatPeriodEnd
};
