const {
  DATABASE_API_VERSION,
  DATABASE_PERMISSION,
  invokeTcbJson,
  waitForReadback
} = require('./cloudbase-release-control');

const COLLECTION_MODES = Object.freeze(['plan', 'check', 'apply', 'readback']);
const DEFAULT_READBACK_ATTEMPTS = 6;
const DEFAULT_READBACK_DELAY_MS = 5000;
const TABLE_PAGE_SIZE = 100;
const MAX_TABLE_OFFSET = 10000;

function parseCollectionControlArgs(argv) {
  const options = {
    mode: 'plan',
    envId: '',
    confirmEnv: '',
    json: false,
    readbackAttempts: DEFAULT_READBACK_ATTEMPTS,
    readbackDelayMs: DEFAULT_READBACK_DELAY_MS
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('--')) {
    const requestedMode = args.shift();
    options.mode = requestedMode === 'dry-run' ? 'plan' : requestedMode;
  }
  if (!COLLECTION_MODES.includes(options.mode)) {
    throw new Error(`Mode must be one of: ${COLLECTION_MODES.join(', ')}`);
  }

  while (args.length) {
    const name = args.shift();
    if (name === '--json') {
      options.json = true;
      continue;
    }
    if (![
      '--env',
      '--confirm-env',
      '--readback-attempts',
      '--readback-delay-ms'
    ].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    if (!args.length || args[0].startsWith('--')) {
      throw new Error(`Missing value for ${name}`);
    }
    const value = args.shift();
    if (name === '--env') options.envId = validateEnvId(value);
    if (name === '--confirm-env') options.confirmEnv = validateEnvId(value);
    if (name === '--readback-attempts') {
      options.readbackAttempts = parseInteger(name, value, 1, 30);
    }
    if (name === '--readback-delay-ms') {
      options.readbackDelayMs = parseInteger(name, value, 0, 60000);
    }
  }
  return options;
}

function assertCollectionApplyConfirmation(options, targetEnvId) {
  if (options.mode !== 'apply') return;
  if (!options.confirmEnv || options.confirmEnv !== targetEnvId) {
    throw new Error(
      `Apply requires --confirm-env ${targetEnvId}; no CloudBase collection changes were made`
    );
  }
}

function buildListTablesArgs(envId, offset = 0, limit = TABLE_PAGE_SIZE) {
  const safeEnvId = validateEnvId(envId);
  return buildTcbApiArgs('ListTables', safeEnvId, {
    EnvId: safeEnvId,
    MgoOffset: parseInteger('table offset', offset, 0, MAX_TABLE_OFFSET),
    MgoLimit: parseInteger('table limit', limit, 1, TABLE_PAGE_SIZE)
  });
}

function buildCreateTableArgs(envId, collection) {
  const safeEnvId = validateEnvId(envId);
  return buildTcbApiArgs('CreateTable', safeEnvId, {
    EnvId: safeEnvId,
    TableName: validateCollectionName(collection),
    PermissionInfo: {
      AclTag: DATABASE_PERMISSION,
      EnvId: safeEnvId
    }
  });
}

function buildTcbApiArgs(action, envId, body) {
  if (!['ListTables', 'CreateTable'].includes(action)) {
    throw new Error(`CloudBase database collection action is not allowlisted: ${action}`);
  }
  return [
    'api',
    'tcb',
    action,
    '--api-version',
    DATABASE_API_VERSION,
    '--body',
    JSON.stringify(body),
    '-e',
    envId,
    '--json'
  ];
}

function extractCollectionNames(payload) {
  const source = unwrapPayload(payload);
  const tables = Array.isArray(source && source.Tables) ? source.Tables : [];
  return tables.map((entry) => {
    const value = typeof entry === 'string'
      ? entry
      : entry && (entry.TableName || entry.Name);
    return validateObservedCollectionName(value);
  }).sort();
}

function readDatabaseCollectionState(envId, expectedCollections, options = {}) {
  const safeEnvId = validateEnvId(envId);
  validateExpectedCollections(expectedCollections);
  const invoke = options.invoke || invokeTcbJson;
  const onlineCollections = new Set();

  for (let offset = 0; offset <= MAX_TABLE_OFFSET; offset += TABLE_PAGE_SIZE) {
    const payload = invoke(
      buildListTablesArgs(safeEnvId, offset, TABLE_PAGE_SIZE),
      collectionInvokeOptions(options)
    );
    const page = extractCollectionNames(payload);
    page.forEach((collection) => onlineCollections.add(collection));
    if (page.length < TABLE_PAGE_SIZE) {
      return { onlineCollections };
    }
  }
  throw new Error('CloudBase collection list exceeded the safe pagination limit');
}

function compareDatabaseCollectionState(expectedCollections, state) {
  const expected = validateExpectedCollections(expectedCollections);
  const online = state && state.onlineCollections instanceof Set
    ? state.onlineCollections
    : new Set();
  const expectedSet = new Set(expected);
  const presentCollections = expected.filter((collection) => online.has(collection));
  const missingCollections = expected.filter((collection) => !online.has(collection));
  return {
    presentCollections,
    missingCollections,
    unmanagedCollectionCount: [...online]
      .filter((collection) => !expectedSet.has(collection))
      .length,
    converged: missingCollections.length === 0
  };
}

function applyMissingDatabaseCollections(
  envId,
  expectedCollections,
  comparison,
  options = {}
) {
  const safeEnvId = validateEnvId(envId);
  const expected = new Set(validateExpectedCollections(expectedCollections));
  const missing = validateMissingCollections(comparison && comparison.missingCollections);
  const invoke = options.invoke || invokeTcbJson;

  for (const collection of missing) {
    if (!expected.has(collection)) {
      throw new Error(`Refusing to create a collection outside the contract: ${collection}`);
    }
  }

  for (const collection of missing) {
    try {
      invoke(
        buildCreateTableArgs(safeEnvId, collection),
        collectionInvokeOptions(options)
      );
    } catch {
      // A concurrent release may have created the same collection after the
      // full preflight. Accept that race only after a fresh allowlisted read.
      const racedState = readDatabaseCollectionState(
        safeEnvId,
        [...expected].sort(),
        options
      );
      if (!racedState.onlineCollections.has(collection)) {
        throw new Error(`CloudBase collection creation failed for ${collection}`);
      }
    }
  }
  return missing.length;
}

async function applyAndReadBackDatabaseCollections(
  envId,
  expectedCollections,
  options = {}
) {
  const expected = validateExpectedCollections(expectedCollections);
  const initialState = readDatabaseCollectionState(envId, expected, options);
  const initial = compareDatabaseCollectionState(expected, initialState);
  const changeCount = applyMissingDatabaseCollections(
    envId,
    expected,
    initial,
    options
  );
  const readback = await waitForReadback(() => {
    const state = readDatabaseCollectionState(envId, expected, options);
    const comparison = compareDatabaseCollectionState(expected, state);
    return { ok: comparison.converged, state, comparison };
  }, {
    attempts: options.readbackAttempts || DEFAULT_READBACK_ATTEMPTS,
    delayMs: options.readbackDelayMs === undefined
      ? DEFAULT_READBACK_DELAY_MS
      : options.readbackDelayMs
  });
  return { initial, changeCount, readback };
}

function databaseCollectionReport(mode, envId, expectedCollections, state, comparison) {
  const expected = validateExpectedCollections(expectedCollections);
  return {
    control: 'database-collections',
    mode,
    status: comparison.converged ? 'converged' : 'drift',
    envId,
    requiredCollectionCount: expected.length,
    observedRequiredCollectionCount: comparison.presentCollections.length,
    changeCount: comparison.missingCollections.length,
    missingCollections: comparison.missingCollections,
    unmanagedCollectionsPreserved: comparison.unmanagedCollectionCount,
    ...(mode === 'readback' ? {
      collections: expected.map((collection) => ({
        collection,
        exists: state.onlineCollections.has(collection)
      }))
    } : {})
  };
}

function printDatabaseCollectionReport(report, asJson = false) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    `CloudBase ${report.control} ${report.mode}: ${report.status}`,
    `Environment: ${report.envId}`,
    `Required collections: ${report.requiredCollectionCount}`,
    `Observed required collections: ${report.observedRequiredCollectionCount}`,
    `Collections to create: ${report.changeCount}`
  ];
  if (report.missingCollections.length) {
    lines.push('Missing collections:');
    report.missingCollections.forEach((collection) => lines.push(`- ${collection}`));
  }
  lines.push(`Unmanaged collections preserved: ${report.unmanagedCollectionsPreserved}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function validateExpectedCollections(collections) {
  if (!Array.isArray(collections) || collections.length === 0) {
    throw new Error('Database collection contract must declare at least one collection');
  }
  const normalized = collections.map(validateCollectionName);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Database collection contract contains duplicates');
  }
  const sorted = [...normalized].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(normalized)) {
    throw new Error('Database collection contract must stay sorted');
  }
  return normalized;
}

function validateMissingCollections(collections) {
  if (!Array.isArray(collections)) {
    throw new Error('Database collection comparison is invalid');
  }
  const normalized = collections.map(validateCollectionName);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Database collection comparison contains duplicates');
  }
  return normalized;
}

function unwrapPayload(payload) {
  const data = payload && payload.data ? payload.data : payload;
  return data && data.Data ? data.Data : data;
}

function validateEnvId(value) {
  const envId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(envId)) {
    throw new Error('Invalid CloudBase environment id');
  }
  return envId;
}

function validateCollectionName(value) {
  const collection = String(value || '').trim();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(collection)) {
    throw new Error(`Invalid CloudBase collection name: ${collection || '<empty>'}`);
  }
  return collection;
}

function validateObservedCollectionName(value) {
  const collection = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(collection)) {
    throw new Error('Invalid observed CloudBase collection name');
  }
  return collection;
}

function parseInteger(name, value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function collectionInvokeOptions(options) {
  return {
    ...options,
    // ListTables/CreateTable reports are schema allowlisted; never surface a
    // provider's raw CLI failure payload.
    suppressFailureDetails: true
  };
}

module.exports = {
  applyAndReadBackDatabaseCollections,
  applyMissingDatabaseCollections,
  assertCollectionApplyConfirmation,
  buildCreateTableArgs,
  buildListTablesArgs,
  compareDatabaseCollectionState,
  databaseCollectionReport,
  extractCollectionNames,
  parseCollectionControlArgs,
  printDatabaseCollectionReport,
  readDatabaseCollectionState
};
