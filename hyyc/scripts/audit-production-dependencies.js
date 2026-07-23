const fs = require('node:fs');
const path = require('node:path');
const { npmAudit } = require('./lib/production-dependency-audit');
const {
  reviewAuditFinding,
  staleAllowanceFailures,
  validateRiskRegister
} = require('./lib/production-dependency-audit-policy');

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
const registerFailures = validateRiskRegister(register);
if (registerFailures.length) {
  throw new Error(`Dependency risk register is incomplete:\n${registerFailures.join('\n')}`);
}
const seenRootsByName = new Map();
const seenAdvisories = new Set();
const failures = [];
for (const packageRoot of packageRoots) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      failures.push(`${manifest.name}: production dependency ${name} is not pinned exactly (${version})`);
    }
  }

  const relativePackageRoot = path.relative(miniProgramRoot, packageRoot).replaceAll('\\', '/');
  const report = npmAudit(packageRoot, {
    label: relativePackageRoot,
    onRetry({ attempt, attempts, reason }) {
      console.warn(
        `Transient dependency-audit response; retrying ${relativePackageRoot} `
        + `(${attempt + 1}/${attempts}): ${reason}`
      );
    }
  });
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    const allowance = register.allowedVulnerabilities[name];
    if (!seenRootsByName.has(name)) seenRootsByName.set(name, new Set());
    seenRootsByName.get(name).add(relativePackageRoot);
    const review = reviewAuditFinding({
      name,
      finding,
      allowance,
      packageRoot: relativePackageRoot,
      lock
    });
    failures.push(...review.failures.map((failure) => `${manifest.name}: ${failure}`));
    for (const source of review.advisorySources) seenAdvisories.add(source);
  }
}

failures.push(...staleAllowanceFailures(
  register.allowedVulnerabilities,
  seenRootsByName
));
if (failures.length) throw new Error(failures.join('\n'));

console.log(
  `Audited ${packageRoots.length} production packages; `
  + `${Object.keys(register.allowedVulnerabilities).length} vulnerable packages and `
  + `${seenAdvisories.size} advisory sources remain explicitly reviewed until `
  + `${register.expiresOn}.`
);
