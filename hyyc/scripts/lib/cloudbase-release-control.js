const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DATABASE_API_VERSION = '2018-06-08';
const DATABASE_PERMISSION = 'ADMINONLY';
const DATABASE_RESOURCE_TYPE = 'collection';
const EXPECTED_FUNCTION_NAMES = Object.freeze([
  'knowledgeFeed',
  'knowledgeOps',
  'membershipBilling',
  'sourcePreviewWorker'
]);
const RETIRED_FUNCTION_NAMES = Object.freeze(['digestIngest', 'digestStore']);
const DEFAULT_READBACK_ATTEMPTS = 6;
const DEFAULT_READBACK_DELAY_MS = 5000;
const MAX_DESCRIBE_BATCH_SIZE = 20;

function loadReleaseContracts(repositoryRoot = path.resolve(__dirname, '..', '..', '..')) {
  const cloudbaseConfig = readJson(path.join(repositoryRoot, 'cloudbaserc.json'));
  const database = readJson(path.join(repositoryRoot, 'docs', 'cloud-database-rules.json'));
  const storage = readJson(path.join(repositoryRoot, 'docs', 'cloud-storage-rules.json'));
  const envId = validateEnvId(cloudbaseConfig.envId);

  validateDatabaseContract(database);
  validateStorageContract(storage);
  const functions = validateFunctionManifest(cloudbaseConfig);
  return {
    repositoryRoot,
    envId,
    database,
    storage,
    functions
  };
}

function validateDatabaseContract(contract) {
  if (!contract || contract.schemaVersion !== 1 || contract.mode !== 'adminOnly') {
    throw new Error('Database access contract must use schemaVersion=1 and mode=adminOnly');
  }
  if (!contract.rule || contract.rule.read !== false || contract.rule.write !== false) {
    throw new Error('Database access contract must deny every client read and write');
  }
  if (!Array.isArray(contract.collections) || contract.collections.length === 0) {
    throw new Error('Database access contract must declare at least one collection');
  }

  const collections = contract.collections.map(validateCollectionName);
  if (new Set(collections).size !== collections.length) {
    throw new Error('Database access contract contains duplicate collections');
  }
  const sorted = [...collections].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(collections)) {
    throw new Error('Database access contract collections must stay sorted');
  }
  return contract;
}

function validateStorageContract(contract) {
  if (!contract || typeof contract.read !== 'string' || typeof contract.write !== 'string') {
    throw new Error('Storage access contract must contain string read and write expressions');
  }
  if (!contract.read.trim() || !contract.write.trim()) {
    throw new Error('Storage access contract expressions cannot be empty');
  }
  if (canonicalizeRuleExpression(contract.write) !== 'false') {
    throw new Error('Storage access contract must block every direct client write');
  }
  return contract;
}

function validateFunctionManifest(cloudbaseConfig) {
  const functions = Array.isArray(cloudbaseConfig && cloudbaseConfig.functions)
    ? cloudbaseConfig.functions.map(extractExpectedFunctionContract)
    : [];
  const names = functions.map((entry) => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...EXPECTED_FUNCTION_NAMES].sort())) {
    throw new Error(
      `cloudbaserc.json must declare exactly: ${EXPECTED_FUNCTION_NAMES.join(', ')}`
    );
  }
  if (new Set(names).size !== names.length) {
    throw new Error('cloudbaserc.json contains duplicate function names');
  }
  return functions.sort((left, right) => left.name.localeCompare(right.name));
}

function extractExpectedFunctionContract(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Invalid function entry in cloudbaserc.json');
  }
  const name = validateFunctionName(entry.name);
  const triggers = Array.isArray(entry.triggers)
    ? entry.triggers.map((trigger) => ({
      name: validateTriggerName(trigger && trigger.name),
      type: String(trigger && trigger.type || ''),
      config: String(trigger && trigger.config || ''),
      enabled: true
    })).sort(compareByName)
    : [];
  if (new Set(triggers.map((trigger) => trigger.name)).size !== triggers.length) {
    throw new Error(`Duplicate trigger names for ${name}`);
  }
  return {
    name,
    runtime: String(entry.runtime || ''),
    handler: String(entry.handler || ''),
    timeout: positiveInteger(entry.timeout, `${name}.timeout`),
    memorySize: positiveInteger(entry.memorySize, `${name}.memorySize`),
    installDependency: entry.installDependency === true,
    description: String(entry.description || ''),
    triggers
  };
}

function parseControlArgs(argv) {
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
    const mode = args.shift();
    options.mode = mode === 'dry-run' ? 'plan' : mode;
  }
  if (!['plan', 'check', 'apply'].includes(options.mode)) {
    throw new Error('Mode must be one of: dry-run, plan, check, apply');
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
      options.readbackAttempts = parseIntegerOption(name, value, 1, 30);
    }
    if (name === '--readback-delay-ms') {
      options.readbackDelayMs = parseIntegerOption(name, value, 0, 60000);
    }
  }
  return options;
}

function assertApplyConfirmation(options, targetEnvId) {
  if (options.mode !== 'apply') return;
  if (!options.confirmEnv || options.confirmEnv !== targetEnvId) {
    throw new Error(
      `Apply requires --confirm-env ${targetEnvId}; no CloudBase changes were made`
    );
  }
}

function buildDescribeDatabaseArgs(envId, collections) {
  return [
    'api',
    'tcb',
    'DescribeResourcePermission',
    '--api-version',
    DATABASE_API_VERSION,
    '--body',
    JSON.stringify({
      EnvId: validateEnvId(envId),
      ResourceType: DATABASE_RESOURCE_TYPE,
      Resources: collections.map(validateCollectionName)
    }),
    '-e',
    envId,
    '--json'
  ];
}

function buildModifyDatabaseArgs(envId, collection) {
  return [
    'api',
    'tcb',
    'ModifyResourcePermission',
    '--api-version',
    DATABASE_API_VERSION,
    '--body',
    JSON.stringify({
      EnvId: validateEnvId(envId),
      ResourceType: DATABASE_RESOURCE_TYPE,
      Resource: validateCollectionName(collection),
      Permission: DATABASE_PERMISSION
    }),
    '-e',
    envId,
    '--json'
  ];
}

function buildGetStorageArgs(envId) {
  return ['storage', 'rules', 'get', '-e', validateEnvId(envId), '--json'];
}

function buildUpdateStorageArgs(envId, rule) {
  validateStorageContract(rule);
  return [
    'storage',
    'rules',
    'update',
    '-e',
    validateEnvId(envId),
    '--acl',
    'CUSTOM',
    '--rule',
    JSON.stringify({ read: rule.read, write: rule.write }),
    '--json'
  ];
}

function buildListFunctionsArgs(envId, offset = 0, limit = 100) {
  return [
    'fn',
    'list',
    '--limit',
    String(parseIntegerOption('function list limit', limit, 1, 100)),
    '--offset',
    String(parseIntegerOption('function list offset', offset, 0, 100000)),
    '-e',
    validateEnvId(envId),
    '--json'
  ];
}

function buildFunctionDetailArgs(envId, functionName) {
  return [
    'fn',
    'detail',
    validateFunctionName(functionName),
    '-e',
    validateEnvId(envId),
    '--json'
  ];
}

function buildDeleteFunctionArgs(envId, functionName) {
  return [
    'fn',
    'delete',
    validateFunctionName(functionName),
    '-e',
    validateEnvId(envId),
    '--json'
  ];
}

function resolveTcbLauncher(environment = process.env) {
  const explicitEntry = String(environment.TCB_CLI_ENTRY || '').trim();
  const explicitNode = String(environment.TCB_CLI_NODE || '').trim();
  if (explicitEntry) {
    if (!fs.existsSync(explicitEntry)) {
      throw new Error('TCB_CLI_ENTRY does not exist');
    }
    const nodeCommand = explicitNode || process.execPath;
    if (!fs.existsSync(nodeCommand)) {
      throw new Error('TCB_CLI_NODE does not exist');
    }
    return { command: nodeCommand, argsPrefix: [explicitEntry] };
  }

  const pathEntries = String(environment.PATH || environment.Path || '')
    .split(path.delimiter)
    .filter(Boolean);
  if (process.platform === 'win32') {
    for (const directory of pathEntries) {
      const cliEntry = path.join(directory, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');
      const nodeCommand = path.join(directory, 'node.exe');
      if (fs.existsSync(cliEntry) && fs.existsSync(nodeCommand)) {
        return { command: nodeCommand, argsPrefix: [cliEntry] };
      }
    }
  } else {
    for (const directory of pathEntries) {
      const command = path.join(directory, 'tcb');
      if (fs.existsSync(command)) return { command, argsPrefix: [] };
    }
  }

  try {
    const cliEntry = require.resolve('@cloudbase/cli/bin/tcb', {
      paths: [process.cwd(), __dirname]
    });
    return { command: process.execPath, argsPrefix: [cliEntry] };
  } catch {
    throw new Error(
      'CloudBase CLI was not found; install @cloudbase/cli or set TCB_CLI_ENTRY and TCB_CLI_NODE'
    );
  }
}

function invokeTcbJson(args, options = {}) {
  const result = invokeTcbCommand(args, options);
  return parseFirstJsonObject(result.stdout || '');
}

function invokeTcbCommand(args, options = {}) {
  const launcher = options.launcher || resolveTcbLauncher(options.environment);
  const spawn = options.spawn || spawnSync;
  const result = spawn(
    launcher.command,
    [...launcher.argsPrefix, ...args],
    {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ...(options.environment || {}),
        CI: '1',
        NO_COLOR: '1'
      }
    }
  );

  if (result.error) {
    throw new Error(`CloudBase CLI could not start: ${sanitizeCliText(result.error.message)}`);
  }
  if (result.status !== 0) {
    // stdout may contain a partial `fn detail` payload with Environment or
    // CodeInfo. Never include it in an exception or release report.
    const details = options.suppressFailureDetails
      ? ''
      : sanitizeCliText(result.stderr || '').trim();
    throw new Error(`CloudBase CLI failed${details ? `: ${details.slice(0, 2000)}` : ''}`);
  }
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function parseFirstJsonObject(output) {
  const text = String(output || '');
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('CloudBase CLI returned no JSON object');
}

function extractDatabasePermissions(payload) {
  const data = payload && payload.data ? payload.data : payload;
  const result = data && data.Data ? data.Data : data;
  const list = result && Array.isArray(result.PermissionList) ? result.PermissionList : [];
  const permissions = new Map();
  for (const entry of list) {
    if (!entry || typeof entry.Resource !== 'string') continue;
    permissions.set(entry.Resource, String(entry.Permission || '').toUpperCase());
  }
  return permissions;
}

function compareDatabasePermissions(collections, observed) {
  return collections.map(validateCollectionName).flatMap((collection) => {
    const actual = observed.get(collection) || null;
    return actual === DATABASE_PERMISSION
      ? []
      : [{ resource: collection, expected: DATABASE_PERMISSION, actual }];
  });
}

function extractStorageRules(payload) {
  const data = payload && payload.data ? payload.data : payload;
  const rule = data && data.rule ? data.rule : {};
  return {
    acl: String((data && data.acl) || '').toUpperCase(),
    read: typeof rule.read === 'string' ? rule.read : '',
    write: typeof rule.write === 'string' ? rule.write : ''
  };
}

function extractOnlineFunctionList(payload) {
  const entries = payload && Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload) ? payload : [];
  return entries.map((entry) => ({
    name: validateFunctionName(entry && (entry.name || entry.FunctionName)),
    runtime: String(entry && (entry.runtime || entry.Runtime) || ''),
    deploymentStatus: String(entry && (entry.status || entry.Status) || '')
  })).sort(compareByName);
}

function extractOnlineFunctionDetail(payload) {
  const data = payload && payload.data ? payload.data : payload;
  const triggers = Array.isArray(data && data.Triggers)
    ? data.Triggers.map((trigger) => ({
      name: validateTriggerName(trigger && trigger.TriggerName),
      type: String(trigger && trigger.Type || ''),
      config: triggerCron(trigger && trigger.TriggerDesc),
      enabled: Number(trigger && trigger.Enable) === 1
        && String(trigger && trigger.BindStatus || '').toLowerCase() !== 'off'
    })).sort(compareByName)
    : [];
  return {
    name: validateFunctionName(data && data.FunctionName),
    runtime: String(data && data.Runtime || ''),
    handler: String(data && data.Handler || ''),
    timeout: Number(data && data.Timeout) || 0,
    memorySize: Number(data && data.MemorySize) || 0,
    installDependency: normalizeBoolean(data && data.InstallDependency),
    description: String(data && data.Description || ''),
    status: String(data && data.Status || ''),
    availableStatus: String(data && data.AvailableStatus || ''),
    triggers
  };
}

function compareFunctionManifest(expected, observed) {
  const expectedByName = new Map(expected.map((entry) => [entry.name, entry]));
  const observedByName = new Map(observed.map((entry) => [entry.name, entry]));
  const mismatches = [];
  for (const name of expectedByName.keys()) {
    const actual = observedByName.get(name);
    if (!actual) {
      mismatches.push({ resource: name, expected: 'present', actual: null });
      continue;
    }
    if (actual.deploymentStatus !== 'Deployment completed') {
      mismatches.push({
        field: `${name}.deploymentStatus`,
        expected: 'Deployment completed',
        actual: actual.deploymentStatus || null
      });
    }
  }
  for (const name of observedByName.keys()) {
    if (!expectedByName.has(name)) {
      mismatches.push({ resource: name, expected: 'absent', actual: 'present' });
    }
  }
  return mismatches;
}

function compareFunctionConfiguration(expected, observed) {
  const mismatches = [];
  const fields = [
    'runtime',
    'handler',
    'timeout',
    'memorySize',
    'installDependency',
    'description'
  ];
  for (const field of fields) {
    if (!sameValue(expected[field], observed && observed[field])) {
      mismatches.push({
        field: `${expected.name}.${field}`,
        expected: expected[field],
        actual: observed ? observed[field] : null
      });
    }
  }
  if (!observed || observed.status !== 'Active') {
    mismatches.push({
      field: `${expected.name}.status`,
      expected: 'Active',
      actual: observed ? observed.status || null : null
    });
  }
  if (!observed || observed.availableStatus !== 'Available') {
    mismatches.push({
      field: `${expected.name}.availableStatus`,
      expected: 'Available',
      actual: observed ? observed.availableStatus || null : null
    });
  }
  if (!sameValue(expected.triggers, observed && observed.triggers)) {
    mismatches.push({
      field: `${expected.name}.triggers`,
      expected: expected.triggers,
      actual: observed ? observed.triggers : null
    });
  }
  return mismatches;
}

function compareStorageRules(expected, observed) {
  validateStorageContract(expected);
  const mismatches = [];
  if (observed.acl !== 'CUSTOM') {
    mismatches.push({ field: 'acl', expected: 'CUSTOM', actual: observed.acl || null });
  }
  for (const field of ['read', 'write']) {
    if (canonicalizeRuleExpression(observed[field])
      !== canonicalizeRuleExpression(expected[field])) {
      mismatches.push({
        field,
        expected: expected[field],
        actual: observed[field] || null
      });
    }
  }
  return mismatches;
}

function describeDatabasePermissions(envId, collections, options = {}) {
  const permissions = new Map();
  for (const batch of chunk(collections, MAX_DESCRIBE_BATCH_SIZE)) {
    const payload = invokeTcbJson(buildDescribeDatabaseArgs(envId, batch), options);
    for (const [resource, permission] of extractDatabasePermissions(payload)) {
      permissions.set(resource, permission);
    }
  }
  return permissions;
}

function setDatabasePermission(envId, collection, options = {}) {
  return invokeTcbJson(buildModifyDatabaseArgs(envId, collection), options);
}

function getStorageRules(envId, options = {}) {
  return extractStorageRules(invokeTcbJson(buildGetStorageArgs(envId), options));
}

function setStorageRules(envId, rule, options = {}) {
  return invokeTcbJson(buildUpdateStorageArgs(envId, rule), options);
}

function listOnlineFunctions(envId, options = {}) {
  const all = [];
  const limit = 100;
  for (let offset = 0; offset <= 100000; offset += limit) {
    const page = extractOnlineFunctionList(
      invokeTcbJson(buildListFunctionsArgs(envId, offset, limit), options)
    );
    all.push(...page);
    if (page.length < limit) return all.sort(compareByName);
  }
  throw new Error('CloudBase function list exceeded the safe pagination limit');
}

function getOnlineFunctionDetail(envId, functionName, options = {}) {
  const payload = invokeTcbJson(buildFunctionDetailArgs(envId, functionName), {
    ...options,
    suppressFailureDetails: true
  });
  return extractOnlineFunctionDetail(payload);
}

function deleteOnlineFunction(envId, functionName, options = {}) {
  if (!RETIRED_FUNCTION_NAMES.includes(functionName)) {
    throw new Error(`Refusing to delete non-retired function: ${functionName}`);
  }
  invokeTcbCommand(buildDeleteFunctionArgs(envId, functionName), options);
}

async function waitForReadback(read, options = {}) {
  const attempts = options.attempts || DEFAULT_READBACK_ATTEMPTS;
  const delayMs = options.delayMs === undefined
    ? DEFAULT_READBACK_DELAY_MS
    : options.delayMs;
  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await read();
    if (lastResult && lastResult.ok) return { ...lastResult, attempts: attempt };
    if (attempt < attempts && delayMs > 0) await delay(delayMs);
  }
  return { ...(lastResult || { ok: false }), attempts };
}

function canonicalizeRuleExpression(expression) {
  return String(expression || '').replace(/\s+/g, '');
}

function printReport(report, asJson = false) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    `CloudBase ${report.control} ${report.mode}: ${report.status}`,
    `Environment: ${report.envId}`
  ];
  if (typeof report.resourceCount === 'number') {
    lines.push(`Resources: ${report.resourceCount}`);
  }
  if (typeof report.changeCount === 'number') {
    lines.push(`Changes: ${report.changeCount}`);
  }
  if (Array.isArray(report.mismatches) && report.mismatches.length) {
    lines.push('Drift:');
    for (const mismatch of report.mismatches) {
      const target = mismatch.resource || mismatch.field;
      lines.push(
        `- ${target}: ${formatReportValue(mismatch.actual)}`
          + ` -> ${formatReportValue(mismatch.expected)}`
      );
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function validateFunctionName(value) {
  const functionName = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(functionName)) {
    throw new Error(`Invalid CloudBase function name: ${functionName || '<empty>'}`);
  }
  return functionName;
}

function validateTriggerName(value) {
  const triggerName = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(triggerName)) {
    throw new Error(`Invalid CloudBase trigger name: ${triggerName || '<empty>'}`);
  }
  return triggerName;
}

function parseIntegerOption(name, value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function sanitizeCliText(value) {
  return String(value || '')
    .replace(
      /(secret(?:id|key)?|token|authorization|password|aeskey)\s*[:=]\s*["']?[^,\s"']+/gi,
      '$1=[REDACTED]'
    )
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return '[REDACTED_URL]';
      }
    });
}

function triggerCron(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return typeof parsed.cron === 'string' ? parsed.cron : '';
  } catch {
    return '';
  }
}

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'yes'].includes(String(value || '').toLowerCase());
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareByName(left, right) {
  return String(left && left.name || '').localeCompare(String(right && right.name || ''));
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function formatReportValue(value) {
  if (value === null || value === undefined || value === '') return '<missing>';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  DATABASE_API_VERSION,
  DATABASE_PERMISSION,
  EXPECTED_FUNCTION_NAMES,
  RETIRED_FUNCTION_NAMES,
  DEFAULT_READBACK_ATTEMPTS,
  DEFAULT_READBACK_DELAY_MS,
  assertApplyConfirmation,
  buildDescribeDatabaseArgs,
  buildDeleteFunctionArgs,
  buildFunctionDetailArgs,
  buildGetStorageArgs,
  buildListFunctionsArgs,
  buildModifyDatabaseArgs,
  buildUpdateStorageArgs,
  canonicalizeRuleExpression,
  compareDatabasePermissions,
  compareFunctionConfiguration,
  compareFunctionManifest,
  compareStorageRules,
  deleteOnlineFunction,
  describeDatabasePermissions,
  extractDatabasePermissions,
  extractOnlineFunctionDetail,
  extractOnlineFunctionList,
  extractStorageRules,
  getOnlineFunctionDetail,
  getStorageRules,
  invokeTcbCommand,
  invokeTcbJson,
  loadReleaseContracts,
  listOnlineFunctions,
  parseControlArgs,
  parseFirstJsonObject,
  printReport,
  resolveTcbLauncher,
  setDatabasePermission,
  setStorageRules,
  validateDatabaseContract,
  validateFunctionManifest,
  validateStorageContract,
  waitForReadback
};
