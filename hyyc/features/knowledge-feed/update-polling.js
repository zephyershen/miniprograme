const IDLE_DELAYS_MS = Object.freeze([2, 3, 5].map((minutes) => minutes * 60 * 1000));
const FAILURE_DELAYS_MS = Object.freeze([3, 6, 12, 15].map((minutes) => minutes * 60 * 1000));

function createUpdatePollState() {
  return { idleChecks: 0, failures: 0 };
}

function updatePollDelay(state = createUpdatePollState()) {
  const failures = Math.max(0, Math.floor(Number(state.failures) || 0));
  if (failures) return FAILURE_DELAYS_MS[Math.min(failures - 1, FAILURE_DELAYS_MS.length - 1)];
  const idleChecks = Math.max(0, Math.floor(Number(state.idleChecks) || 0));
  return IDLE_DELAYS_MS[Math.min(idleChecks, IDLE_DELAYS_MS.length - 1)];
}

function recordUpdatePollSuccess(state = createUpdatePollState(), newCount = 0) {
  return {
    failures: 0,
    idleChecks: Number(newCount) > 0
      ? 0
      : Math.min((Number(state.idleChecks) || 0) + 1, IDLE_DELAYS_MS.length - 1)
  };
}

function recordUpdatePollFailure(state = createUpdatePollState()) {
  return {
    idleChecks: Math.max(0, Math.floor(Number(state.idleChecks) || 0)),
    failures: Math.min((Number(state.failures) || 0) + 1, FAILURE_DELAYS_MS.length)
  };
}

module.exports = {
  IDLE_DELAYS_MS,
  FAILURE_DELAYS_MS,
  createUpdatePollState,
  updatePollDelay,
  recordUpdatePollSuccess,
  recordUpdatePollFailure
};
