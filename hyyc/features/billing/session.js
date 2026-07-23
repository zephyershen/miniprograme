const { getBillingPlans } = require('./api.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { membershipBillingPresentation } = require('../membership/benefits.js');

const plansCache = createQueryCache({ ttlMs: 30 * 60 * 1000, maxEntries: 1 });

function loadBillingPlans({ force = false } = {}) {
  return plansCache.load(
    'plans',
    async () => membershipBillingPresentation(await getBillingPlans()),
    { force }
  );
}

module.exports = { loadBillingPlans };
