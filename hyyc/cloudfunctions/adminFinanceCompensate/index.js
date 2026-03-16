const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BUILD_TAG = 'adminFinanceCompensate@2026-03-15.1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'adminhyyc';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hyyc2026';
const ALLOWED_ACTIONS = [
  'run_all',
  'repair_wallet_docs',
  'release_expired_goods_locks',
  'sync_task_refunds',
  'sync_withdraws',
  'retry_delay_confirms',
  'repair_missing_ledgers',
];

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function clampInt(v, fallback = 30, min = 1, max = 200) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

exports.main = async (event = {}) => {
  const username = pickStr(event.username);
  const password = pickStr(event.password);
  const action = pickStr(event.action, 'run_all');
  const dryRun = event.dryRun === true;
  const limit = clampInt(event.limit, 30, 1, 200);
  const systemToken = pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return { ok: false, code: 'AUTH_FAIL', msg: '管理员认证失败', buildTag: BUILD_TAG };
  }
  if (!ALLOWED_ACTIONS.includes(action)) {
    return { ok: false, code: 'UNSUPPORTED_ACTION', msg: `unsupported_action: ${action}`, buildTag: BUILD_TAG };
  }
  if (!systemToken) {
    return { ok: false, code: 'MISSING_SYSTEM_TOKEN', msg: '未配置 SYSTEM_COMPENSATE_TOKEN', buildTag: BUILD_TAG };
  }

  console.log('[adminFinanceCompensate] invoke', JSON.stringify({
    action,
    dryRun,
    limit,
    buildTag: BUILD_TAG,
  }));

  const ret = await cloud.callFunction({
    name: 'financeCompensate',
    data: {
      action,
      dryRun,
      limit,
      compensateToken: systemToken,
    },
  });
  const result = (ret && ret.result) || ret || null;

  console.log('[adminFinanceCompensate] result', JSON.stringify({
    action,
    dryRun,
    limit,
    ok: !!(result && result.ok),
    buildTag: BUILD_TAG,
    result,
  }));

  return {
    ok: !!(result && result.ok),
    action,
    dryRun,
    limit,
    buildTag: BUILD_TAG,
    financeResult: result,
  };
};
