const fs = require('node:fs');
const path = require('node:path');

const {
  invokeTcbJson,
  waitForReadback
} = require('./cloudbase-release-control');

const DATABASE_API_VERSION = '2018-06-08';
const INDEX_MODES = Object.freeze(['plan', 'check', 'apply', 'readback']);
const DEFAULT_READBACK_ATTEMPTS = 12;
const DEFAULT_READBACK_DELAY_MS = 5000;
const TABLE_PAGE_SIZE = 100;
const MAX_TABLE_OFFSET = 10000;
const BUILT_IN_INDEX_NAMES = new Set(['_id_', '_openid_1']);

function loadDatabaseIndexContract(repositoryRoot = path.resolve(__dirname, '..', '..', '..')) {
  const cloudbaseConfig = readJson(path.join(repositoryRoot, 'cloudbaserc.json'));
  const contract = readJson(path.join(repositoryRoot, 'docs', 'cloud-database-indexes.json'));
  const envId = validateEnvId(cloudbaseConfig && cloudbaseConfig.envId);
  return {
    repositoryRoot,
    envId,
    contract: validateDatabaseIndexContract(contract)
  };
}

function validateDatabaseIndexContract(contract) {
  if (!contract
    || contract.schemaVersion !== 1
    || contract.mode !== 'additive'
    || contract.preserveUnknownIndexes !== true) {
    throw new Error(
      'Database index contract must use schemaVersion=1, mode=additive, '
        + 'and preserveUnknownIndexes=true'
    );
  }
  if (!Array.isArray(contract.indexes) || contract.indexes.length === 0) {
    throw new Error('Database index contract must declare at least one index');
  }

  const normalized = contract.indexes.map(validateExpectedIndex);
  const identifiers = normalized.map(indexIdentifier);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error('Database index contract contains duplicate collection/index names');
  }
  const sortedIdentifiers = [...identifiers].sort();
  if (JSON.stringify(sortedIdentifiers) !== JSON.stringify(identifiers)) {
    throw new Error('Database index contract entries must stay sorted by collection and name');
  }

  const signatures = new Set();
  for (const index of normalized) {
    const key = `${index.collection}/${indexSignature(index)}`;
    if (signatures.has(key)) {
      throw new Error(`Database index contract contains an equivalent duplicate: ${key}`);
    }
    signatures.add(key);
  }
  return {
    schemaVersion: 1,
    mode: 'additive',
    preserveUnknownIndexes: true,
    indexes: normalized
  };
}

function parseIndexControlArgs(argv) {
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
  if (!INDEX_MODES.includes(options.mode)) {
    throw new Error(`Mode must be one of: ${INDEX_MODES.join(', ')}`);
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

function assertIndexApplyConfirmation(options, targetEnvId) {
  if (options.mode !== 'apply') return;
  if (!options.confirmEnv || options.confirmEnv !== targetEnvId) {
    throw new Error(
      `Apply requires --confirm-env ${targetEnvId}; no CloudBase index changes were made`
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

function buildDescribeTableArgs(envId, collection) {
  const safeEnvId = validateEnvId(envId);
  return buildTcbApiArgs('DescribeTable', safeEnvId, {
    EnvId: safeEnvId,
    TableName: validateCollectionName(collection)
  });
}

function buildCreateIndexArgs(envId, expectedIndex) {
  const safeEnvId = validateEnvId(envId);
  const index = validateExpectedIndex(expectedIndex);
  return buildTcbApiArgs('UpdateTable', safeEnvId, {
    EnvId: safeEnvId,
    TableName: index.collection,
    CreateIndexes: [{
      IndexName: index.name,
      MgoKeySchema: {
        MgoIsUnique: index.unique,
        MgoIndexKeys: index.keys.map((key) => ({
          Name: key.field,
          Direction: key.direction
        }))
      }
    }]
  });
}

function buildTcbApiArgs(action, envId, body) {
  if (!['ListTables', 'DescribeTable', 'UpdateTable'].includes(action)) {
    throw new Error(`CloudBase database index action is not allowlisted: ${action}`);
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

function extractTableNames(payload) {
  const source = unwrapPayload(payload);
  const tables = Array.isArray(source && source.Tables) ? source.Tables : [];
  return tables.map((entry) => {
    const value = typeof entry === 'string'
      ? entry
      : entry && (entry.TableName || entry.Name);
    return validateCollectionName(value);
  });
}

function extractTableIndexes(payload, collection) {
  const safeCollection = validateCollectionName(collection);
  const source = unwrapPayload(payload);
  const indexes = Array.isArray(source && source.Indexes) ? source.Indexes : [];
  return indexes.map((entry) => normalizeObservedIndex(safeCollection, entry))
    .sort(compareIndexes);
}

function normalizeObservedIndex(collection, entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`CloudBase returned an invalid index for ${collection}`);
  }
  const schema = entry.MgoKeySchema || {};
  const keys = Array.isArray(entry.Keys)
    ? entry.Keys
    : Array.isArray(schema.MgoIndexKeys)
      ? schema.MgoIndexKeys
      : Array.isArray(entry.keys) ? entry.keys : [];
  return {
    collection: validateCollectionName(collection),
    name: validateObservedIndexName(entry.Name || entry.IndexName || entry.name),
    unique: entry.Unique === true || schema.MgoIsUnique === true || entry.unique === true,
    keys: keys.map((key) => ({
      field: validateIndexField(key && (key.Name || key.field)),
      direction: validateIndexDirection(key && (key.Direction || key.direction))
    }))
  };
}

function readDatabaseIndexState(envId, contract, options = {}) {
  const safeEnvId = validateEnvId(envId);
  const expected = validateDatabaseIndexContract(contract);
  const invoke = options.invoke || invokeTcbJson;
  const onlineCollections = listOnlineCollectionNames(safeEnvId, { ...options, invoke });
  const expectedCollections = [...new Set(
    expected.indexes.map((index) => index.collection)
  )].sort();
  const collections = new Map();

  for (const collection of expectedCollections) {
    if (!onlineCollections.has(collection)) {
      collections.set(collection, { exists: false, indexes: [] });
      continue;
    }
    const payload = invoke(
      buildDescribeTableArgs(safeEnvId, collection),
      indexInvokeOptions(options)
    );
    collections.set(collection, {
      exists: true,
      indexes: extractTableIndexes(payload, collection)
    });
  }
  return { envId: safeEnvId, collections };
}

function listOnlineCollectionNames(envId, options = {}) {
  const invoke = options.invoke || invokeTcbJson;
  const names = new Set();
  for (let offset = 0; offset <= MAX_TABLE_OFFSET; offset += TABLE_PAGE_SIZE) {
    const payload = invoke(
      buildListTablesArgs(envId, offset, TABLE_PAGE_SIZE),
      indexInvokeOptions(options)
    );
    const page = extractTableNames(payload);
    page.forEach((name) => names.add(name));
    if (page.length < TABLE_PAGE_SIZE) return names;
  }
  throw new Error('CloudBase collection list exceeded the safe pagination limit');
}

function compareDatabaseIndexState(contract, state) {
  const expected = validateDatabaseIndexContract(contract);
  const collections = state && state.collections instanceof Map
    ? state.collections
    : new Map();
  const expectedByCollection = groupIndexes(expected.indexes);
  const result = {
    missingCollections: [],
    missingIndexes: [],
    conflicts: [],
    equivalentAliases: [],
    satisfiedIndexes: [],
    unmanagedIndexes: []
  };

  for (const [collection, expectedIndexes] of expectedByCollection) {
    const observedState = collections.get(collection);
    if (!observedState || observedState.exists !== true) {
      result.missingCollections.push(collection);
      result.missingIndexes.push(...expectedIndexes.map(indexSummary));
      continue;
    }
    const observedIndexes = Array.isArray(observedState.indexes)
      ? observedState.indexes.map((index) => normalizeObservedIndex(collection, index))
      : [];
    const matchedNames = new Set();

    for (const expectedIndex of expectedIndexes) {
      const named = observedIndexes.find((index) => index.name === expectedIndex.name);
      if (named) {
        matchedNames.add(named.name);
        if (sameIndexDefinition(expectedIndex, named)) {
          result.satisfiedIndexes.push(indexSummary(expectedIndex));
        } else {
          result.conflicts.push({
            collection,
            name: expectedIndex.name,
            expected: indexDefinition(expectedIndex),
            actual: indexDefinition(named)
          });
        }
        continue;
      }
      const equivalent = observedIndexes.find((index) => (
        !matchedNames.has(index.name) && sameIndexDefinition(expectedIndex, index)
      ));
      if (equivalent) {
        matchedNames.add(equivalent.name);
        result.equivalentAliases.push({
          collection,
          expectedName: expectedIndex.name,
          actualName: equivalent.name
        });
        result.satisfiedIndexes.push(indexSummary(expectedIndex));
      } else {
        result.missingIndexes.push(indexSummary(expectedIndex));
      }
    }

    const expectedNames = new Set(expectedIndexes.map((index) => index.name));
    for (const observedIndex of observedIndexes) {
      if (BUILT_IN_INDEX_NAMES.has(observedIndex.name)
        || expectedNames.has(observedIndex.name)
        || matchedNames.has(observedIndex.name)) {
        continue;
      }
      result.unmanagedIndexes.push(indexSummary(observedIndex));
    }
  }

  for (const key of Object.keys(result)) {
    result[key].sort(compareIndexSummaries);
  }
  result.converged = result.missingCollections.length === 0
    && result.missingIndexes.length === 0
    && result.conflicts.length === 0;
  return result;
}

function applyMissingDatabaseIndexes(envId, comparison, options = {}) {
  const safeEnvId = validateEnvId(envId);
  if (comparison.missingCollections.length) {
    throw new Error(
      `Cannot add indexes because collections are missing: ${comparison.missingCollections.join(', ')}`
    );
  }
  if (comparison.conflicts.length) {
    throw new Error(
      'Cannot add indexes because an existing index name has a different definition'
    );
  }
  const invoke = options.invoke || invokeTcbJson;
  for (const index of comparison.missingIndexes) {
    invoke(buildCreateIndexArgs(safeEnvId, index), indexInvokeOptions(options));
  }
  return comparison.missingIndexes.length;
}

async function applyAndReadBackDatabaseIndexes(envId, contract, options = {}) {
  const initialState = readDatabaseIndexState(envId, contract, options);
  const initial = compareDatabaseIndexState(contract, initialState);
  const changeCount = applyMissingDatabaseIndexes(envId, initial, options);
  const readback = await waitForReadback(() => {
    const state = readDatabaseIndexState(envId, contract, options);
    const comparison = compareDatabaseIndexState(contract, state);
    return { ok: comparison.converged, state, comparison };
  }, {
    attempts: options.readbackAttempts || DEFAULT_READBACK_ATTEMPTS,
    delayMs: options.readbackDelayMs === undefined
      ? DEFAULT_READBACK_DELAY_MS
      : options.readbackDelayMs
  });
  return { initial, changeCount, readback };
}

function databaseIndexReport(mode, envId, contract, state, comparison) {
  const observedIndexCount = [...state.collections.values()]
    .reduce((total, entry) => total + (entry.indexes || []).length, 0);
  return {
    control: 'database-indexes',
    mode,
    status: comparison.converged ? 'converged' : 'drift',
    envId,
    requiredIndexCount: contract.indexes.length,
    observedIndexCount,
    changeCount: comparison.missingIndexes.length,
    missingCollections: comparison.missingCollections,
    missingIndexes: comparison.missingIndexes,
    conflicts: comparison.conflicts,
    equivalentAliases: comparison.equivalentAliases,
    unmanagedIndexesPreserved: comparison.unmanagedIndexes,
    ...(mode === 'readback' ? {
      observed: [...state.collections.entries()].map(([collection, entry]) => ({
        collection,
        exists: entry.exists === true,
        indexes: (entry.indexes || []).map(indexSummary)
      }))
    } : {})
  };
}

function printDatabaseIndexReport(report, asJson = false) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    `CloudBase ${report.control} ${report.mode}: ${report.status}`,
    `Environment: ${report.envId}`,
    `Required indexes: ${report.requiredIndexCount}`,
    `Observed indexes: ${report.observedIndexCount}`,
    `Indexes to add: ${report.changeCount}`
  ];
  if (report.missingCollections.length) {
    lines.push(`Missing collections: ${report.missingCollections.join(', ')}`);
  }
  if (report.missingIndexes.length) {
    lines.push('Missing indexes:');
    for (const index of report.missingIndexes) {
      lines.push(`- ${index.collection}/${index.name} ${formatKeys(index.keys)}`);
    }
  }
  if (report.conflicts.length) {
    lines.push('Conflicting index names:');
    for (const conflict of report.conflicts) {
      lines.push(`- ${conflict.collection}/${conflict.name}`);
    }
  }
  if (report.equivalentAliases.length) {
    lines.push('Equivalent aliases accepted:');
    for (const alias of report.equivalentAliases) {
      lines.push(
        `- ${alias.collection}/${alias.expectedName} satisfied by ${alias.actualName}`
      );
    }
  }
  lines.push(
    `Unmanaged indexes preserved: ${report.unmanagedIndexesPreserved.length}`
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

function validateExpectedIndex(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid expected database index');
  const index = {
    collection: validateCollectionName(entry.collection),
    name: validateExpectedIndexName(entry.name),
    unique: entry.unique === true,
    keys: Array.isArray(entry.keys) ? entry.keys.map((key) => ({
      field: validateIndexField(key && key.field),
      direction: validateIndexDirection(key && key.direction)
    })) : [],
    owner: validateMetadata(entry.owner, 'index owner'),
    reason: validateMetadata(entry.reason, 'index reason')
  };
  if (!index.keys.length) throw new Error(`${indexIdentifier(index)} must declare keys`);
  return index;
}

function sameIndexDefinition(left, right) {
  return indexSignature(left) === indexSignature(right);
}

function indexSignature(index) {
  return JSON.stringify({
    unique: index.unique === true,
    keys: index.keys.map((key) => ({
      field: key.field,
      direction: key.direction
    }))
  });
}

function indexDefinition(index) {
  return {
    unique: index.unique === true,
    keys: index.keys.map((key) => ({
      field: key.field,
      direction: key.direction
    }))
  };
}

function indexSummary(index) {
  return {
    collection: index.collection,
    name: index.name,
    unique: index.unique === true,
    keys: index.keys.map((key) => ({
      field: key.field,
      direction: key.direction
    })),
    ...(index.owner ? { owner: index.owner } : {}),
    ...(index.reason ? { reason: index.reason } : {})
  };
}

function indexIdentifier(index) {
  return `${index.collection}/${index.name}`;
}

function groupIndexes(indexes) {
  const grouped = new Map();
  for (const index of indexes) {
    if (!grouped.has(index.collection)) grouped.set(index.collection, []);
    grouped.get(index.collection).push(index);
  }
  return grouped;
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

function validateExpectedIndexName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(`Invalid managed database index name: ${name || '<empty>'}`);
  }
  return name;
}

function validateObservedIndexName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(`Invalid observed database index name: ${name || '<empty>'}`);
  }
  return name;
}

function validateIndexField(value) {
  const field = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.]{0,127}$/.test(field)
    || field.includes('..')
    || field.endsWith('.')) {
    throw new Error(`Invalid database index field: ${field || '<empty>'}`);
  }
  return field;
}

function validateIndexDirection(value) {
  const direction = String(value || '').trim();
  if (!['1', '-1', '2dsphere'].includes(direction)) {
    throw new Error(`Invalid database index direction: ${direction || '<empty>'}`);
  }
  return direction;
}

function validateMetadata(value, name) {
  const text = String(value || '').trim();
  if (!text || text.length > 240 || /[\r\n]/.test(text)) {
    throw new Error(`Invalid ${name}`);
  }
  return text;
}

function parseInteger(name, value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function compareIndexes(left, right) {
  return left.name.localeCompare(right.name);
}

function compareIndexSummaries(left, right) {
  const leftKey = `${left.collection || ''}/${left.name || left.expectedName || ''}`;
  const rightKey = `${right.collection || ''}/${right.name || right.expectedName || ''}`;
  return leftKey.localeCompare(rightKey);
}

function formatKeys(keys) {
  return keys.map((key) => `${key.field}:${key.direction}`).join(',');
}

function indexInvokeOptions(options) {
  return {
    ...options,
    // Index controls never surface raw CLI failures because providers may add
    // response fields outside the documented index metadata allowlist.
    suppressFailureDetails: true
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  BUILT_IN_INDEX_NAMES,
  DATABASE_API_VERSION,
  DEFAULT_READBACK_ATTEMPTS,
  DEFAULT_READBACK_DELAY_MS,
  INDEX_MODES,
  applyAndReadBackDatabaseIndexes,
  applyMissingDatabaseIndexes,
  assertIndexApplyConfirmation,
  buildCreateIndexArgs,
  buildDescribeTableArgs,
  buildListTablesArgs,
  compareDatabaseIndexState,
  databaseIndexReport,
  extractTableIndexes,
  extractTableNames,
  indexSignature,
  loadDatabaseIndexContract,
  parseIndexControlArgs,
  printDatabaseIndexReport,
  readDatabaseIndexState,
  sameIndexDefinition,
  validateDatabaseIndexContract
};
