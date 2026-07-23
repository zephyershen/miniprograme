function disabledError() {
  const error = new Error('INTELLIGENCE_PROVIDER_DISABLED');
  error.code = 'INTELLIGENCE_PROVIDER_DISABLED';
  return error;
}

function createDisabledIntelligenceProvider(reason = 'disabled') {
  return Object.freeze({
    name: 'disabled',
    enabled: false,
    reason,
    analyzeItem: async () => { throw disabledError(); },
    analyzeItems: async () => { throw disabledError(); },
    generateDigest: async () => { throw disabledError(); },
    generateColumnCase: async () => { throw disabledError(); },
    moderateComment: async () => { throw disabledError(); },
    moderateProfile: async () => { throw disabledError(); },
    reviewSourcePreview: async () => { throw disabledError(); }
  });
}

function createManagedAiClient(config, options = {}) {
  if (options.cloudbaseAi) return options.cloudbaseAi;
  const sdk = options.cloudbaseSdk || require('@cloudbase/node-sdk');
  if (!sdk || typeof sdk.init !== 'function' || !sdk.SYMBOL_CURRENT_ENV) {
    const error = new Error('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
    error.code = 'INTELLIGENCE_PROVIDER_CONFIG_INVALID';
    throw error;
  }
  const timeout = Math.max(60000, Number(config.cloudbaseTimeoutMs) || 0);
  const app = sdk.init({ env: sdk.SYMBOL_CURRENT_ENV, timeout });
  if (!app || typeof app.ai !== 'function') {
    const error = new Error('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
    error.code = 'INTELLIGENCE_PROVIDER_CONFIG_INVALID';
    throw error;
  }
  return app.ai();
}

function createCloudbaseProvider(config, options) {
  if (config.cloudbaseEnabled !== true) return null;
  const cloud = options.cloud || require('wx-server-sdk');
  const ai = createManagedAiClient(config, options);
  const {
    createIntelligenceBudgetService
  } = require('../services/intelligence-budget-service');
  const {
    createCloudbaseIntelligenceProvider
  } = require('./cloudbase-intelligence-provider');
  let budgetService = options.budgetService;
  if (!budgetService) {
    const {
      createCloudbaseIntelligenceBudgetStore
    } = require('./cloudbase-intelligence-budget-store');
    const database = options.database || cloud.database();
    const budgetStore = options.budgetStore || createCloudbaseIntelligenceBudgetStore(
      database,
      { collectionName: config.cloudbaseBudgetCollectionName }
    );
    budgetService = createIntelligenceBudgetService({
      monthlyPackagePoints: config.cloudbaseMonthlyPackagePoints,
      coreReservePoints: config.cloudbaseCoreReservePoints,
      monthlyAiPointLimit: config.cloudbaseMonthlyAiPointLimit,
      outputTokenReserveMultiplier: config.cloudbaseOutputTokenReserveMultiplier,
      modelPointRates: config.cloudbaseModelPointRates
    }, {
      store: budgetStore,
      now: options.now
    });
  }
  return createCloudbaseIntelligenceProvider({
    ai,
    budgetService,
    modelGroup: config.cloudbaseModelGroup,
    analysisModel: config.cloudbaseAnalysisModel,
    digestModel: config.cloudbaseDigestModel,
    moderationTextModel: config.cloudbaseModerationTextModel,
    moderationImageModel: config.cloudbaseModerationImageModel,
    timeoutMs: config.cloudbaseTimeoutMs,
    analysisTimeoutMs: config.cloudbaseAnalysisTimeoutMs,
    digestTimeoutMs: config.cloudbaseDigestTimeoutMs,
    moderationTimeoutMs: config.cloudbaseModerationTimeoutMs,
    sourcePreviewReviewTimeoutMs: config.cloudbaseSourcePreviewReviewTimeoutMs,
    analysisMaxOutputTokens: config.analysisMaxOutputTokens,
    analysisBatchMaxOutputTokens: config.analysisBatchMaxOutputTokens,
    digestMaxOutputTokens: config.digestMaxOutputTokens,
    columnCaseMaxOutputTokens: config.columnCaseMaxOutputTokens,
    sourcePreviewReviewMaxOutputTokens: config.sourcePreviewReviewMaxOutputTokens,
    setTimeoutImpl: options.setTimeoutImpl,
    clearTimeoutImpl: options.clearTimeoutImpl
  });
}

function createPackyProvider(config, options) {
  if (!config.apiKey) return null;
  const { createPackyIntelligenceProvider } = require('./packy-intelligence-provider');
  return createPackyIntelligenceProvider({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: config.packyTimeoutMs || config.timeoutMs,
    moderationTimeoutMs: config.packyModerationTimeoutMs,
    sourcePreviewReviewTimeoutMs: config.packySourcePreviewReviewTimeoutMs,
    analysisMaxOutputTokens: config.analysisMaxOutputTokens,
    analysisBatchMaxOutputTokens: config.analysisBatchMaxOutputTokens,
    digestMaxOutputTokens: config.digestMaxOutputTokens,
    columnCaseMaxOutputTokens: config.columnCaseMaxOutputTokens,
    sourcePreviewReviewMaxOutputTokens: config.sourcePreviewReviewMaxOutputTokens,
    fetchImpl: options.packyFetchImpl || options.fetchImpl || globalThis.fetch,
    setTimeoutImpl: options.setTimeoutImpl,
    clearTimeoutImpl: options.clearTimeoutImpl
  });
}

function createIntelligenceProvider(config = {}, options = {}) {
  if (config.providerEnabled !== true) return createDisabledIntelligenceProvider();
  let primary = options.primaryProvider || null;
  let primaryError = null;
  if (!primary) {
    try {
      primary = createCloudbaseProvider(config, options);
    } catch (error) {
      primaryError = error;
    }
  }
  let fallback = options.fallbackProvider || null;
  let fallbackError = null;
  if (!fallback) {
    try {
      fallback = createPackyProvider(config, options);
    } catch (error) {
      fallbackError = error;
    }
  }
  const primaryReady = primary && primary.enabled === true;
  const fallbackReady = fallback && fallback.enabled === true;
  if (!primaryReady && !fallbackReady) {
    const error = fallbackError || primaryError
      || new Error('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
    error.code = 'INTELLIGENCE_PROVIDER_CONFIG_INVALID';
    if (options.logger && typeof options.logger.warn === 'function') {
      options.logger.warn('Intelligence provider unavailable', { code: error.code });
    }
    return createDisabledIntelligenceProvider(error.code);
  }
  const { createResilientIntelligenceProvider } = require(
    './resilient-intelligence-provider'
  );
  try {
    return createResilientIntelligenceProvider({
      primary: primaryReady ? primary : null,
      fallback: fallbackReady ? fallback : null,
      failureThreshold: config.cloudbaseFailureThreshold,
      cooldownMs: config.cloudbaseCooldownMs,
      now: options.now,
      logger: options.logger
    });
  } catch (error) {
    const code = /^INTELLIGENCE_[A-Z0-9_]+$/.test(String(error && error.code || ''))
      ? error.code
      : 'INTELLIGENCE_PROVIDER_CONFIG_INVALID';
    if (options.logger && typeof options.logger.warn === 'function') {
      options.logger.warn('Intelligence provider unavailable', { code });
    }
    return createDisabledIntelligenceProvider(code);
  }
}

module.exports = {
  createDisabledIntelligenceProvider,
  createManagedAiClient,
  createCloudbaseProvider,
  createPackyProvider,
  createIntelligenceProvider,
  disabledError
};
