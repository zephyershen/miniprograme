const {
  getMessages,
  markMessageRead: requestMarkMessageRead,
  deleteMessage: requestDeleteMessage,
  markAllMessagesRead: requestMarkAllMessagesRead
} = require('./api.js');
const { normalizeMessagesResult } = require('./model.js');
const { membershipCacheScope } = require('../membership/session.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

const messagesCache = createQueryCache({ ttlMs: 30 * 1000, maxEntries: 1 });
let messageOperationChain = Promise.resolve();
let messageViewerGeneration = 0;

function currentScope() {
  return membershipCacheScope();
}

function enqueueMessageOperation(operation) {
  const running = messageOperationChain.then(operation, operation);
  messageOperationChain = running.catch(() => undefined);
  return running;
}

function viewerChangedError() {
  const error = new Error('查看账号已切换');
  error.code = 'VIEWER_CHANGED';
  return error;
}

function assertCurrentViewer(scope, generation) {
  if (generation !== messageViewerGeneration || scope !== currentScope()) {
    throw viewerChangedError();
  }
}

function loadMessages({ force = false, scope = currentScope() } = {}) {
  const generation = messageViewerGeneration;
  return enqueueMessageOperation(async () => {
    assertCurrentViewer(scope, generation);
    return messagesCache.load(scope, async () => {
      assertCurrentViewer(scope, generation);
      const result = normalizeMessagesResult(await getMessages());
      assertCurrentViewer(scope, generation);
      return result;
    }, { force });
  });
}

function markMessageRead(messageId, messageVersion) {
  const scope = currentScope();
  const generation = messageViewerGeneration;
  return enqueueMessageOperation(async () => {
    assertCurrentViewer(scope, generation);
    const result = normalizeMessagesResult(
      await requestMarkMessageRead(messageId, messageVersion)
    );
    assertCurrentViewer(scope, generation);
    return messagesCache.remember(scope, result);
  });
}

function deleteMessage(messageId) {
  const scope = currentScope();
  const generation = messageViewerGeneration;
  return enqueueMessageOperation(async () => {
    assertCurrentViewer(scope, generation);
    const result = normalizeMessagesResult(await requestDeleteMessage(messageId));
    assertCurrentViewer(scope, generation);
    return messagesCache.remember(scope, result);
  });
}

function markAllMessagesRead() {
  const scope = currentScope();
  const generation = messageViewerGeneration;
  return enqueueMessageOperation(async () => {
    assertCurrentViewer(scope, generation);
    const result = normalizeMessagesResult(await requestMarkAllMessagesRead());
    assertCurrentViewer(scope, generation);
    return messagesCache.remember(scope, result);
  });
}

function clearMessages() {
  messageViewerGeneration += 1;
  messagesCache.invalidate();
}

registerViewerCache(clearMessages);

module.exports = {
  loadMessages,
  markMessageRead,
  deleteMessage,
  markAllMessagesRead,
  clearMessages
};
