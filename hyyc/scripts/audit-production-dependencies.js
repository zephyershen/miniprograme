const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const miniProgramRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(miniProgramRoot, '..');
const register = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'docs', 'dependency-risk-register.json'),
  'utf8'
));
const packageRoots = [
  path.join(miniProgramRoot, 'cloudfunctions', 'knowledgeFeed'),
  path.join(miniProgramRoot, 'cloudfunctions', 'knowledgeOps'),
  path.join(miniProgramRoot, 'cloudfunctions', 'membershipBilling'),
  path.join(miniProgramRoot, 'cloudrun', 'source-preview-renderer'),
  path.join(miniProgramRoot, 'cloudrun', 'source-preview-renderer', 'docker')
];
const severityRank = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });

function npmAudit(directory) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmExecPath
    ? [npmExecPath, 'audit', '--omit=dev', '--json']
    : ['audit', '--omit=dev', '--json'];
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Dependency audit did not return JSON for ${
      path.relative(miniProgramRoot, directory)
    }: ${String(result.stderr || result.error && result.error.message || '').slice(0, 300)}`);
  }
  if (!report || report.auditReportVersion !== 2 || !report.vulnerabilities) {
    throw new Error(`Unsupported npm audit response for ${path.relative(miniProgramRoot, directory)}`);
  }
  return report;
}

if (register.schemaVersion !== 1 || !register.allowedVulnerabilities
  || typeof register.owner !== 'string' || !register.owner.trim()) {
  throw new Error('Dependency risk register is incomplete');
}
const expiry = Date.parse(`${register.expiresOn}T23:59:59Z`);
if (!Number.isFinite(expiry) || Date.now() > expiry) {
  throw new Error(`Dependency risk register expired on ${register.expiresOn}`);
}

const seen = new Set();
const failures = [];
for (const packageRoot of packageRoots) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      failures.push(`${manifest.name}: production dependency ${name} is not pinned exactly (${version})`);
    }
  }

  const report = npmAudit(packageRoot);
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    seen.add(name);
    const allowance = register.allowedVulnerabilities[name];
    if (!allowance) {
      failures.push(`${manifest.name}: ${name} ${finding.severity} is not reviewed`);
      continue;
    }
    if (!(finding.severity in severityRank)
      || !(allowance.maximumSeverity in severityRank)
      || severityRank[finding.severity] > severityRank[allowance.maximumSeverity]) {
      failures.push(`${manifest.name}: ${name} rose to ${finding.severity}`);
    }
  }
}

for (const name of Object.keys(register.allowedVulnerabilities)) {
  if (!seen.has(name)) failures.push(`Stale dependency exception should be removed: ${name}`);
}
if (failures.length) throw new Error(failures.join('\n'));

console.log(
  `Audited ${packageRoots.length} production packages; `
  + `${seen.size} upstream CloudBase findings remain explicitly reviewed until ${register.expiresOn}.`
);
