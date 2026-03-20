function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

const ACTIVITY_STATUS_TEXT_MAP = {
  draft: '草稿',
  scheduled: '待开抢',
  open: '开抢中',
  sold_out: '已抢完',
  finished: '已结束',
  finished_partial: '部分结束',
  offline: '已下线',
  cancelled: '已作废',
};

const PAYOUT_STATUS_TEXT_MAP = {
  none: '',
  pending: '待发放',
  processing: '发放中',
  success: '已到账',
  failed: '发放失败',
};

function getActivityStatusText(status = '') {
  return ACTIVITY_STATUS_TEXT_MAP[pickStr(status)] || '未知';
}

function getPayoutStatusText(status = '') {
  return PAYOUT_STATUS_TEXT_MAP[pickStr(status)] || '未知';
}

module.exports = {
  ACTIVITY_STATUS_TEXT_MAP,
  PAYOUT_STATUS_TEXT_MAP,
  getActivityStatusText,
  getPayoutStatusText,
};
