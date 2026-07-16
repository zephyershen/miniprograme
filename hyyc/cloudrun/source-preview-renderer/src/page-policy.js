function assertRenderableResponse(response) {
  if (!response || typeof response.status !== 'function') throw new Error('NO_DOCUMENT_RESPONSE');
  const status = Number(response.status());
  if (!Number.isInteger(status) || status < 200 || status >= 400) {
    throw new Error(`UPSTREAM_HTTP_${Number.isFinite(status) ? status : 'INVALID'}`);
  }
  return response;
}

module.exports = { assertRenderableResponse };
