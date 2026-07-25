const { callCloudFunction } = require('../../services/cloud-functions.js');

function verifyViewerAccount(loginCode) {
  return callCloudFunction('membershipBilling', {
    action: 'verifyAccount',
    loginCode
  });
}

module.exports = { verifyViewerAccount };
