const { membershipPrompt } = require('../../features/membership/prompt.js');
const { loadBillingPlans } = require('../../features/billing/session.js');
const { cachedMembershipAccess } = require('../../features/membership/session.js');

const EMPTY_PLAN = Object.freeze({
  priceCents: 0,
  priceLabel: '',
  compareAtPriceCents: 0,
  compareAtPriceLabel: ''
});

Component({
  properties: {
    visible: { type: Boolean, value: false },
    featureKey: { type: String, value: 'curated_feed' }
  },

  data: {
    prompt: membershipPrompt('curated_feed'),
    billingAvailable: false,
    billingPlan: { ...EMPTY_PLAN }
  },

  lifetimes: {
    attached() {
      this.loadBillingPlan();
    }
  },

  observers: {
    featureKey(value) {
      this.setData({ prompt: membershipPrompt(value) });
    },
    visible(value) {
      if (value) this.loadBillingPlan();
    }
  },

  methods: {
    stopPropagation() {},
    async loadBillingPlan() {
      try {
        const billing = await loadBillingPlans({ access: cachedMembershipAccess() });
        this.setData({
          billingAvailable: billing && billing.available === true,
          billingPlan: billing && billing.plan || { ...EMPTY_PLAN }
        });
      } catch (error) {
        this.setData({
          billingAvailable: false,
          billingPlan: { ...EMPTY_PLAN }
        });
      }
    },
    close() {
      this.triggerEvent('close');
    },
    viewBenefits() {
      this.triggerEvent('viewbenefits', { featureKey: this.data.prompt.featureKey });
    }
  }
});
