const { decorateEngagement } = require('./model.js');
const { optimisticLike, optimisticFavorite } = require('./optimistic.js');

const SYNC_FIELDS = Object.freeze(['liked', 'favorited']);

function responseEngagement(response) {
  return decorateEngagement(response && response.engagement ? response.engagement : response);
}

function nextChangedField(confirmed, desired) {
  return SYNC_FIELDS.find((field) => confirmed[field] !== desired[field]) || '';
}

function sameTargets(left, right) {
  return SYNC_FIELDS.every((field) => left[field] === right[field]);
}

function rollbackField(desired, confirmed, field) {
  if (field === 'liked') {
    return decorateEngagement({
      ...desired,
      liked: confirmed.liked,
      likeCount: confirmed.likeCount
    });
  }
  return decorateEngagement({
    ...desired,
    favorited: confirmed.favorited,
    favoriteCount: confirmed.favoriteCount
  });
}

function createLatestTargetSync({ read, apply, request, onError = () => {} }) {
  let confirmed = null;
  let desired = null;
  let running = false;
  let disposed = false;
  let runPromise = Promise.resolve();

  function schedule() {
    if (running || disposed) return runPromise;
    running = true;
    runPromise = (async () => {
      while (desired && !disposed) {
        const field = nextChangedField(confirmed, desired);
        if (!field) {
          apply(confirmed);
          desired = null;
          break;
        }

        const target = desired[field];
        try {
          confirmed = responseEngagement(await request(field, target));
        } catch (error) {
          if (desired && desired[field] === target) {
            desired = rollbackField(desired, confirmed, field);
            apply(desired);
            onError(error, field);
          }
        }

        if (desired && sameTargets(confirmed, desired)) {
          apply(confirmed);
          desired = null;
        }
      }
    })().finally(() => {
      running = false;
      if (desired && !disposed) schedule();
    });
    return runPromise;
  }

  function toggle(field) {
    if (!SYNC_FIELDS.includes(field) || disposed) return null;
    const current = decorateEngagement(read());
    if (!running && !desired) confirmed = current;
    desired = field === 'liked' ? optimisticLike(current) : optimisticFavorite(current);
    apply(desired);
    schedule();
    return desired;
  }

  return {
    toggleLike: () => toggle('liked'),
    toggleFavorite: () => toggle('favorited'),
    whenIdle: () => runPromise,
    isRunning: () => running,
    dispose() {
      disposed = true;
      desired = null;
    }
  };
}

module.exports = { createLatestTargetSync };
