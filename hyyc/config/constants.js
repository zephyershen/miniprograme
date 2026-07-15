const CLOUD_ENV_ID = 'hyyc-1gi3f5sqc5becabf';

const LIMITS = Object.freeze({
  queue: 5,
  cards: 20,
  monthlyAiCny: 10
});

// 只有已在微信公众平台完成业务域名校验的来源才能加入此清单。
const DIRECT_WEBVIEW_HOSTS = Object.freeze([]);

const TOPICS = Object.freeze([
  { key: 'dev_efficiency', label: '开发效率' },
  { key: 'daily_life', label: '日常生活' },
  { key: 'english_reading', label: '英语阅读' },
  { key: 'side_project', label: '个人副业' },
  { key: 'learning_growth', label: '学习成长' }
]);

module.exports = {
  CLOUD_ENV_ID,
  DIRECT_WEBVIEW_HOSTS,
  LIMITS,
  TOPICS
};
