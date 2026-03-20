function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function clampNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatFenToYuan(fen = 0) {
  return (Math.round(clampNumber(fen, 0)) / 100).toFixed(2);
}

function formatFenLabel(fen = 0, prefix = '¥') {
  return `${prefix}${formatFenToYuan(fen)}`;
}

function yuanInputToFen(value = '') {
  const safe = pickStr(value).replace(/[^\d.]/g, '');
  if (!safe) return 0;
  const n = Number(safe);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function fenToYuanInput(fen = 0) {
  return formatFenToYuan(fen);
}

module.exports = {
  formatFenToYuan,
  formatFenLabel,
  yuanInputToFen,
  fenToYuanInput,
};
