function guardedWebSocketUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'wss:') return '';
    parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

async function isAllowedBrowserRequest(guard, url) {
  try {
    return await guard.allowBrowserRequest(url) === true;
  } catch (error) {
    return false;
  }
}

async function installGuardedContextRoutes(context, guard) {
  if (!context
    || typeof context.route !== 'function'
    || typeof context.routeWebSocket !== 'function'
    || !guard
    || typeof guard.allowBrowserRequest !== 'function') {
    throw new Error('BROWSER_NETWORK_GUARD_REQUIRED');
  }

  await context.route('**/*', async (route) => {
    const allowed = await isAllowedBrowserRequest(guard, route.request().url());
    if (allowed) await route.continue();
    else await route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', async (webSocket) => {
    const guardedUrl = guardedWebSocketUrl(webSocket.url());
    const allowed = guardedUrl
      ? await isAllowedBrowserRequest(guard, guardedUrl)
      : false;
    if (!allowed) {
      await webSocket.close({ code: 1008, reason: 'destination blocked' });
      return;
    }
    webSocket.connectToServer();
  });
}

module.exports = {
  guardedWebSocketUrl,
  installGuardedContextRoutes
};
