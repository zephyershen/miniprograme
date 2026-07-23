function stableCode(error) {
  const value = String(error && error.code || '');
  return /^[A-Z0-9_]{3,80}$/.test(value) ? value : 'INTELLIGENCE_FAILURE';
}

function createResilientIntelligenceProvider({
  primary,
  fallback,
  failureThreshold = 3,
  cooldownMs = 5 * 60 * 1000,
  now = () => Date.now(),
  logger = console
}) {
  const primaryReady = primary && primary.enabled === true;
  const fallbackReady = fallback && fallback.enabled === true;
  if (!primaryReady && !fallbackReady) {
    const error = new Error('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
    error.code = 'INTELLIGENCE_PROVIDER_CONFIG_INVALID';
    throw error;
  }
  const circuits = new Map();

  function stateFor(method) {
    if (!circuits.has(method)) circuits.set(method, { failures: 0, openedAt: 0 });
    return circuits.get(method);
  }

  function primaryAvailable(method) {
    if (!primaryReady || typeof primary[method] !== 'function') return false;
    const state = stateFor(method);
    if (!state.openedAt) return true;
    if (now() - state.openedAt >= cooldownMs) {
      state.failures = 0;
      state.openedAt = 0;
      return true;
    }
    return false;
  }

  function recordSuccess(method) {
    const state = stateFor(method);
    state.failures = 0;
    state.openedAt = 0;
  }

  function recordFailure(method) {
    const state = stateFor(method);
    state.failures += 1;
    if (state.failures >= Math.max(1, Number(failureThreshold) || 1)) {
      state.openedAt = now();
    }
  }

  async function invoke(method, args) {
    let primaryError = null;
    if (primaryAvailable(method)) {
      try {
        const result = await primary[method](...args);
        recordSuccess(method);
        return result;
      } catch (error) {
        primaryError = error;
        recordFailure(method);
        logger.warn('Primary intelligence provider unavailable', {
          method,
          code: stableCode(error)
        });
      }
    }
    if (fallbackReady && typeof fallback[method] === 'function') {
      return fallback[method](...args);
    }
    if (primaryError) throw primaryError;
    const error = new Error('INTELLIGENCE_PROVIDER_UNAVAILABLE');
    error.code = 'INTELLIGENCE_PROVIDER_UNAVAILABLE';
    throw error;
  }

  return Object.freeze({
    name: primaryReady && fallbackReady
      ? `${primary.name || 'primary'}-with-${fallback.name || 'fallback'}-fallback`
      : (primaryReady ? primary.name : fallback.name),
    enabled: true,
    model: primaryReady ? primary.model : fallback.model,
    analyzeItem: (...args) => invoke('analyzeItem', args),
    analyzeItems: (...args) => invoke('analyzeItems', args),
    generateDigest: (...args) => invoke('generateDigest', args),
    generateColumnCase: (...args) => invoke('generateColumnCase', args),
    moderateComment: (...args) => invoke('moderateComment', args),
    moderateProfile: (...args) => invoke('moderateProfile', args),
    reviewSourcePreview: (...args) => invoke('reviewSourcePreview', args)
  });
}

module.exports = {
  stableCode,
  createResilientIntelligenceProvider
};
