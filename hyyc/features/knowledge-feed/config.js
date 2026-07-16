const TIME_FILTERS = Object.freeze([
  { key: '1d', label: '24 小时' },
  { key: '3d', label: '近 3 天' },
  { key: '7d', label: '近 7 天' }
]);

const COMPANY_FILTERS = Object.freeze([
  { key: 'all', label: '全部公司' },
  { key: 'company:openai', label: 'OpenAI / ChatGPT' },
  { key: 'company:anthropic', label: 'Anthropic / Claude' },
  { key: 'company:google', label: 'Google / Gemini' },
  { key: 'company:deepseek', label: 'DeepSeek' },
  { key: 'company:qwen', label: '通义千问 Qwen' },
  { key: 'company:kimi', label: 'Kimi / 月之暗面' },
  { key: 'company:minimax', label: 'MiniMax' },
  { key: 'company:zhipu', label: '智谱 GLM' },
  { key: 'company:xai', label: 'xAI / Grok' },
  { key: 'company:meta', label: 'Meta / Llama' },
  { key: 'company:microsoft', label: 'Microsoft / Copilot' },
  { key: 'company:nvidia', label: 'NVIDIA' },
  { key: 'company:hugging-face', label: 'Hugging Face' },
  { key: 'company:cursor', label: 'Cursor' },
  { key: 'company:openrouter', label: 'OpenRouter' }
]);

const DIRECTION_FILTERS = Object.freeze([
  { key: 'all', label: '全部方向' },
  { key: 'direction:agent', label: 'Agent 智能体' },
  { key: 'direction:coding', label: 'AI 编码' },
  { key: 'direction:reasoning', label: '推理能力' },
  { key: 'direction:multimodal', label: '多模态' },
  { key: 'direction:image-gen', label: '图像生成' },
  { key: 'direction:video', label: 'AI 视频' },
  { key: 'direction:voice', label: '语音与音频' },
  { key: 'direction:embodied', label: '具身智能' },
  { key: 'direction:on-device', label: '端侧 AI' },
  { key: 'direction:open-source', label: '开源生态' },
  { key: 'direction:engineering', label: '部署工程' },
  { key: 'direction:data-training', label: '数据与训练' },
  { key: 'direction:safety', label: '安全对齐' },
  { key: 'direction:mcp', label: 'MCP 与工具调用' }
]);

const SORT_OPTIONS = Object.freeze([
  { key: 'hot', label: '热度', hint: '热度从高到低' },
  { key: 'latest', label: '最新', hint: '时间从新到旧' }
]);

const DEFAULT_FEED_FILTERS = Object.freeze({ time: '7d', company: 'all', direction: 'all' });
const DEFAULT_SORT = 'hot';
const PAGE_SIZE = 8;

module.exports = {
  TIME_FILTERS,
  COMPANY_FILTERS,
  DIRECTION_FILTERS,
  SORT_OPTIONS,
  DEFAULT_FEED_FILTERS,
  DEFAULT_SORT,
  PAGE_SIZE
};
