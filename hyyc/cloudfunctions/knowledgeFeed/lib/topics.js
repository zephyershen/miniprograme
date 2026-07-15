const TOPIC_RULES = Object.freeze([
  { key: 'company:openai', pattern: /\bopenai\b|chatgpt|\bgpt[-\s]?\d|\bsora\b|\bcodex\b/i },
  { key: 'company:anthropic', pattern: /anthropic|claude/i },
  { key: 'company:google', pattern: /google|deepmind|gemini|\bveo\b/i },
  { key: 'company:deepseek', pattern: /deepseek|深度求索/i },
  { key: 'company:qwen', pattern: /\bqwen\b|通义|千问/i },
  { key: 'company:kimi', pattern: /\bkimi\b|月之暗面|moonshot/i },
  { key: 'company:minimax', pattern: /minimax/i },
  { key: 'company:zhipu', pattern: /智谱|\bglm[-\s]?\d/i },
  { key: 'company:xai', pattern: /\bxai\b|\bgrok\b/i },
  { key: 'company:meta', pattern: /\bmeta\b|\bllama\b/i },
  { key: 'company:microsoft', pattern: /microsoft|微软|copilot|azure\s*ai/i },
  { key: 'company:nvidia', pattern: /nvidia|英伟达/i },
  { key: 'company:hugging-face', pattern: /hugging\s*face/i },
  { key: 'company:cursor', pattern: /\bcursor\b/i },
  { key: 'company:openrouter', pattern: /openrouter/i },
  { key: 'direction:agent', pattern: /\bagents?\b|agentic|智能体|自主规划/i },
  { key: 'direction:coding', pattern: /编程|编码|代码|coding|developer|\bide\b|vibe\s*coding|codex|claude\s*code|cursor/i },
  { key: 'direction:reasoning', pattern: /推理|reasoning|思维链|chain.of.thought|数学|逻辑基准/i },
  { key: 'direction:multimodal', pattern: /多模态|multimodal|视觉理解|vision.language/i },
  { key: 'direction:image-gen', pattern: /图像生成|文生图|image\s*generation|diffusion|图像编辑/i },
  { key: 'direction:video', pattern: /视频生成|文生视频|ai\s*视频|video\s*generation|\bsora\b|\bveo\b/i },
  { key: 'direction:voice', pattern: /语音|音频|音乐生成|speech|voice|audio/i },
  { key: 'direction:embodied', pattern: /具身|机器人|robotics?|humanoid/i },
  { key: 'direction:on-device', pattern: /端侧|本地运行|边缘设备|on.device|edge\s*ai|小模型/i },
  { key: 'direction:open-source', pattern: /开源|open.source|开放权重|模型权重/i },
  { key: 'direction:engineering', pattern: /部署|推理优化|显存|serving|inference|基础设施|数据中心|算力/i },
  { key: 'direction:data-training', pattern: /训练|training|数据集|dataset|预训练|后训练|合成数据/i },
  { key: 'direction:safety', pattern: /安全|对齐|越狱|漏洞|攻击|风险|safety|alignment|jailbreak/i },
  { key: 'direction:mcp', pattern: /\bmcp\b|function\s*calling|tool\s*calling|工具调用/i }
]);

function inferTopicKeys(item = {}) {
  const text = [item.title, item.titleEn, item.summary, item.source]
    .filter(Boolean)
    .join(' ');
  return TOPIC_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.key);
}

module.exports = { TOPIC_RULES, inferTopicKeys };
