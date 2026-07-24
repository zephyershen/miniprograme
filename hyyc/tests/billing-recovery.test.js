const test = require('node:test');
const assert = require('node:assert/strict');

function installModuleMock(request, exports) {
  const filename = require.resolve(request);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports
  };
  return () => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  };
}

async function withRecovery({
  getMembershipOrderStatus,
  refreshMembershipAccess,
  forgetPendingMembershipOrder
}, run) {
  const orderId = 'MP20260724081033abababababababab';
  const restores = [
    installModuleMock('../features/billing/api', { getMembershipOrderStatus }),
    installModuleMock('../features/billing/payment', {
      pendingMembershipOrderId: () => orderId,
      forgetPendingMembershipOrder
    }),
    installModuleMock('../features/membership/session', { refreshMembershipAccess })
  ];
  const filename = require.resolve('../features/billing/recovery');
  const previous = require.cache[filename];
  delete require.cache[filename];
  try {
    await run(require(filename), orderId);
  } finally {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
    restores.reverse().forEach((restore) => restore());
  }
}

test('clears a paid pending order only after membership refresh succeeds', async () => {
  const events = [];
  await withRecovery({
    getMembershipOrderStatus: async (orderId) => ({
      order: { id: orderId, status: 'paid' }
    }),
    refreshMembershipAccess: async () => {
      events.push('refresh');
      return { viewer: { role: 'member' } };
    },
    forgetPendingMembershipOrder: () => {
      events.push('forget');
      return true;
    }
  }, async ({ recoverPendingMembershipOrder }) => {
    assert.equal((await recoverPendingMembershipOrder()).status, 'paid');
  });
  assert.deepEqual(events, ['refresh', 'forget']);
});

test('retains a paid pending order when membership refresh fails', async () => {
  let forgotten = false;
  await withRecovery({
    getMembershipOrderStatus: async (orderId) => ({
      order: { id: orderId, status: 'paid' }
    }),
    refreshMembershipAccess: async () => {
      throw new Error('temporary refresh failure');
    },
    forgetPendingMembershipOrder: () => {
      forgotten = true;
      return true;
    }
  }, async ({ recoverPendingMembershipOrder }) => {
    await assert.rejects(
      () => recoverPendingMembershipOrder(),
      /temporary refresh failure/
    );
  });
  assert.equal(forgotten, false);
});
