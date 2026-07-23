const {
  compareFunctionConfiguration,
  compareFunctionManifest,
  getOnlineFunctionDetail,
  listOnlineFunctions,
  loadReleaseContracts,
  parseControlArgs,
  printReport
} = require('./lib/cloudbase-release-control');

async function main() {
  const options = parseControlArgs(process.argv.slice(2));
  if (options.mode === 'apply') {
    throw new Error(
      'Function manifest control is read-only; deploy functions separately and run check'
    );
  }
  const contracts = loadReleaseContracts();
  const envId = options.envId || contracts.envId;
  const expected = contracts.functions;

  if (options.mode === 'plan') {
    printReport({
      control: 'function-manifest',
      mode: 'dry-run',
      status: 'planned',
      envId,
      resourceCount: expected.length,
      changeCount: null,
      expectedFunctions: expected
    }, options.json);
    return;
  }

  const online = listOnlineFunctions(envId);
  const manifestMismatches = compareFunctionManifest(expected, online);
  const onlineNames = new Set(online.map((entry) => entry.name));
  const configurationMismatches = [];
  const configurations = [];
  for (const functionContract of expected) {
    if (!onlineNames.has(functionContract.name)) continue;
    const actual = getOnlineFunctionDetail(envId, functionContract.name);
    configurations.push(actual);
    configurationMismatches.push(
      ...compareFunctionConfiguration(functionContract, actual)
    );
  }
  const mismatches = [...manifestMismatches, ...configurationMismatches];
  printReport({
    control: 'function-manifest',
    mode: 'check',
    status: mismatches.length ? 'drift' : 'converged',
    envId,
    resourceCount: expected.length,
    changeCount: mismatches.length,
    mismatches,
    onlineFunctions: online,
    configurations
  }, options.json);
  if (mismatches.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
