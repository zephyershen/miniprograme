const { getStoredUser } = require('./userIdentity');
const { markGuideSeen } = require('./guide');

function getViewerMode(user = getStoredUser()) {
  if (user && user.realname) return 'realname';
  if (user && user.id) return 'lite';
  return 'guest';
}

function goRegister() {
  markGuideSeen();
  wx.navigateTo({ url: '/pages/auth/register/index' });
}

function goRealname() {
  wx.navigateTo({ url: '/pages/auth/realname/index' });
}

function ensureRegisteredAccess(options = {}) {
  const viewerMode = getViewerMode();
  if (viewerMode !== 'guest') return true;

  const actionText = String(options.actionText || '使用这个功能').trim();
  const content = String(
    options.guestContent
    || `现在可以先浏览公开内容。想${actionText}，先用微信手机号完成轻登录即可。`
  ).trim();

  wx.showModal({
    title: String(options.title || `注册后可${actionText}`).trim(),
    content,
    confirmText: String(options.confirmText || '去注册').trim(),
    cancelText: String(options.cancelText || '稍后').trim(),
    success: (res) => {
      if (res && res.confirm) {
        goRegister();
      }
    }
  });
  return false;
}

function ensureRealnameAccess(options = {}) {
  const viewerMode = getViewerMode();
  if (viewerMode === 'realname') return true;

  const actionText = String(options.actionText || '使用这个功能').trim();
  const guestContent = String(
    options.guestContent
    || `现在可以先浏览公开内容。想${actionText}，先用微信手机号完成轻登录，再继续实名。`
  ).trim();
  const liteContent = String(
    options.liteContent
    || `你已经完成微信轻登录。完成实名后才可以${actionText}。`
  ).trim();
  const needRegister = viewerMode === 'guest';

  wx.showModal({
    title: String(options.title || (needRegister ? `注册后可${actionText}` : `实名后可${actionText}`)).trim(),
    content: needRegister ? guestContent : liteContent,
    confirmText: needRegister
      ? String(options.confirmTextGuest || '去注册').trim()
      : String(options.confirmTextLite || '去实名').trim(),
    cancelText: String(options.cancelText || '稍后').trim(),
    success: (res) => {
      if (!res || !res.confirm) return;
      if (needRegister) {
        goRegister();
        return;
      }
      goRealname();
    }
  });
  return false;
}

module.exports = {
  getViewerMode,
  goRegister,
  goRealname,
  ensureRegisteredAccess,
  ensureRealnameAccess,
};
