const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

exports.main = async () => {
  const chatTemplateId = pickStr(process.env.SUBSCRIBE_CHAT_TEMPLATE_ID);
  const templates = [];

  if (chatTemplateId) {
    templates.push({
      key: 'chat',
      label: '聊天新消息提醒',
      templateId: chatTemplateId,
    });
  }

  return {
    ok: true,
    templates,
    chatEnabled: !!chatTemplateId,
  };
};
