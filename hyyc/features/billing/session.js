const { getBillingPlans } = require('./api.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { membershipBillingPresentation } = require('../membership/benefits.js');
const { memberPurchasesEnabled } = require('../membership/access.js');
const { cachedMembershipAccess } = require('../membership/session.js');
const { runtimeCloudEnvironment } = require('../../config/runtime-environment.js');

const plansCache = createQueryCache({ ttlMs: 30 * 60 * 1000, maxEntries: 1 });

async function loadBillingPlans({
  force = false,
  access = cachedMembershipAccess(),
  wxApi
} = {}) {
  const plans = await plansCache.load(
    'plans',
    getBillingPlans,
    { force }
  );
  const runtime = runtimeCloudEnvironment(wxApi);
  return membershipBillingPresentation(plans, {
    memberPurchases: memberPurchasesEnabled(access),
    mutationsAllowed: runtime.mutationsAllowed
  });
}

module.exports = { loadBillingPlans };
