const { CLOUD_ENV_ID } = require('./constants.js');

const RELEASE_VERSION = 'release';
const MUTATING_ACTIONS = Object.freeze({
  knowledgeFeed: new Set([
    'addComment',
    'uploadMedia',
    'saveProfile',
    'setRolePreview',
    'toggleFavorite',
    'toggleLike'
  ]),
  membershipBilling: new Set([
    'createPayment',
    'orderStatus'
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
    mutationsAllowed: version === RELEASE_VERSION
  });
}

function isCloudMutation(name, data = {}) {
  const actions = MUTATING_ACTIONS[name];
  return Boolean(actions && actions.has(String(data.action || '')));
}

function assertCloudMutationAllowed(name, data, wxApi = currentWxApi()) {
  if (!isCloudMutation(name, data)) return;
  if (runtimeCloudEnvironment(wxApi).mutationsAllowed) return;
  const error = new Error('开发版和体验版为生产只读模式，请在正式版完成此操作');
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
