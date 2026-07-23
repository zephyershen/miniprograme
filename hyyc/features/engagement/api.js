const { callCloudFunction } = require('../../services/cloud-functions.js');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retryTemporary(work) {
  try {
    return await work();
  } catch (error) {
    if (!error || error.code !== 'TEMPORARY_FAILURE') throw error;
    await wait(180);
    return work();
  }
}

function toggleLike(id, liked) {
  return retryTemporary(() => callCloudFunction('knowledgeFeed', {
    action: 'toggleLike', id, liked
  }));
}

function toggleFavorite(id, favorited) {
  return retryTemporary(() => callCloudFunction('knowledgeFeed', {
    action: 'toggleFavorite', id, favorited
  }));
}

function getComments(id) {
  return callCloudFunction('knowledgeFeed', { action: 'comments', id });
}

function addComment(id, payload) {
  const work = () => callCloudFunction('knowledgeFeed', {
    action: 'addComment', id, ...(payload || {})
  });
  return work().catch(async (error) => {
    if (!error || error.code !== 'CONTENT_REVIEW_UNAVAILABLE') throw error;
    await wait(400);
    return work();
  });
}

function deleteComment(id, commentId) {
  return retryTemporary(() => callCloudFunction('knowledgeFeed', {
    action: 'deleteComment',
    id,
    commentId
  }));
}

function reportComment(id, commentId) {
  return retryTemporary(() => callCloudFunction('knowledgeFeed', {
    action: 'reportComment',
    id,
    commentId
  }));
}

function appealComment(id, commentId) {
  return retryTemporary(() => callCloudFunction('knowledgeFeed', {
    action: 'appealComment',
    id,
    commentId
  }));
}

function restoreComment(id, commentId) {
  return retryTemporary(() => callCloudFunction('knowledgeFeed', {
    action: 'restoreComment',
    id,
    commentId
  }));
}

function getFavorites() {
  return callCloudFunction('knowledgeFeed', { action: 'favorites' });
}

module.exports = {
  toggleLike,
  toggleFavorite,
  getComments,
  addComment,
  deleteComment,
  reportComment,
  appealComment,
  restoreComment,
  getFavorites
};
