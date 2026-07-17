function isFacetMatrix(value) {
  return Boolean(value
    && value.version === 1
    && Array.isArray(value.timeKeys)
    && Array.isArray(value.channelKeys)
    && Array.isArray(value.companyKeys)
    && Array.isArray(value.directionKeys)
    && Array.isArray(value.counts));
}

function indexOf(keys, key) {
  return keys.indexOf(typeof key === 'string' && key ? key : 'all');
}

function facetMatrixCount(matrix, channelKey, filters = {}) {
  if (!isFacetMatrix(matrix)) return null;
  const timeIndex = indexOf(matrix.timeKeys, filters.time);
  const channelIndex = indexOf(matrix.channelKeys, channelKey);
  const companyIndex = indexOf(matrix.companyKeys, filters.company);
  const directionIndex = indexOf(matrix.directionKeys, filters.direction);
  if ([timeIndex, channelIndex, companyIndex, directionIndex].some((index) => index < 0)) return 0;
  const offset = (((timeIndex * matrix.channelKeys.length + channelIndex)
    * matrix.companyKeys.length + companyIndex) * matrix.directionKeys.length) + directionIndex;
  return Math.max(0, Number(matrix.counts[offset]) || 0);
}

module.exports = { isFacetMatrix, facetMatrixCount };
