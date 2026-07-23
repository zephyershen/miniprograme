const {
  RETIRED_FUNCTION_NAMES,
  assertApplyConfirmation,
  compareFunctionManifest,
  deleteOnlineFunction,
  listOnlineFunctions,
  loadReleaseContracts,
  parseControlArgs,
  printReport,
  waitForReadback
} = require('./lib/cloudbase-release-control');

async function main() {
  const options = parseControlArgs(process.argv.slice(2));
  const contracts = loadReleaseContracts();
  const envId = options.envId || contracts.envId;
  const expected = contracts.functions;

  assertApplyConfirmation(options, envId);
  const online = listOnlineFunctions(envId);
  const onlineNames = new Set(online.map((entry) => entry.name));
  const candidates = RETIRED_FUNCTION_NAMES.filter((name) => onlineNames.has(name));
  const unexpected = online
    .map((entry) => entry.name)
    .filter((name) => (
      !expected.some((entry) => entry.name === name)
      && !RETIRED_FUNCTION_NAMES.includes(name)
    ));
  const missingExpected = expected
    .map((entry) => entry.name)
    .filter((name) => !onlineNames.has(name));

  if (options.mode !== 'apply') {
    const mismatches = candidates.map((name) => ({
      resource: name,
      expected: 'absent',
      actual: 'present'
    }));
    printReport({
      control: 'retired-functions',
      mode: options.mode === 'check' ? 'check' : 'plan',
      status: candidates.length ? 'retirement-required' : 'already-retired',
      envId,
      resourceCount: RETIRED_FUNCTION_NAMES.length,
      changeCount: candidates.length,
      mismatches,
      retirementAllowlist: RETIRED_FUNCTION_NAMES,
      candidates,
      blockers: { missingExpected, unexpected }
    }, options.json);
    if (options.mode === 'check' && candidates.length) process.exitCode = 1;
    return;
  }

  if (missingExpected.length || unexpected.length) {
    throw new Error(
      'Refusing retirement because the online function manifest has non-retirement drift'
    );
  }
  for (const functionName of candidates) {
    deleteOnlineFunction(envId, functionName);
  }
  const readback = await waitForReadback(() => {
    const latest = listOnlineFunctions(envId);
    const mismatches = compareFunctionManifest(expected, latest);
    return { ok: mismatches.length === 0, mismatches };
  }, {
    attempts: options.readbackAttempts,
    delayMs: options.readbackDelayMs
  });
  if (!readback.ok) {
    throw new Error(
      `Function retirement readback did not converge after ${readback.attempts} attempts`
    );
  }
  printReport({
    control: 'retired-functions',
    mode: 'apply',
    status: candidates.length ? 'deleted-and-verified' : 'already-retired',
    envId,
    resourceCount: RETIRED_FUNCTION_NAMES.length,
    changeCount: candidates.length,
    mismatches: [],
    deleted: candidates,
    readbackAttempts: readback.attempts
  }, options.json);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
