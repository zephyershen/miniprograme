const fs = require('node:fs');
const path = require('node:path');

const {
  loadDatabaseIndexContract
} = require('./lib/cloudbase-database-index-control');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const { contract } = loadDatabaseIndexContract(repositoryRoot);
const databaseRules = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'docs', 'cloud-database-rules.json'),
  'utf8'
));
const adminOnlyCollections = new Set(databaseRules.collections || []);
const undeclaredCollections = [...new Set(contract.indexes
  .map((index) => index.collection)
  .filter((collection) => !adminOnlyCollections.has(collection)))].sort();

if (undeclaredCollections.length) {
  throw new Error(
    `Database index contract references non-admin collections: ${undeclaredCollections.join(', ')}`
  );
}

const owners = new Set(contract.indexes.map((index) => index.owner));
console.log(
  `Checked ${contract.indexes.length} additive database indexes `
    + `across ${owners.size} query owners.`
);
