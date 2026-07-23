function timeoutError() {
  const error = new Error('PREVIEW_FUNCTION_TIMEOUT');
  error.code = error.message;
  return error;
}

function invokeWithTimeout(cloud, functionName, data, timeoutMs) {
  let timer = null;
  return Promise.race([
    // wx-server-sdk has its own request timeout. Passing only an outer
    // Promise timeout still lets the SDK abort a healthy 10-20s browser job
    // at its much shorter default boundary.
    cloud.callFunction({ name: functionName, data, timeout: timeoutMs }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function functionPayload(response) {
  let result = response && response.result;
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch (error) {
      throw new Error('PREVIEW_FUNCTION_RESPONSE_INVALID');
    }
  }
  if (!result || result.ok !== true || !result.data) {
    throw new Error('PREVIEW_FUNCTION_RESPONSE_INVALID');
  }
  return result.data;
}

function createSourcePreviewRendererClient({ cloud, config, logger = console }) {
  const functionName = String(config.rendererFunctionName || '').trim();
  const functionEnabled = config.rendererFunctionEnabled === true;
  const allowHttpFallback = config.rendererHttpFallbackEnabled === true;
  const timeoutMs = Math.max(5000, Number(config.rendererFunctionTimeoutMs) || 88 * 1000);

  async function invoke(data) {
    if (!functionEnabled || !functionName || !cloud || typeof cloud.callFunction !== 'function') {
      return null;
    }
    try {
      return functionPayload(await invokeWithTimeout(cloud, functionName, {
        ...data,
        token: config.rendererToken
      }, timeoutMs));
    } catch (error) {
      logger.warn('CloudBase source preview worker unavailable', {
        action: data.action,
        message: error && error.message,
        fallback: allowHttpFallback
      });
      if (allowHttpFallback) return null;
      throw error;
    }
  }

  return {
    capture(payload) {
      return invoke({ action: 'capture', ...payload });
    },
    thumbnail(payload) {
      return invoke({ action: 'thumbnail', ...payload });
    }
  };
}

module.exports = {
  timeoutError,
  invokeWithTimeout,
  functionPayload,
  createSourcePreviewRendererClient
};
