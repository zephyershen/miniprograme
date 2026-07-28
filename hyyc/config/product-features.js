const PRODUCT_FEATURES = Object.freeze({
  comments: false
});

function isProductFeatureEnabled(featureKey) {
  return PRODUCT_FEATURES[String(featureKey || '').trim()] === true;
}

module.exports = {
  PRODUCT_FEATURES,
  isProductFeatureEnabled
};
