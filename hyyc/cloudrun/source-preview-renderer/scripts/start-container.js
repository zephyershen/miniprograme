const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const dockerModules = path.resolve(__dirname, '..', 'docker', 'node_modules');
if (!fs.existsSync(dockerModules)) {
  throw new Error('CONTAINER_DEPENDENCIES_MISSING: run "npm ci --prefix docker"');
}
process.env.NODE_PATH = [
  dockerModules,
  process.env.NODE_PATH || ''
].filter(Boolean).join(path.delimiter);
Module._initPaths();

require('../src/server.js');
