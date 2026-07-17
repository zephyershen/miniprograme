function disabledError() {
  const error = new Error('INTELLIGENCE_PROVIDER_DISABLED');
  error.code = 'INTELLIGENCE_PROVIDER_DISABLED';
  return error;
}

function createDisabledIntelligenceProvider() {
  return Object.freeze({
    name: 'disabled',
    enabled: false,
    analyzeItem: async () => { throw disabledError(); },
    generateDigest: async () => { throw disabledError(); }
  });
}

module.exports = { createDisabledIntelligenceProvider, disabledError };
