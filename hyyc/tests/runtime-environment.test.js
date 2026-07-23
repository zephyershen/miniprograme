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

test('keeps develop and trial builds read-only against the production cloud environment', () => {
  for (const version of ['develop', 'trial', 'unknown']) {
    const wxApi = version === 'unknown' ? {} : wxFor(version);
    assert.equal(accountEnvironmentVersion(wxApi), version);
    assert.equal(runtimeCloudEnvironment(wxApi).mutationsAllowed, false);
    for (const [functionName, actions] of Object.entries(MUTATING_ACTIONS)) {
      for (const action of actions) {
        assert.throws(
          () => assertCloudMutationAllowed(functionName, { action }, wxApi),
          (error) => error && error.code === 'NON_RELEASE_MUTATION_BLOCKED'
        );
      }
    }
  }
});

test('allows production mutations while leaving every read action available', () => {
  const release = wxFor('release');
  assert.equal(runtimeCloudEnvironment(release).production, true);
  assert.doesNotThrow(() => assertCloudMutationAllowed(
    'knowledgeFeed',
    { action: 'toggleLike' },
    release
  ));
  for (const version of ['develop', 'trial', 'release']) {
    assert.doesNotThrow(() => assertCloudMutationAllowed(
      'knowledgeFeed',
      { action: 'feed' },
      wxFor(version)
    ));
  }
  assert.equal(isCloudMutation('membershipBilling', { action: 'createPayment' }), true);
  assert.equal(isCloudMutation('membershipBilling', { action: 'plans' }), false);
});
