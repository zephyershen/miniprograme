const test = require('node:test');
const assert = require('node:assert/strict');
const { inferTopicKeys } = require('../cloudfunctions/knowledgeFeed/lib/topics');

test('classifies company and technical direction topics from public news fields', () => {
  const keys = inferTopicKeys({
    title: 'OpenAI 发布 Codex Agent 更新',
    summary: '新的 AI 编码智能体支持 MCP 工具调用和安全沙箱。'
  });
  assert.equal(keys.includes('company:openai'), true);
  assert.equal(keys.includes('direction:agent'), true);
  assert.equal(keys.includes('direction:coding'), true);
  assert.equal(keys.includes('direction:mcp'), true);
  assert.equal(keys.includes('direction:safety'), true);
});

test('does not invent unrelated company topics', () => {
  const keys = inferTopicKeys({ title: '开源语音模型发布', summary: '支持本地运行。' });
  assert.equal(keys.includes('direction:voice'), true);
  assert.equal(keys.includes('direction:on-device'), true);
  assert.equal(keys.some((key) => key.startsWith('company:')), false);
});
