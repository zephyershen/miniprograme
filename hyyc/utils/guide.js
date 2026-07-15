const GUIDE_SEEN_KEY = 'hyyc_first_use_guide_seen_v1';

function hasSeenGuide() {
  try {
    return wx.getStorageSync(GUIDE_SEEN_KEY) === true;
  } catch (err) {
    return false;
  }
}

function markGuideSeen() {
  try {
    wx.setStorageSync(GUIDE_SEEN_KEY, true);
  } catch (err) {
    // ignore
  }
}

module.exports = {
  GUIDE_SEEN_KEY,
  hasSeenGuide,
  markGuideSeen,
};
