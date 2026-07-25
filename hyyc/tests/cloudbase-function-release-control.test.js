const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPECTED_FUNCTION_NAMES,
  RETIRED_FUNCTION_NAMES,
  buildDeleteFunctionArgs,
  buildFunctionDetailArgs,
  buildListFunctionsArgs,
  compareFunctionConfiguration,
  compareFunctionManifest,
  deleteOnlineFunction,
  extractOnlineFunctionDetail,
  extractOnlineFunctionList,
  invokeTcbJson,
  loadReleaseContracts
} = require('../scripts/lib/cloudbase-release-control');

const ENV_ID = 'hyyc-1gi3f5sqc5becabf';

test('cloudbaserc is the exact four-function production manifest', () => {
  const contracts = loadReleaseContracts();
  assert.deepEqual(
    contracts.functions.map((entry) => entry.name).sort(),
    [...EXPECTED_FUNCTION_NAMES].sort()
  );
  assert.equal(contracts.functions.length, 4);
  const knowledgeFeed = contracts.functions.find((entry) => entry.name === 'knowledgeFeed');
  const reviewWorker = knowledgeFeed.triggers.find(
    (trigger) => trigger.name === 'knowledge-feed-profile-review-worker'
  );
  assert.equal(reviewWorker.config, '5,20,35,50 * * * * * *');
});

test('function list, detail and delete commands preserve exact targets', () => {
  assert.deepEqual(buildListFunctionsArgs(ENV_ID, 100, 100), [
    'fn', 'list', '--limit', '100', '--offset', '100', '-e', ENV_ID, '--json'
  ]);
  assert.deepEqual(buildFunctionDetailArgs(ENV_ID, 'knowledgeFeed'), [
    'fn', 'detail', 'knowledgeFeed', '-e', ENV_ID, '--json'
  ]);
  assert.deepEqual(buildDeleteFunctionArgs(ENV_ID, 'digestIngest'), [
    'fn', 'delete', 'digestIngest', '-e', ENV_ID, '--json'
  ]);
  assert.deepEqual(RETIRED_FUNCTION_NAMES, ['digestIngest', 'digestStore']);
  assert.throws(
    () => deleteOnlineFunction(ENV_ID, 'knowledgeFeed'),
    /Refusing to delete non-retired function/
  );
});

test('online manifest diff rejects both missing and extra functions', () => {
  const expected = loadReleaseContracts().functions;
  const observed = extractOnlineFunctionList({
    data: [
      { name: 'knowledgeFeed', runtime: 'Nodejs18.15', status: 'Deployment completed' },
      { name: 'knowledgeOps', runtime: 'Nodejs18.15', status: 'Deployment completed' },
      { name: 'membershipBilling', runtime: 'Nodejs18.15', status: 'Deployment completed' },
      { name: 'digestIngest', runtime: 'Nodejs18.15', status: 'Deployment completed' }
    ]
  });
  assert.deepEqual(
    compareFunctionManifest(expected, observed)
      .filter((entry) => entry.resource)
      .map((entry) => [entry.resource, entry.expected]),
    [
      ['sourcePreviewWorker', 'present'],
      ['digestIngest', 'absent']
    ]
  );
});

test('function detail extraction is a strict allowlist and cannot expose secrets or source', () => {
  const sentinel = 'MUST_NOT_APPEAR_IN_RELEASE_OUTPUT';
  const detail = extractOnlineFunctionDetail({
    data: {
      FunctionName: 'knowledgeFeed',
      Runtime: 'Nodejs18.15',
      Handler: 'index.main',
      Timeout: 300,
      MemorySize: 512,
      InstallDependency: 'TRUE',
      Description: 'safe description',
      Status: 'Active',
      AvailableStatus: 'Available',
      Environment: {
        Variables: [{ Key: 'SECRET_TOKEN', Value: sentinel }]
      },
      CodeInfo: sentinel,
      Triggers: [{
        TriggerName: 'knowledge-feed-source-sync',
        Type: 'timer',
        TriggerDesc: '{"cron":"0 * * * * * *"}',
        Enable: 1,
        BindStatus: 'on'
      }]
    }
  });
  assert.equal(JSON.stringify(detail).includes(sentinel), false);
  assert.deepEqual(Object.keys(detail).sort(), [
    'availableStatus',
    'description',
    'handler',
    'installDependency',
    'memorySize',
    'name',
    'runtime',
    'status',
    'timeout',
    'triggers'
  ]);
});

test('runtime, handler, resource config and exact triggers are compared after deploy', () => {
  const expected = loadReleaseContracts().functions
    .find((entry) => entry.name === 'membershipBilling');
  const observed = {
    ...expected,
    status: 'Active',
    availableStatus: 'Available'
  };
  assert.deepEqual(compareFunctionConfiguration(expected, observed), []);
  observed.runtime = 'Nodejs20.19';
  observed.triggers = [];
  assert.deepEqual(
    compareFunctionConfiguration(expected, observed).map((entry) => entry.field),
    ['membershipBilling.runtime', 'membershipBilling.triggers']
  );
});

test('CLI failures never copy a partial function detail payload into errors', () => {
  const sentinel = 'MUST_NOT_APPEAR_IN_ERROR';
  assert.throws(() => invokeTcbJson(['fn', 'detail', 'knowledgeFeed'], {
    launcher: { command: 'tcb-test', argsPrefix: [] },
    spawn: () => ({
      status: 1,
      stdout: JSON.stringify({
        data: { Environment: { Variables: [{ Value: sentinel }] }, CodeInfo: sentinel }
      }),
      stderr: 'request failed'
    })
  }), (error) => {
    assert.equal(error.message.includes(sentinel), false);
    assert.match(error.message, /request failed/);
    return true;
  });
});

test('function detail errors suppress both response and CLI diagnostic payloads', () => {
  const sentinel = 'MUST_NOT_APPEAR_IN_FUNCTION_DETAIL_ERROR';
  assert.throws(() => invokeTcbJson(['fn', 'detail', 'knowledgeFeed'], {
    launcher: { command: 'tcb-test', argsPrefix: [] },
    suppressFailureDetails: true,
    spawn: () => ({
      status: 1,
      stdout: sentinel,
      stderr: sentinel
    })
  }), (error) => {
    assert.equal(error.message.includes(sentinel), false);
    assert.equal(error.message, 'CloudBase CLI failed');
    return true;
  });
});
