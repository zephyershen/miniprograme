const {
  STORAGE_KEY,
  accountPartition,
  viewerAccountVerified,
  rememberViewerAccount,
  forgetViewerAccount
} = require('../account/storage.js');

// Compatibility aliases for older callers. Account ownership now lives in
// features/account; payment still repeats a fresh server-side account check.
module.exports = {
  STORAGE_KEY,
  accountPartition,
  membershipAccountVerified: viewerAccountVerified,
  rememberMembershipAccountVerification: rememberViewerAccount,
  forgetMembershipAccountVerification: forgetViewerAccount
};
