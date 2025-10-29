// UI 小工具：toast/confirm 等
function toast(title, icon='none') { wx.showToast({ title, icon }); }
function confirm(content, title='提示') {
  return new Promise((resolve) => {
    wx.showModal({ title, content, success: (res) => resolve(!!res.confirm) });
  });
}
module.exports = { toast, confirm };

