// 前端复用：图片审核相关方法
// 目标：页面里不要到处散落 callFunction 细节，后面别的业务也能复用。

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * 启动图片审核（异步回调）。
 * @param {Object} opt
 * @param {string} opt.bizType 业务类型：goods / tasks（后续可扩展）
 * @param {string} opt.bizId   业务数据 id（如 goodsId）
 * @param {string[]} opt.images 云存储 fileID 列表
 */
function startImageAudit(opt = {}) {
  const bizType = pickStr(opt.bizType);
  const bizId = pickStr(opt.bizId);
  const images = Array.isArray(opt.images) ? opt.images.filter(Boolean) : [];

  if (!bizType || !bizId || !images.length) {
    return Promise.reject(new Error('参数不完整'));
  }

  return wx.cloud.callFunction({
    name: 'imageAuditStart',
    data: { bizType, bizId, images }
  }).then((res) => {
    const r = (res && res.result) ? res.result : null;
    if (!r || r.ok !== true) {
      // 把云函数返回的更具体原因拼到括号里，方便定位问题（例如：缺少环境变量 / 权限不足）
      const msg = (r && r.msg) ? r.msg : '启动审核失败';
      const code = (r && r.code) ? String(r.code) : '';
      const errMsg = (r && r.errMsg) ? String(r.errMsg) : '';
      const detail = errMsg || code;
      const e = new Error(detail ? `${msg}（${detail}）` : msg);
      e.code = code;
      e.detail = errMsg;
      e.raw = r;
      return Promise.reject(e);
    }
    return r;
  });
}

module.exports = { startImageAudit };
