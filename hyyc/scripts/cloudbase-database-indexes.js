const {
  applyAndReadBackDatabaseIndexes,
  assertIndexApplyConfirmation,
  compareDatabaseIndexState,
  databaseIndexReport,
  loadDatabaseIndexContract,
  parseIndexControlArgs,
  printDatabaseIndexReport,
  readDatabaseIndexState
} = require('./lib/cloudbase-database-index-control');

async function main() {
  const options = parseIndexControlArgs(process.argv.slice(2));
  const loaded = loadDatabaseIndexContract();
  const envId = options.envId || loaded.envId;
  const contract = loaded.contract;

  // The exact environment confirmation is checked before the first remote read,
  // so an accidental apply cannot reach any write path.
  assertIndexApplyConfirmation(options, envId);

  if (options.mode === 'apply') {
    const applied = await applyAndReadBackDatabaseIndexes(envId, contract, {
      readbackAttempts: options.readbackAttempts,
      readbackDelayMs: options.readbackDelayMs
    });
    if (!applied.readback.ok) {
      throw new Error(
        `Database index readback did not converge after ${applied.readback.attempts} attempts`
      );
    }
    const report = databaseIndexReport(
      'apply',
      envId,
      contract,
      applied.readback.state,
      applied.readback.comparison
    );
    report.status = applied.changeCount ? 'applied-and-verified' : 'already-converged';
    report.changeCount = applied.changeCount;
    report.readbackAttempts = applied.readback.attempts;
    printDatabaseIndexReport(report, options.json);
    return;
  }

  const state = readDatabaseIndexState(envId, contract);
  const comparison = compareDatabaseIndexState(contract, state);
  const report = databaseIndexReport(options.mode, envId, contract, state, comparison);
  printDatabaseIndexReport(report, options.json);

  if (options.mode === 'check' && !comparison.converged) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
