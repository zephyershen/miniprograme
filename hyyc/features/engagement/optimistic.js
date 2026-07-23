const { decorateEngagement } = require('./model.js');

function optimisticLike(value = {}) {
  const current = decorateEngagement(value);
  const liked = !current.liked;
  return decorateEngagement({
    ...current,
    liked,
    likeCount: Math.max(0, current.likeCount + (liked ? 1 : -1))
  });
}

function optimisticFavorite(value = {}) {
  const current = decorateEngagement(value);
  const favorited = !current.favorited;
  return decorateEngagement({ ...current, favorited });
}

module.exports = { optimisticLike, optimisticFavorite };
