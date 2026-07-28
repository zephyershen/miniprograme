const {
  MEMBERSHIP_TERMS,
  membershipBenefits,
  membershipMetrics
} = require('./benefits.js');
const { isProductFeatureEnabled } = require('../../config/product-features.js');

const MEMBERSHIP_BENEFITS = Object.freeze(membershipBenefits());
const ROLE_PREVIEW_OPTIONS = Object.freeze([
  { key: 'free', label: '普通用户' },
  { key: 'member', label: 'Pro 会员' },
  { key: 'admin', label: '管理员' }
]);

function formatPeriodEnd(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function membershipPresentation(access, now = Date.now()) {
  const viewer = (access && access.viewer) || { role: 'free', membershipStatus: 'inactive' };
  const rawRole = viewer.role || 'free';
  const periodEnd = new Date(viewer.currentPeriodEnd || '').getTime();
  const expiredMember = rawRole === 'member'
    && Number.isFinite(periodEnd)
    && periodEnd <= Number(now);
  const role = expiredMember ? 'free' : rawRole;
  const isActiveMember = role === 'member' && viewer.isRolePreview !== true;
  const roleLabel = role === 'admin' ? '管理员' : role === 'member' ? 'Pro 会员' : '普通用户';
  const roleCopy = role === 'admin'
    ? '已拥有全部已归档资讯与所有会员能力。'
    : role === 'member'
      ? (isProductFeatureEnabled('comments')
        ? '已开放 AI 专栏、精选、三档简报、30 天历史与会员评论。'
        : '已开放 AI 专栏、精选、三档简报与 30 天历史。')
      : '默认可查看最近 24 小时的全部资讯。';
  return {
    role,
    roleLabel,
    roleCopy,
    isActiveMember,
    purchaseMode: role === 'member' ? 'renew' : 'subscribe',
    isPrivileged: role === 'member' || role === 'admin',
    isAdmin: role === 'admin',
    isActualAdmin: viewer.isActualAdmin === true,
    canPreviewRoles: viewer.canPreviewRoles === true,
    isRolePreview: viewer.isRolePreview === true,
    previewRole: viewer.previewRole || role,
    roleOptions: ROLE_PREVIEW_OPTIONS.map((item) => ({ ...item, active: item.key === role })),
    periodEndLabel: role === 'member' ? formatPeriodEnd(viewer.currentPeriodEnd) : '',
    renewalLabel: role !== 'member' ? '' : viewer.renewalState === 'cancel_at_period_end'
      ? '已停止续费，到期前仍可使用'
      : viewer.renewalState === 'auto_renew' ? '自动续费' : '',
    benefits: membershipBenefits(),
    benefitMetrics: membershipMetrics(),
    membershipTerms: { ...MEMBERSHIP_TERMS },
    accessExpired: expiredMember
  };
}

module.exports = {
  MEMBERSHIP_BENEFITS,
  ROLE_PREVIEW_OPTIONS,
  membershipPresentation,
  formatPeriodEnd
};
