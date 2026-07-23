const {
  DATABASE_PERMISSION,
  assertApplyConfirmation,
  compareDatabasePermissions,
  describeDatabasePermissions,
  loadReleaseContracts,
  parseControlArgs,
  printReport,
  setDatabasePermission,
  waitForReadback
} = require('./lib/cloudbase-release-control');

async function main() {
  const options = parseControlArgs(process.argv.slice(2));
  const contracts = loadReleaseContracts();
  const envId = options.envId || contracts.envId;
  const collections = contracts.database.collections;

  if (options.mode === 'plan') {
    printReport({
      control: 'database-rules',
      mode: 'dry-run',
      status: 'planned',
      envId,
      resourceCount: collections.length,
      changeCount: null,
      desiredPermission: DATABASE_PERMISSION,
      resources: collections,
      applyGuard: `--confirm-env ${envId}`
    }, options.json);
    return;
  }

  assertApplyConfirmation(options, envId);
  const observed = describeDatabasePermissions(envId, collections);
  const mismatches = compareDatabasePermissions(collections, observed);
  if (options.mode === 'check') {
    printReport({
      control: 'database-rules',
      mode: 'check',
      status: mismatches.length ? 'drift' : 'converged',
      envId,
      resourceCount: collections.length,
      changeCount: mismatches.length,
      mismatches
    }, options.json);
    if (mismatches.length) process.exitCode = 1;
    return;
  }

  for (const mismatch of mismatches) {
    setDatabasePermission(envId, mismatch.resource);
  }
  const readback = await waitForReadback(() => {
    const latest = describeDatabasePermissions(envId, collections);
    const latestMismatches = compareDatabasePermissions(collections, latest);
    return { ok: latestMismatches.length === 0, mismatches: latestMismatches };
  }, {
    attempts: options.readbackAttempts,
    delayMs: options.readbackDelayMs
  });
  if (!readback.ok) {
    throw new Error(
      `Database permission readback did not converge after ${readback.attempts} attempts`
    );
  }
  printReport({
    control: 'database-rules',
    mode: 'apply',
    status: mismatches.length ? 'applied-and-verified' : 'already-converged',
    envId,
    resourceCount: collections.length,
    changeCount: mismatches.length,
    mismatches: [],
    readbackAttempts: readback.attempts
  }, options.json);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
