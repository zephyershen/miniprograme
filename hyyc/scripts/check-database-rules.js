const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const contractPath = path.join(repositoryRoot, 'docs', 'cloud-database-rules.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function collectCollectionNames(value, key = '', names = new Set()) {
  if (!value || typeof value !== 'object') return names;
  for (const [childKey, childValue] of Object.entries(value)) {
    if (typeof childValue === 'string'
      && /collectionName$/i.test(childKey)
      && /^knowledge_[a-z0-9_]+$/.test(childValue)) {
      names.add(childValue);
    } else if (childValue && typeof childValue === 'object') {
      collectCollectionNames(childValue, childKey, names);
    }
  }
  return names;
}

const feedConfig = require('../cloudfunctions/knowledgeFeed/config');
const billingConfig = require('../cloudfunctions/membershipBilling/config');
const configured = collectCollectionNames(feedConfig);
Object.values(billingConfig.COLLECTIONS || {}).forEach((name) => configured.add(name));

const declared = new Set(Array.isArray(contract.collections) ? contract.collections : []);
const missing = [...configured].filter((name) => !declared.has(name)).sort();
const obsolete = [...declared].filter((name) => !configured.has(name)).sort();

if (contract.schemaVersion !== 1
  || contract.mode !== 'adminOnly'
  || !contract.rule
  || contract.rule.read !== false
  || contract.rule.write !== false) {
  throw new Error('Cloud database contract must deny every client read and write');
}
if (declared.size !== contract.collections.length) {
  throw new Error('Cloud database contract contains duplicate collections');
}
if (missing.length || obsolete.length) {
  throw new Error(
    `Cloud database contract mismatch; missing=[${missing.join(', ')}], obsolete=[${obsolete.join(', ')}]`
  );
}

console.log(`Checked admin-only database rules for ${declared.size} collections.`);
