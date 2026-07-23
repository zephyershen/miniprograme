const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MUTATING_ACTIONS,
  accountEnvironmentVersion,
  assertCloudMutationAllowed,
  isCloudMutation,
  runtimeCloudEnvironment
} = require('../config/runtime-environment.js');

function wxFor(version) {
  return {
    getAccountInfoSync() {
      return { miniProgram: { envVersion: version } };
    }
  };
}

test('allows every registered write action in develop, trial and release builds', () => {
  for (const version of ['develop', 'trial', 'release']) {
    const wxApi = wxFor(version);
    assert.equal(accountEnvironmentVersion(wxApi), version);
    assert.equal(runtimeCloudEnvironment(wxApi).mutationsAllowed, true);
    for (const [functionName, actions] of Object.entries(MUTATING_ACTIONS)) {
      for (const action of actions) {
        assert.doesNotThrow(
          () => assertCloudMutationAllowed(functionName, { action }, wxApi)
        );
      }
    }
  }
});

test('fails closed for every registered write action when the build is unknown', () => {
  assert.equal(accountEnvironmentVersion({}), 'unknown');
  assert.equal(runtimeCloudEnvironment({}).mutationsAllowed, false);
  for (const [functionName, actions] of Object.entries(MUTATING_ACTIONS)) {
    for (const action of actions) {
      assert.throws(
        () => assertCloudMutationAllowed(functionName, { action }, {}),
        (error) => error && error.code === 'NON_RELEASE_MUTATION_BLOCKED'
      );
    }
  }
});

test('identifies release builds while leaving every read action available', () => {
  const release = wxFor('release');
  assert.equal(runtimeCloudEnvironment(release).production, true);
  assert.doesNotThrow(() => assertCloudMutationAllowed(
    'knowledgeFeed',
    { action: 'toggleLike' },
    release
  ));
  for (const version of ['develop', 'trial', 'release', 'unknown']) {
    const wxApi = version === 'unknown' ? {} : wxFor(version);
    assert.doesNotThrow(() => assertCloudMutationAllowed(
      'knowledgeFeed',
      { action: 'feed' },
      wxApi
    ));
  }
  assert.equal(isCloudMutation('membershipBilling', { action: 'createPayment' }), true);
  assert.equal(isCloudMutation('membershipBilling', { action: 'plans' }), false);
});
