const HD_POSTER_FILE_PREFIX = 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/ai-column/posters-hd/v1/';

function poster(key, image, previewImage, alt) {
  return Object.freeze({ key, image, previewImage, alt });
}

function posterSet(id, title) {
  return Object.freeze([1, 2, 3].map((page) => poster(
    `${id}-${page}`,
    `/assets/ai-column/posters/${id}-${page}.jpg`,
    `${HD_POSTER_FILE_PREFIX}${id}-${page}.jpg`,
    `${title}手绘知识讲解第 ${page} 页`
  )));
}

const LESSON_POSTERS = Object.freeze({
  agent: posterSet('agent', 'Agent'),
  skill: posterSet('skill', 'Skill'),
  mcp: posterSet('mcp', 'MCP'),
  'tool-call': posterSet('tool-call', '工具调用'),
  rag: posterSet('rag', 'RAG'),
  context: posterSet('context', '上下文')
});

module.exports = { LESSON_POSTERS };
