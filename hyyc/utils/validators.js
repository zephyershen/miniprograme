// 表单校验（简单必填 + 格式）
function required(v, msg) {
  if (v === undefined || v === null || String(v).trim() === '') {
    return msg || '请填写必填项';
  }
  return '';
}

function isPhone(v) {
  if (!/^1\d{10}$/.test(String(v || ''))) return '手机号格式不正确';
  return '';
}

function isIdNumber(v) {
  // 简单校验位数
  if (!(/^(\d{15}|\d{17}[0-9Xx])$/).test(String(v || ''))) return '身份证号格式不正确';
  return '';
}

module.exports = { required, isPhone, isIdNumber };

