function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

const COVER_THEME_OPTIONS = [
  { value: 'cozy_gift', label: '暖心礼盒', accent: '#E6846A', tint: '#FFF4EA', heroTitle: '晚风福袋夜', heroSubtitle: '把社区活动做得柔软一点' },
  { value: 'mint_garden', label: '薄荷花园', accent: '#4FA686', tint: '#ECFBF5', heroTitle: '花园惊喜局', heroSubtitle: '像阳台植物一样慢慢冒出好运' },
  { value: 'sunny_present', label: '晴天礼物', accent: '#D7923A', tint: '#FFF8E7', heroTitle: '晴空礼物站', heroSubtitle: '把今天的好心情折成一份小奖金' },
];

const AMOUNT_MODE_OPTIONS = [
  { value: 'equal', label: '均分奖金' },
  { value: 'weighted_template', label: '模板倍率' },
  { value: 'random_range', label: '随机区间' },
];

const DISPLAY_MODE_OPTIONS = [
  { value: 'featured_pool', label: '大奖展示' },
  { value: 'stacked_pool', label: '奖池展示' },
  { value: 'auto', label: '自动选择' },
];

const TEMPLATE_OPTIONS = [
  { value: '', label: '默认模板' },
  { value: 'double_equal', label: '双人均分' },
  { value: 'ladder', label: '阶梯递减' },
];

function getThemeMeta(theme = '') {
  const key = pickStr(theme, 'cozy_gift');
  return COVER_THEME_OPTIONS.find(item => item.value === key) || COVER_THEME_OPTIONS[0];
}

function getOptionLabel(options = [], value = '') {
  const key = pickStr(value);
  const matched = (Array.isArray(options) ? options : []).find(item => pickStr(item && item.value) === key);
  return matched ? pickStr(matched.label) : key;
}

module.exports = {
  COVER_THEME_OPTIONS,
  AMOUNT_MODE_OPTIONS,
  DISPLAY_MODE_OPTIONS,
  TEMPLATE_OPTIONS,
  getThemeMeta,
  getOptionLabel,
};
