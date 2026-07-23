const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

class RetryableAuditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RetryableAuditError';
  }
}

function auditCommand(
  environment = process.env,
  platform = process.platform,
  execPath = process.execPath,
  pathExists = fs.existsSync
) {
  const npmExecPath = environment.npm_execpath;
  if (npmExecPath) {
    return {
      command: execPath,
      args: [npmExecPath, 'audit', '--omit=dev', '--json'],
      shell: false
    };
  }
  if (platform === 'win32') {
    const bundledNpmCli = path.win32.join(
      path.win32.dirname(execPath),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    );
    if (pathExists(bundledNpmCli)) {
      return {
        command: execPath,
        args: [bundledNpmCli, 'audit', '--omit=dev', '--json'],
        shell: false
      };
    }
    return {
      command: environment.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd audit --omit=dev --json'],
      shell: false
    };
  }
  return {
    command: 'npm',
    args: ['audit', '--omit=dev', '--json'],
    shell: false
  };
}

function auditResponseKeys(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return 'none';
  return Object.keys(report).sort().join(',') || 'none';
}

function auditResponseCode(report) {
  const error = report && report.error;
  const structuredCode = error && typeof error === 'object'
    ? error.code || error.statusCode
    : null;
  if (/^(?:E[A-Z0-9_]+|[45]\d\d)$/.test(String(structuredCode || ''))) {
    return String(structuredCode);
  }
  if (typeof error === 'string') {
    const match = error.match(/^(?:npm error )?(E[A-Z0-9_]+|[45]\d\d)\b/i);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

function validVulnerabilityMetadata(report) {
  const summary = report && report.metadata && report.metadata.vulnerabilities;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  const levels = ['info', 'low', 'moderate', 'high', 'critical'];
  if (!levels.every((level) => Number.isInteger(summary[level]) && summary[level] >= 0)) {
    return false;
  }
  if (!Number.isInteger(summary.total) || summary.total < 0) return false;
  return levels.reduce((total, level) => total + summary[level], 0) === summary.total
    && summary.total === Object.keys(report.vulnerabilities).length;
}

function parseAuditResult(result, label) {
  if (!result || result.error) {
    const code = result && result.error && result.error.code;
    throw new RetryableAuditError(
      `npm audit process error for ${label}${code ? ` (${code})` : ''}`
    );
  }
  if (result.signal) {
    throw new RetryableAuditError(`npm audit was interrupted for ${label} (${result.signal})`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new RetryableAuditError(
      `npm audit exited unexpectedly for ${label} (status: ${result.status})`
    );
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new RetryableAuditError(`npm audit returned non-JSON output for ${label}`);
  }
  if (
    report.auditReportVersion !== 2
    || !report.vulnerabilities
    || typeof report.vulnerabilities !== 'object'
    || Array.isArray(report.vulnerabilities)
    || !validVulnerabilityMetadata(report)
  ) {
    const responseCode = auditResponseCode(report);
    throw new RetryableAuditError(
      `npm audit returned an unsupported response for ${label} `
      + `(keys: ${auditResponseKeys(report)}${responseCode ? `; code: ${responseCode}` : ''})`
    );
  }
  return report;
}

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function npmAudit(directory, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0
    ? options.attempts
    : DEFAULT_ATTEMPTS;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const runner = options.runner || spawnSync;
  const sleep = options.sleep || defaultSleep;
  const onRetry = options.onRetry || (() => {});
  const environment = options.environment || process.env;
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const pathExists = options.pathExists || fs.existsSync;
  const label = options.label || path.basename(directory);
  const { command, args, shell } = auditCommand(
    environment,
    platform,
    execPath,
    pathExists
  );
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = runner(command, args, {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
      shell,
      env: { ...environment, npm_config_audit: 'false', npm_config_fund: 'false' }
    });
    try {
      return parseAuditResult(result, label);
    } catch (error) {
      if (!(error instanceof RetryableAuditError)) throw error;
      lastError = error;
      if (attempt === attempts) break;
      onRetry({
        attempt,
        attempts,
        label,
        reason: error.message
      });
      sleep(1_000 * (3 ** (attempt - 1)));
    }
  }

  throw new Error(
    `Dependency audit could not obtain a valid response after ${attempts} attempts: `
    + lastError.message
  );
}

module.exports = {
  DEFAULT_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  RetryableAuditError,
  auditCommand,
  npmAudit,
  parseAuditResult
};
