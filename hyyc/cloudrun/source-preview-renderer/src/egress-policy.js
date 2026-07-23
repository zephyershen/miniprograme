function officialXEmbedUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === 'x.com' || hostname.endsWith('.x.com')
      || hostname === 'twitter.com' || hostname.endsWith('.twitter.com'))) return '';
    const statusId = url.pathname.match(/\/status\/(\d+)/i)?.[1] || '';
    return statusId
      ? `https://platform.twitter.com/embed/Tweet.html?id=${statusId}&dnt=true`
      : '';
  } catch (error) {
    return '';
  }
}

function shouldRetryThroughForeignProxy(error) {
  return /net::ERR_|timeout|timed out|DNS|ENOTFOUND|ECONN|EHOST|ENET|EAI_AGAIN|UPSTREAM_HTTP_(401|403|404|429|451|5\d\d)|PAGE_(ERROR|QUALITY)/i
    .test(String(error && (error.code || error.message) || error || ''));
}

const FOREIGN_PROXY_FIRST_HOSTS = Object.freeze([
  'techcrunch.com',
  'marktechpost.com',
  'artificialintelligence-news.com',
  'cacm.acm.org'
]);

const OPEN_GRAPH_FIRST_HOSTS = Object.freeze([
  'marktechpost.com'
]);

function hostnameMatches(value, hosts) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch (error) {
    return false;
  }
}

function shouldPreferForeignProxy(value) {
  return hostnameMatches(value, FOREIGN_PROXY_FIRST_HOSTS);
}

function shouldPreferOpenGraph(value) {
  return hostnameMatches(value, OPEN_GRAPH_FIRST_HOSTS);
}

function captureEgressPlan(value, foreignProxyConfigured = false) {
  const embeddedUrl = officialXEmbedUrl(value);
  if (embeddedUrl) {
    const direct = [
      { mode: 'direct', url: value, proxied: false },
      { mode: 'direct-x-embed', url: embeddedUrl, proxied: false }
    ];
    if (!foreignProxyConfigured) return direct;
    return [
      { mode: 'foreign-proxy-x-embed', url: embeddedUrl, proxied: true },
      { mode: 'foreign-proxy', url: value, proxied: true },
      { mode: 'direct-x-embed', url: embeddedUrl, proxied: false },
      { mode: 'direct', url: value, proxied: false }
    ];
  }
  if (shouldPreferOpenGraph(value)) {
    const direct = [
      { mode: 'direct-open-graph', url: value, proxied: false, captureKind: 'open-graph' },
      { mode: 'direct', url: value, proxied: false }
    ];
    if (!foreignProxyConfigured) return direct;
    return [
      { mode: 'foreign-proxy-open-graph', url: value, proxied: true, captureKind: 'open-graph' },
      { mode: 'foreign-proxy', url: value, proxied: true },
      ...direct
    ];
  }
  const directRoute = { mode: 'direct', url: value, proxied: false };
  if (!foreignProxyConfigured) return [directRoute];
  const proxyRoute = { mode: 'foreign-proxy', url: value, proxied: true };
  return shouldPreferForeignProxy(value)
    ? [proxyRoute, directRoute]
    : [directRoute, proxyRoute];
}

function captureRouteOptions(route, foreignProxyConfigured = false) {
  return {
    // With a relay available, a second direct-page quality load only delays
    // the route that can actually reach the source. Keep that direct probe
    // single-shot and reserve the bounded reload for the selected relay path.
    allowQualityReload: Boolean(route && route.proxied) || !foreignProxyConfigured
  };
}

module.exports = {
  officialXEmbedUrl,
  shouldRetryThroughForeignProxy,
  shouldPreferForeignProxy,
  shouldPreferOpenGraph,
  captureEgressPlan,
  captureRouteOptions
};
