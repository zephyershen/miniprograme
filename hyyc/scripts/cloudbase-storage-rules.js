const {
  assertApplyConfirmation,
  compareStorageRules,
  getStorageRules,
  loadReleaseContracts,
  parseControlArgs,
  printReport,
  setStorageRules,
  waitForReadback
} = require('./lib/cloudbase-release-control');

async function main() {
  const options = parseControlArgs(process.argv.slice(2));
  const contracts = loadReleaseContracts();
  const envId = options.envId || contracts.envId;
  const expected = contracts.storage;

  if (options.mode === 'plan') {
    printReport({
      control: 'storage-rules',
      mode: 'dry-run',
      status: 'planned',
      envId,
      resourceCount: 1,
      changeCount: null,
      desiredAcl: 'CUSTOM',
      desiredRule: expected,
      applyGuard: `--confirm-env ${envId}`
    }, options.json);
    return;
  }

  assertApplyConfirmation(options, envId);
  const observed = getStorageRules(envId);
  const mismatches = compareStorageRules(expected, observed);
  if (options.mode === 'check') {
    printReport({
      control: 'storage-rules',
      mode: 'check',
      status: mismatches.length ? 'drift' : 'converged',
      envId,
      resourceCount: 1,
      changeCount: mismatches.length ? 1 : 0,
      mismatches
    }, options.json);
    if (mismatches.length) process.exitCode = 1;
    return;
  }

  if (mismatches.length) setStorageRules(envId, expected);
  const readback = await waitForReadback(() => {
    const latest = getStorageRules(envId);
    const latestMismatches = compareStorageRules(expected, latest);
    return { ok: latestMismatches.length === 0, mismatches: latestMismatches };
  }, {
    attempts: options.readbackAttempts,
    delayMs: options.readbackDelayMs
  });
  if (!readback.ok) {
    throw new Error(
      `Storage rule readback did not converge after ${readback.attempts} attempts`
    );
  }
  printReport({
    control: 'storage-rules',
    mode: 'apply',
    status: mismatches.length ? 'applied-and-verified' : 'already-converged',
    envId,
    resourceCount: 1,
    changeCount: mismatches.length ? 1 : 0,
    mismatches: [],
    readbackAttempts: readback.attempts
  }, options.json);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
