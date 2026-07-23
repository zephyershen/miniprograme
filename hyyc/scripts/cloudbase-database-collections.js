const {
  applyAndReadBackDatabaseCollections,
  assertCollectionApplyConfirmation,
  compareDatabaseCollectionState,
  databaseCollectionReport,
  parseCollectionControlArgs,
  printDatabaseCollectionReport,
  readDatabaseCollectionState
} = require('./lib/cloudbase-database-collection-control');
const {
  loadReleaseContracts
} = require('./lib/cloudbase-release-control');

async function main() {
  const options = parseCollectionControlArgs(process.argv.slice(2));
  const contracts = loadReleaseContracts();
  const envId = options.envId || contracts.envId;
  const collections = contracts.database.collections;

  // Exact confirmation is required before the full remote preflight, so an
  // accidental apply cannot reach either a read or write action.
  assertCollectionApplyConfirmation(options, envId);

  if (options.mode === 'apply') {
    const applied = await applyAndReadBackDatabaseCollections(
      envId,
      collections,
      {
        readbackAttempts: options.readbackAttempts,
        readbackDelayMs: options.readbackDelayMs
      }
    );
    if (!applied.readback.ok) {
      throw new Error(
        `Database collection readback did not converge after `
          + `${applied.readback.attempts} attempts`
      );
    }
    const report = databaseCollectionReport(
      'apply',
      envId,
      collections,
      applied.readback.state,
      applied.readback.comparison
    );
    report.status = applied.changeCount ? 'applied-and-verified' : 'already-converged';
    report.changeCount = applied.changeCount;
    report.readbackAttempts = applied.readback.attempts;
    printDatabaseCollectionReport(report, options.json);
    return;
  }

  const state = readDatabaseCollectionState(envId, collections);
  const comparison = compareDatabaseCollectionState(collections, state);
  const report = databaseCollectionReport(
    options.mode,
    envId,
    collections,
    state,
    comparison
  );
  printDatabaseCollectionReport(report, options.json);

  if (options.mode === 'check' && !comparison.converged) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
