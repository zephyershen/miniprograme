const fs = require('node:fs');
const path = require('node:path');

const miniProgramRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(miniProgramRoot, '..');
const contractPath = path.join(repositoryRoot, 'docs', 'runtime-environment-contract.json');
const sourceRoots = [
  path.join(miniProgramRoot, 'cloudfunctions', 'knowledgeFeed'),
  path.join(miniProgramRoot, 'cloudfunctions', 'knowledgeOps'),
  path.join(miniProgramRoot, 'cloudfunctions', 'membershipBilling'),
  path.join(miniProgramRoot, 'cloudrun', 'source-preview-renderer')
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sourceVariables() {
  const names = new Set();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /\bvalue\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g
  ];
  for (const file of sourceRoots.flatMap(walk).filter((entry) => entry.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source))) names.add(match[1]);
    }
  }
  return names;
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.schemaVersion !== 1 || !Array.isArray(contract.groups)) {
  throw new Error('Runtime environment contract has an unsupported schema');
}

const documented = new Map();
for (const group of contract.groups) {
  if (!group || typeof group.name !== 'string' || typeof group.owner !== 'string'
    || typeof group.required !== 'string' || typeof group.secret !== 'boolean'
    || !Array.isArray(group.variables)) {
    throw new Error('Every runtime environment group must declare name, owner, secret, required, and variables');
  }
  for (const name of group.variables) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid runtime environment variable name: ${name}`);
    }
    if (documented.has(name)) {
      throw new Error(`Runtime environment variable is documented twice: ${name}`);
    }
    documented.set(name, group);
  }
}

const consumed = sourceVariables();
const missing = [...consumed].filter((name) => !documented.has(name)).sort();
const stale = [...documented.keys()].filter((name) => !consumed.has(name)).sort();
if (missing.length) throw new Error(`Undocumented runtime variables: ${missing.join(', ')}`);
if (stale.length) throw new Error(`Stale runtime variables: ${stale.join(', ')}`);

for (const [name, group] of documented) {
  if (/(?:APP_KEY|PASSWORD|SECRET|TOKEN)$/.test(name) && !group.secret) {
    throw new Error(`Secret-looking variable must be in a secret group: ${name}`);
  }
}

console.log(`Checked ${consumed.size} runtime environment variables against the production contract.`);
