function makeCloudError(error) {
  const next = new Error(error && error.message ? error.message : '服务暂时不可用，请稍后重试');
  next.code = error && error.code ? error.code : 'TEMPORARY_FAILURE';
  return next;
}

async function callCloudFunction(name, data) {
  const response = await wx.cloud.callFunction({ name, data });
  const result = response && response.result;
  if (!result || result.ok !== true) throw makeCloudError(result && result.error);
  return result.data;
}

module.exports = { callCloudFunction };
