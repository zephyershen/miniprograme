const crypto = require('node:crypto');

function visualVersion(url) {
  return crypto
    .createHash('sha256')
    .update(String(url || ''))
    .digest('hex')
    .slice(0, 12);
}

function visualPathStem(item) {
  return `${item.id}-${visualVersion(item.url)}`;
}

function visualGenerationId() {
  return crypto.randomBytes(6).toString('hex');
}

function visualRevisionStem(item, generationId = visualGenerationId()) {
  if (!/^[a-f0-9]{12}$/i.test(generationId)) throw new Error('INVALID_VISUAL_GENERATION');
  return `${visualPathStem(item)}-${generationId.toLowerCase()}`;
}

module.exports = {
  visualVersion,
  visualPathStem,
  visualGenerationId,
  visualRevisionStem
};
