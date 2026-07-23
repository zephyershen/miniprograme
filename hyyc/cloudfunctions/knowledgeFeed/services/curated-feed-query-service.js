const { requireFeature } = require('./feed-entitlement-service');

function createCuratedFeedQueryService({ itemFeedQueryService, liveEnabled = true }) {
  async function getFeed(input = {}, entitlement) {
    requireFeature(entitlement, 'curated_feed', '精选资讯为 Pro 会员权益');
    if (!liveEnabled) {
      return {
        status: 'pending',
        viewer: entitlement.viewer,
        entitlements: entitlement.entitlements,
        features: entitlement.features,
        access: entitlement.access,
        totalAvailable: 0,
        resultCount: 0,
        hasMore: false,
        nextCursor: '',
        items: []
      };
    }
    const feed = await itemFeedQueryService.getFeed({
      ...input,
      mode: 'curated',
      sort: input.sort === 'latest' ? 'latest' : 'importance'
    }, entitlement);
    return feed;
  }

  return { getFeed };
}

module.exports = { createCuratedFeedQueryService };
