const ACTIVE_STATUSES = new Set(['active', 'grace']);
const RENEWAL_STATES = new Set(['none', 'auto_renew', 'cancel_at_period_end']);

function millis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function normalizeMembership(document, now = Date.now()) {
  const source = document || {};
  let status = typeof source.status === 'string' ? source.status : 'inactive';
  const currentPeriodEnd = source.currentPeriodEnd || source.expiresAt || null;
  const graceUntil = source.graceUntil || null;
  if (status === 'active' && Number.isFinite(millis(currentPeriodEnd))
    && millis(currentPeriodEnd) <= now) status = 'expired';
  if (status === 'grace' && Number.isFinite(millis(graceUntil))
    && millis(graceUntil) <= now) status = 'expired';
  const renewalState = RENEWAL_STATES.has(source.renewalState) ? source.renewalState : 'none';
  return {
    planCode: source.planCode === 'pro' ? 'pro' : 'free',
    status,
    currentPeriodEnd,
    graceUntil,
    renewalState,
    source: source.source || '',
    version: Math.max(1, Number(source.version) || 1)
  };
}

function membershipActive(membership, now = Date.now()) {
  const normalized = normalizeMembership(membership, now);
  return normalized.planCode === 'pro' && ACTIVE_STATUSES.has(normalized.status);
}

function createMembershipService({ membershipRepository, now = () => Date.now() }) {
  async function get(ownerKey) {
    return normalizeMembership(await membershipRepository.get(ownerKey), now());
  }

  return { get };
}

module.exports = {
  ACTIVE_STATUSES,
  RENEWAL_STATES,
  millis,
  normalizeMembership,
  membershipActive,
  createMembershipService
};
