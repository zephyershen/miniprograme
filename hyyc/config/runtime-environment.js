const { CLOUD_ENV_ID } = require('./constants.js');

const RELEASE_VERSION = 'release';
const MUTATION_ENABLED_VERSIONS = new Set(['develop', 'trial', RELEASE_VERSION]);
const MUTATING_ACTIONS = Object.freeze({
  knowledgeFeed: new Set([
    'addComment',
    'appealComment',
    'deleteComment',
    'reportComment',
    'restoreComment',
    'uploadMedia',
    'saveProfile',
    'setRolePreview',
    'toggleFavorite',
    'toggleLike'
  ]),
  membershipBilling: new Set([
    'createPayment',
    'orderStatus',
    'paymentFailure'
  ])
});

function currentWxApi() {
  return typeof wx === 'undefined' ? null : wx;
}

function accountEnvironmentVersion(wxApi = currentWxApi()) {
  try {
    const account = wxApi
      && typeof wxApi.getAccountInfoSync === 'function'
      && wxApi.getAccountInfoSync();
    const value = account && account.miniProgram && account.miniProgram.envVersion;
    return ['develop', 'trial', RELEASE_VERSION].includes(value) ? value : 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

function runtimeCloudEnvironment(wxApi = currentWxApi()) {
  const version = accountEnvironmentVersion(wxApi);
  return Object.freeze({
    cloudEnvironmentId: CLOUD_ENV_ID,
    version,
    production: version === RELEASE_VERSION,
    mutationsAllowed: MUTATION_ENABLED_VERSIONS.has(version)
  });
}

function isCloudMutation(name, data = {}) {
  const actions = MUTATING_ACTIONS[name];
  return Boolean(actions && actions.has(String(data.action || '')));
}

function assertCloudMutationAllowed(name, data, wxApi = currentWxApi()) {
  if (!isCloudMutation(name, data)) return;
  const runtime = runtimeCloudEnvironment(wxApi);
  if (runtime.mutationsAllowed) return;
  const error = new Error('无法确认小程序运行版本，已阻止写操作，请重新打开后再试');
  error.code = 'NON_RELEASE_MUTATION_BLOCKED';
  throw error;
}

module.exports = {
  MUTATING_ACTIONS,
  accountEnvironmentVersion,
  assertCloudMutationAllowed,
  isCloudMutation,
  runtimeCloudEnvironment
};
