const SEVERITY_RANK = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4
});

function sortedUnique(values) {
  return [...new Set(values.map(String))].sort();
}

function sameStringSet(left, right) {
  const normalizedLeft = sortedUnique(left);
  const normalizedRight = sortedUnique(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function findingEvidence(finding, lock) {
  const via = Array.isArray(finding && finding.via) ? finding.via : [];
  const advisorySeverities = {};
  const viaPackages = [];
  let incompleteViaEntries = 0;
  for (const entry of via) {
    if (typeof entry === 'string') {
      viaPackages.push(entry);
      continue;
    }
    const source = entry && entry.source;
    if (source !== undefined && source !== null) {
      const sourceKey = String(source);
      const previousSeverity = advisorySeverities[sourceKey];
      if (
        previousSeverity === undefined
        || !(previousSeverity in SEVERITY_RANK)
        || (entry.severity in SEVERITY_RANK
          && SEVERITY_RANK[entry.severity] > SEVERITY_RANK[previousSeverity])
      ) {
        advisorySeverities[sourceKey] = entry.severity;
      }
    } else {
      incompleteViaEntries += 1;
    }
  }

  const nodePaths = sortedUnique(
    Array.isArray(finding && finding.nodes) ? finding.nodes : []
  );
  const versions = [];
  for (const node of nodePaths) {
    const locked = lock && lock.packages && lock.packages[node];
    if (locked && typeof locked.version === 'string') versions.push(locked.version);
  }
  return {
    advisories: advisorySeverities,
    advisorySources: Object.keys(advisorySeverities).sort(),
    effects: sortedUnique(Array.isArray(finding && finding.effects) ? finding.effects : []),
    incompleteViaEntries,
    nodePaths,
    viaPackages: sortedUnique(viaPackages),
    versions: sortedUnique(versions)
  };
}

function validateRiskRegister(register, now = Date.now()) {
  const failures = [];
  if (
    !register
    || register.schemaVersion !== 2
    || !register.allowedVulnerabilities
    || typeof register.allowedVulnerabilities !== 'object'
    || Array.isArray(register.allowedVulnerabilities)
    || typeof register.owner !== 'string'
    || !register.owner.trim()
  ) {
    return ['dependency risk register header is incomplete'];
  }

  const reviewedAt = Date.parse(`${register.reviewedAt}T00:00:00Z`);
  const expiry = Date.parse(`${register.expiresOn}T23:59:59Z`);
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(expiry) || reviewedAt > expiry) {
    failures.push('dependency risk register dates are invalid');
  } else if (now > expiry) {
    failures.push(`dependency risk register expired on ${register.expiresOn}`);
  }

  for (const [name, allowance] of Object.entries(register.allowedVulnerabilities)) {
    if (!allowance || typeof allowance !== 'object') {
      failures.push(`${name}: allowance must be an object`);
      continue;
    }
    if (!(allowance.maximumSeverity in SEVERITY_RANK)) {
      failures.push(`${name}: maximumSeverity is invalid`);
    }
    if (typeof allowance.reason !== 'string' || !allowance.reason.trim()) {
      failures.push(`${name}: reason is required`);
    }
    for (const field of [
      'packageRoots',
      'directPackageRoots',
      'exactVersions',
      'nodePaths',
      'effects',
      'viaPackages'
    ]) {
      if (!Array.isArray(allowance[field])) failures.push(`${name}: ${field} must be an array`);
    }
    if (!Array.isArray(allowance.packageRoots) || !allowance.packageRoots.length) {
      failures.push(`${name}: packageRoots cannot be empty`);
    }
    if (!Array.isArray(allowance.exactVersions) || !allowance.exactVersions.length) {
      failures.push(`${name}: exactVersions cannot be empty`);
    }
    if (!Array.isArray(allowance.nodePaths) || !allowance.nodePaths.length) {
      failures.push(`${name}: nodePaths cannot be empty`);
    }
    if (
      Array.isArray(allowance.directPackageRoots)
      && Array.isArray(allowance.packageRoots)
      && allowance.directPackageRoots.some((root) => !allowance.packageRoots.includes(root))
    ) {
      failures.push(`${name}: directPackageRoots must be a subset of packageRoots`);
    }
    if (!allowance.advisories || typeof allowance.advisories !== 'object'
      || Array.isArray(allowance.advisories)) {
      failures.push(`${name}: advisories must be an object`);
    } else {
      for (const [source, severity] of Object.entries(allowance.advisories)) {
        if (!/^\d+$/.test(source) || !(severity in SEVERITY_RANK)) {
          failures.push(`${name}: advisory ${source} has invalid severity`);
        }
      }
    }
    const evidenceCount = (Array.isArray(allowance.viaPackages)
      ? allowance.viaPackages.length
      : 0) + (allowance.advisories && typeof allowance.advisories === 'object'
      ? Object.keys(allowance.advisories).length
      : 0);
    if (!evidenceCount) failures.push(`${name}: reviewed evidence cannot be empty`);
  }
  return failures;
}

function reviewAuditFinding({
  name,
  finding,
  allowance,
  packageRoot,
  lock
}) {
  if (!allowance) {
    return {
      advisorySources: [],
      failures: [`${name} ${finding && finding.severity} is not reviewed`]
    };
  }

  const failures = [];
  const evidence = findingEvidence(finding, lock);
  const observedSeverity = finding && finding.severity;
  if (
    !(observedSeverity in SEVERITY_RANK)
    || !(allowance.maximumSeverity in SEVERITY_RANK)
    || SEVERITY_RANK[observedSeverity] > SEVERITY_RANK[allowance.maximumSeverity]
  ) {
    failures.push(`${name} rose to ${observedSeverity}`);
  }
  if (!allowance.packageRoots.includes(packageRoot)) {
    failures.push(`${name} is not reviewed in package root ${packageRoot}`);
  }
  const shouldBeDirect = allowance.directPackageRoots.includes(packageRoot);
  if (Boolean(finding && finding.isDirect) !== shouldBeDirect) {
    failures.push(`${name} direct-dependency scope changed in ${packageRoot}`);
  }
  if (!sameStringSet(evidence.versions, allowance.exactVersions)) {
    failures.push(
      `${name} resolved versions changed `
      + `(${evidence.versions.join(',') || 'unresolved'})`
    );
  }
  if (!sameStringSet(evidence.nodePaths, allowance.nodePaths)) {
    failures.push(`${name} lockfile node paths changed`);
  }
  if (!sameStringSet(evidence.effects, allowance.effects)) {
    failures.push(`${name} affected dependency scope changed`);
  }
  if (!sameStringSet(evidence.viaPackages, allowance.viaPackages)) {
    failures.push(`${name} dependency evidence changed`);
  }
  if (evidence.incompleteViaEntries) {
    failures.push(`${name} advisory evidence is incomplete`);
  }

  const allowedSources = Object.keys(allowance.advisories);
  if (!sameStringSet(evidence.advisorySources, allowedSources)) {
    failures.push(`${name} advisory sources changed`);
  } else {
    for (const source of evidence.advisorySources) {
      const advisorySeverity = evidence.advisories[source];
      const maximumSeverity = allowance.advisories[source];
      if (
        !(advisorySeverity in SEVERITY_RANK)
        || SEVERITY_RANK[advisorySeverity] > SEVERITY_RANK[maximumSeverity]
      ) {
        failures.push(
          `${name} advisory ${source} rose from ${maximumSeverity} to ${advisorySeverity}`
        );
      }
    }
  }

  return {
    advisorySources: evidence.advisorySources,
    failures
  };
}

function staleAllowanceFailures(allowances, seenRootsByName) {
  const failures = [];
  for (const [name, allowance] of Object.entries(allowances)) {
    const seenRoots = seenRootsByName.get(name) || new Set();
    if (!sameStringSet([...seenRoots], allowance.packageRoots)) {
      failures.push(`Stale dependency exception scope should be updated: ${name}`);
    }
  }
  return failures;
}

module.exports = {
  findingEvidence,
  reviewAuditFinding,
  staleAllowanceFailures,
  validateRiskRegister
};
