const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ATTEMPTS,
  auditCommand,
  npmAudit,
  parseAuditResult
} = require('../scripts/lib/production-dependency-audit');
const {
  findingEvidence,
  reviewAuditFinding,
  staleAllowanceFailures,
  validateRiskRegister
} = require('../scripts/lib/production-dependency-audit-policy');

function validReport(vulnerabilities = {}) {
  const counts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0
  };
  for (const finding of Object.values(vulnerabilities)) counts[finding.severity] += 1;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        ...counts,
        total: Object.keys(vulnerabilities).length
      }
    }
  };
}

function commandResult(report, status = 0) {
  return {
    error: undefined,
    signal: null,
    status,
    stdout: JSON.stringify(report),
    stderr: ''
  };
}

test('accepts npm exit code 1 when the JSON contains real vulnerability findings', () => {
  const finding = {
    severity: 'high',
    via: [],
    effects: [],
    range: '*',
    nodes: [],
    fixAvailable: false
  };
  const report = npmAudit('fixture', {
    runner: () => commandResult(validReport({ unexpected: finding }), 1),
    sleep: () => assert.fail('a valid vulnerability report must not be retried')
  });
  assert.deepEqual(report.vulnerabilities.unexpected, finding);
});

test('retries only malformed or unsupported audit-service responses', () => {
  const results = [
    { stdout: '<html>temporary gateway failure</html>', stderr: '', status: 1 },
    commandResult({ error: { code: 'E429' } }, 1),
    commandResult(validReport(), 0)
  ];
  const waits = [];
  const retries = [];
  const report = npmAudit('fixture', {
    runner: () => results.shift(),
    sleep: (milliseconds) => waits.push(milliseconds),
    onRetry: (details) => retries.push(details)
  });

  assert.deepEqual(report, validReport());
  assert.deepEqual(waits, [1_000, 3_000]);
  assert.equal(retries.length, 2);
  assert.match(retries[0].reason, /non-JSON/);
  assert.match(retries[1].reason, /unsupported response/);
});

test('fails closed when the audit service never returns a valid report', () => {
  let calls = 0;
  assert.throws(
    () => npmAudit('fixture', {
      runner() {
        calls += 1;
        return { stdout: '', stderr: '', status: 1 };
      },
      sleep: () => {}
    }),
    new RegExp(`valid response after ${DEFAULT_ATTEMPTS} attempts`)
  );
  assert.equal(calls, DEFAULT_ATTEMPTS);
});

test('rejects interrupted audit processes even if stdout looks valid', () => {
  assert.throws(
    () => parseAuditResult({
      stdout: JSON.stringify(validReport()),
      stderr: '',
      status: null,
      signal: 'SIGTERM'
    }, 'fixture'),
    /interrupted/
  );
  assert.throws(
    () => parseAuditResult({
      stdout: JSON.stringify(validReport()),
      stderr: '',
      status: 2,
      signal: null
    }, 'fixture'),
    /exited unexpectedly/
  );
});

test('rejects a truncated v2 shell without complete vulnerability totals', () => {
  assert.throws(
    () => parseAuditResult(commandResult({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: {}
    }), 'fixture'),
    /unsupported response/
  );
});

test('uses the bundled npm CLI for direct Windows audits without a command shell', () => {
  const command = auditCommand(
    {},
    'win32',
    'C:\\node\\node.exe',
    (candidate) => candidate.endsWith('node_modules\\npm\\bin\\npm-cli.js')
  );
  assert.equal(command.command, 'C:\\node\\node.exe');
  assert.equal(command.shell, false);
  assert.match(command.args[0], /npm-cli\.js$/);

  const fallback = auditCommand(
    { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    'win32',
    'C:\\node\\node.exe',
    () => false
  );
  assert.equal(fallback.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(fallback.shell, false);
  assert.deepEqual(fallback.args.slice(0, 3), ['/d', '/s', '/c']);
});

function allowance(overrides = {}) {
  return {
    maximumSeverity: 'high',
    packageRoots: ['cloudfunctions/example'],
    directPackageRoots: [],
    exactVersions: ['1.2.3'],
    nodePaths: ['node_modules/example'],
    effects: [],
    viaPackages: [],
    advisories: { 12345: 'moderate' },
    reason: 'Reviewed fixture exposure.',
    ...overrides
  };
}

function auditFinding(overrides = {}) {
  return {
    severity: 'moderate',
    via: [{ source: 12345, severity: 'moderate' }],
    nodes: ['node_modules/example'],
    effects: [],
    isDirect: false,
    ...overrides
  };
}

const fixtureLock = {
  packages: {
    'node_modules/example': { version: '1.2.3' }
  }
};

test('binds reviewed findings to the exact root, lock version, and advisory IDs', () => {
  const accepted = reviewAuditFinding({
    name: 'example',
    finding: auditFinding(),
    allowance: allowance(),
    packageRoot: 'cloudfunctions/example',
    lock: fixtureLock
  });
  assert.deepEqual(accepted.failures, []);
  assert.deepEqual(accepted.advisorySources, ['12345']);

  for (const [finding, expected] of [
    [auditFinding({
      via: [
        { source: 12345, severity: 'moderate' },
        { source: 67890, severity: 'low' }
      ]
    }), /advisory sources changed/],
    [auditFinding({
      via: [{ source: 12345, severity: 'high' }]
    }), /advisory 12345 rose/],
    [auditFinding({ severity: 'critical' }), /rose to critical/]
  ]) {
    const review = reviewAuditFinding({
      name: 'example',
      finding,
      allowance: allowance(),
      packageRoot: 'cloudfunctions/example',
      lock: fixtureLock
    });
    assert.match(review.failures.join('\n'), expected);
  }
});

test('rejects findings outside the reviewed root or resolved version', () => {
  const wrongRoot = reviewAuditFinding({
    name: 'example',
    finding: auditFinding(),
    allowance: allowance(),
    packageRoot: 'cloudfunctions/other',
    lock: fixtureLock
  });
  assert.match(wrongRoot.failures.join('\n'), /not reviewed in package root/);

  const changedLock = {
    packages: {
      'node_modules/example': { version: '1.2.4' }
    }
  };
  const wrongVersion = reviewAuditFinding({
    name: 'example',
    finding: auditFinding(),
    allowance: allowance(),
    packageRoot: 'cloudfunctions/example',
    lock: changedLock
  });
  assert.match(wrongVersion.failures.join('\n'), /resolved versions changed/);
});

test('rejects unknown packages plus direct and affected-scope changes', () => {
  const unknown = reviewAuditFinding({
    name: 'unexpected',
    finding: auditFinding(),
    allowance: undefined,
    packageRoot: 'cloudfunctions/example',
    lock: fixtureLock
  });
  assert.match(unknown.failures.join('\n'), /not reviewed/);

  const changed = reviewAuditFinding({
    name: 'example',
    finding: auditFinding({
      isDirect: true,
      effects: ['parent-package']
    }),
    allowance: allowance(),
    packageRoot: 'cloudfunctions/example',
    lock: fixtureLock
  });
  assert.match(changed.failures.join('\n'), /direct-dependency scope changed/);
  assert.match(changed.failures.join('\n'), /affected dependency scope changed/);
});

test('matches wrapper findings by their exact vulnerable dependency chain', () => {
  const evidence = findingEvidence({
    severity: 'high',
    via: ['axios', '@cloudbase/database', 'axios'],
    nodes: ['node_modules/wrapper']
  }, {
    packages: {
      'node_modules/wrapper': { version: '2.0.0' }
    }
  });
  assert.deepEqual(evidence.viaPackages, ['@cloudbase/database', 'axios']);
  assert.deepEqual(evidence.versions, ['2.0.0']);
});

test('requires complete register evidence and detects stale root scopes', () => {
  const register = {
    schemaVersion: 2,
    reviewedAt: '2026-07-23',
    expiresOn: '2026-08-06',
    owner: 'maintainer',
    allowedVulnerabilities: {
      example: allowance()
    }
  };
  assert.deepEqual(validateRiskRegister(register, Date.parse('2026-07-24T00:00:00Z')), []);
  assert.match(
    staleAllowanceFailures(register.allowedVulnerabilities, new Map()).join('\n'),
    /Stale dependency exception scope/
  );
  assert.match(
    validateRiskRegister({
      ...register,
      allowedVulnerabilities: {
        example: allowance({ advisories: {}, viaPackages: [] })
      }
    }).join('\n'),
    /evidence cannot be empty/
  );
  assert.match(
    validateRiskRegister(register, Date.parse('2026-08-07T00:00:00Z')).join('\n'),
    /expired/
  );
});
