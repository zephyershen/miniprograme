// 简单格式化：金额、日期等
function formatMoney(n) {
  const num = Number(n || 0);
  return num.toFixed(2);
}

function formatDate(ts) {
  const d = new Date(ts);
  const mm = `${d.getMonth()+1}`.padStart(2,'0');
  const dd = `${d.getDate()}`.padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

module.exports = { formatMoney, formatDate };

