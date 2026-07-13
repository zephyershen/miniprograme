const crypto = require('node:crypto');

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function digestIds(ownerKey, normalizedUrl) {
  const urlHash = hash(normalizedUrl);
  return {
    urlHash,
    queueId: hash(`${ownerKey}:queue:${urlHash}`),
    cardId: hash(`${ownerKey}:card:${urlHash}`)
  };
}

module.exports = {
  hash,
  digestIds
};
