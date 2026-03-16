const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BUILD_TAG = 'financeCompensateTimer@2026-03-15.1';

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
  const { OPENID, APPID } = cloud.getWXContext();
  if (pickStr(OPENID) || pickStr(APPID)) {
    return {
      ok: false,
      code: 'TIMER_ONLY',
      msg: '该云函数仅允许定时触发，不对小程序端开放',
      buildTag: BUILD_TAG,
    };
  }

  const systemToken = pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);
  if (!systemToken) {
    return {
      ok: false,
      code: 'MISSING_SYSTEM_TOKEN',
      msg: '未配置 SYSTEM_COMPENSATE_TOKEN',
      buildTag: BUILD_TAG,
    };
  }

  const action = 'run_all';
  const dryRun = false;
  const limit = clampInt(process.env.FINANCE_COMPENSATE_TIMER_LIMIT, 30, 1, 200);

  console.log('[financeCompensateTimer] invoke', JSON.stringify({
    action,
    dryRun,
    limit,
    event,
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

  console.log('[financeCompensateTimer] result', JSON.stringify({
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
