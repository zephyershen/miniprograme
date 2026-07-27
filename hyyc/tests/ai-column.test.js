const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  COLUMN_SECTIONS,
  COLUMN_LESSONS,
  COLUMN_PRACTICALS
} = require('../features/ai-column/catalog');
const {
  COLUMN_READER_CONTRACT_VERSION,
  sectionTabs,
  previewColumnHome,
  normalizeColumnHome,
  hasReadableColumnContract,
  posterLoadWindow,
  posterPreviewUrls,
  normalizeLessonDetail,
  normalizePracticalDetail,
  normalizeReader
} = require('../features/ai-column/model');
const {
  getColumnHome,
  getColumnLesson,
  getColumnPractical
} = require('../features/ai-column/api');

test('publishes title-only fallback catalogs for two plain-language learning sections', () => {
  assert.deepEqual(COLUMN_SECTIONS.map(({ key, label }) => ({ key, label })), [
    { key: 'courses', label: '基础课' },
    { key: 'practicals', label: '动手课' }
  ]);
  assert.equal(COLUMN_LESSONS.length, 24);
  assert.equal(COLUMN_PRACTICALS.length, 6);
  [...COLUMN_LESSONS, ...COLUMN_PRACTICALS].forEach((item) => {
    assert.ok(item.id);
    assert.ok(item.title);
    assert.equal(item.subtitle, undefined);
    assert.equal(item.content, undefined);
    assert.equal(item.posters, undefined);
  });
  assert.match(COLUMN_LESSONS[0].title, /到底/);
  assert.match(COLUMN_LESSONS[1].title, /为什么会忘/);
  assert.match(COLUMN_LESSONS[23].title, /不能给 AI/);
  COLUMN_PRACTICALS.slice(0, 4).forEach((item) => {
    assert.doesNotMatch(item.title, /Windows|macOS|Linux/);
  });
  assert.deepEqual(sectionTabs('practicals').map((item) => item.active), [false, true]);
});

test('requires contract v4 and normalizes the protected practical directory', () => {
  assert.equal(COLUMN_READER_CONTRACT_VERSION, 4);
  const preview = previewColumnHome();
  assert.equal(preview.lessons.length, 24);
  assert.equal(preview.practicals.length, 6);
  assert.equal(hasReadableColumnContract(preview), false);
  assert.deepEqual(preview.courseGroups.map((group) => group.lessons.length), [6, 6, 6, 6]);

  const home = normalizeColumnHome({ home: {
    contractVersion: 4,
    updatedAt: '2026-07-21T00:00:00.000Z',
    lessons: [{ id: 'agent', order: 20, title: 'Agent 入门', subtitle: '先理解行动循环' }],
    practicals: [{
      id: 'codex-cli-install', order: 1, term: '安装',
      title: '安装 Codex CLI', subtitle: '从环境检查开始', duration: '10 分钟'
    }]
  } });
  assert.equal(hasReadableColumnContract(home), true);
  assert.equal(home.lessons[0].id, 'agent');
  assert.equal(home.practicals[0].id, 'codex-cli-install');
  assert.equal(home.practicals[0].subtitle, '从环境检查开始');
  assert.equal(home.practicals[0].duration, '10 分钟');
  assert.equal(home.cases, undefined);
  assert.equal(home.trends, undefined);
});

test('keeps every locked fallback entry title-only', () => {
  const home = normalizeColumnHome({
    contractVersion: 4,
    access: { locked: true },
    lessons: [{ id: 'research', order: 13, title: '快速调研', subtitle: '付费副标题', duration: '6 分钟' }],
    practicals: [{ id: 'codex-cli-install', order: 1, title: '安装 Codex CLI', subtitle: '付费副标题', duration: '10 分钟' }]
  });
  assert.equal(home.lessons[0].subtitle, '');
  assert.equal(home.lessons[0].duration, '');
  assert.equal(home.practicals[0].subtitle, '');
  assert.equal(home.practicals[0].duration, '');
});

test('uses everyday reader labels while preserving protected handdrawn posters', () => {
  const lesson = normalizeLessonDetail({ lesson: {
    id: 'agent', term: 'AGENT', title: '什么是 Agent？', subtitle: '围绕目标持续行动。',
    tags: ['代理', '工作流'],
    sections: {
      summary: '围绕目标持续行动。',
      scenario: '整理一周客户反馈。',
      steps: ['确认目标', '选择工具', '核对结果'],
      pitfalls: ['没有权限边界'],
      avoid: '高风险动作无人确认时。',
      takeaway: '先让流程可检查，再追求自动化。'
    },
    visual: { label: '目标', nodes: ['计划', '工具', '结果'], note: '每一步都要能检查。' },
    posters: [1, 2, 3].map((page) => ({
      key: `agent-${page}`,
      image: `https://media.example/agent-${page}.jpg`,
      previewImage: `https://media.example/agent-${page}-hd.jpg`
    }))
  } });
  assert.deepEqual(lesson.sections.map((item) => item.label), [
    '举个例子', '照着做', '容易踩坑', '这些情况先别交给 AI', '记住这一句'
  ]);
  assert.equal(lesson.visual.mode, 'none');
  assert.deepEqual(lesson.posters.map((poster) => poster.page), ['01', '02', '03']);
  assert.deepEqual(lesson.tags, ['代理', '工作流']);
  assert.deepEqual(posterLoadWindow(0, 3), [true, true, false]);
  assert.deepEqual(posterLoadWindow(1, 3), [true, true, true]);
  assert.deepEqual(posterLoadWindow(2, 3), [false, true, true]);
  assert.match(posterPreviewUrls(lesson)[0], /agent-1-hd\.jpg$/);
});

test('normalizes practical details and related concept or hands-on reading', () => {
  const practical = normalizePracticalDetail({ columnPractical: {
    practicalId: 'codex-cli-install',
    term: '安装',
    title: '在电脑上安装 Codex CLI',
    subtitle: '一步步完成环境检查和安装。',
    goal: '安装完成，并能运行第一条命令。',
    prerequisites: ['准备一个可用账号', '确认 Node.js 环境'],
    platformGuides: [{
      id: 'windows', label: 'Windows', terminal: 'PowerShell',
      commands: [{ label: '官方安装', command: 'install-example', platform: 'PowerShell' }],
      steps: ['打开 PowerShell', '运行命令']
    }],
    steps: ['检查版本', '运行安装命令', '完成登录'],
    verification: '终端能正常显示版本号。',
    troubleshooting: ['命令找不到时，先重新打开终端。'],
    avoid: '不要把 API Key 发到聊天或截图里。',
    takeaway: '先确认环境，再处理安装报错。',
    relatedLessonIds: ['security'],
    relatedPracticalIds: ['codex-cli-first-task']
  } });
  assert.equal(practical.kind, 'practical');
  assert.equal(practical.leadLabel, '这次要做什么');
  assert.deepEqual(practical.sections.map((item) => item.label), [
    '开始前准备', '跟着做', '怎么确认成功', '卡住了先看这里',
    '这些情况先别交给 AI', '记住这一句'
  ]);
  assert.equal(practical.visual.mode, 'none');
  assert.equal(practical.platformGuides[0].label, 'Windows');
  assert.equal(practical.platformGuides[0].commands[0].value, 'install-example');
  assert.equal(practical.relatedLessons[0].id, 'security');
  assert.equal(practical.relatedPracticals[0].id, 'codex-cli-first-task');
  assert.equal(normalizeReader('practical', { practical }).kind, 'practical');
});

test('keeps official practical commands copyable and links the server course relation', () => {
  const article = normalizeReader('practical', {
    id: 'codex-cli-install',
    title: '安装 Codex CLI',
    commands: [
      { label: '检查版本', command: 'codex --version', platform: '全部平台' }
    ],
    relatedCourseIds: ['tool-call']
  });

  assert.deepEqual(article.commands, [{
    id: 'command-1',
    label: '检查版本',
    value: 'codex --version',
    platform: '全部平台'
  }]);
  assert.equal(article.relatedLessons[0].id, 'tool-call');

  const root = path.resolve(__dirname, '..');
  const view = fs.readFileSync(path.join(root, 'pages/column-reader/index.wxml'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/column-reader/index.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'features/ai-column/manual-detail.wxss'), 'utf8');
  assert.match(view, /按你的电脑安装/);
  assert.match(view, /操作命令/);
  assert.match(view, /bindtap="copyPlatformCommand"/);
  assert.match(view, /bindtap="copyCommand"/);
  assert.match(page, /setClipboardData/);
  assert.match(styles, /\.command-row[^}]*background:\s*#f4f8fb/s);
  assert.doesNotMatch(styles, /\.command-card[^}]*background:\s*#101a24/s);
});

test('calls home, lesson and practical actions through the client adapter', async () => {
  const previousWx = global.wx;
  const calls = [];
  global.wx = {
    cloud: {
      callFunction: async (request) => {
        calls.push(request);
        return { result: { ok: true, data: {} } };
      }
    }
  };
  try {
    await getColumnHome();
    await getColumnLesson('agent');
    await getColumnPractical('codex-cli-install');
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
  assert.deepEqual(calls.map((call) => call.data.action), [
    'columnHome', 'columnLesson', 'columnPractical'
  ]);
  assert.equal(calls[2].data.practicalId, 'codex-cli-install');
});

test('renders only foundation and hands-on sections with honest support copy', () => {
  const root = path.resolve(__dirname, '..');
  const page = fs.readFileSync(path.join(root, 'pages/curated/index.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'pages/curated/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'pages/curated/index.wxss'), 'utf8');
  assert.match(page, /\['courses', 'practicals'\]/);
  assert.match(page, /openReader\('practical'/);
  assert.match(view, /基础课/);
  assert.match(view, /动手课/);
  assert.match(view, /技术支持不另外收费/);
  assert.match(view, /工具自身的订阅、API 和云服务费用不包含在会员中/);
  assert.doesNotMatch(view, /本周案例|趋势档案|open-type="contact"|微信号|复制微信/);
  assert.doesNotMatch(styles, /manual-head::before|manual-head::after|knowledge-spine|padding-left:\s*54rpx/);
});

test('loads contract v4 before letting a privileged reader use the directory cache', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../pages/curated/index.js'), 'utf8');
  assert.match(page, /normalizeColumnHome\(await loadColumnHome\(\{ force, scope \}\)\)/);
  assert.match(page, /hasReadableColumnContract\(home\)/);
  assert.match(page, /this\.data\.locked \|\| hasReadableColumnContract\(this\.data\.home\)/);
  assert.match(page, /专栏服务正在更新，请稍后重新读取/);
  assert.doesNotMatch(page, /loadColumnCases|loadMoreCases|openTrend/);
});

test('routes practical and compatibility case content to their own caches without the old left rail', () => {
  const root = path.resolve(__dirname, '..');
  const script = fs.readFileSync(path.join(root, 'pages/column-reader/index.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'pages/column-reader/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'features/ai-column/manual-detail.wxss'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'features/ai-column/session.js'), 'utf8');
  assert.match(script, /options\.type === 'practical'/);
  assert.match(script, /options\.type === 'case'/);
  assert.match(script, /loadColumnPractical\(this\.articleId/);
  assert.match(script, /loadColumnCase\(this\.articleId/);
  assert.match(session, /function loadColumnPractical/);
  assert.match(session, /function loadColumnCase/);
  assert.match(view, /bindtap="openRelatedPractical"/);
  assert.match(view, /article\.relatedTrends\.length/);
  assert.match(view, /bindtap="openRelatedTrend"/);
  assert.doesNotMatch(styles, /reader-spine|reader-spine::before|reader-spine::after|padding-left:\s*52rpx|article-section::before/);
});

test('keeps handdrawn galleries inside the protected reader', () => {
  const root = path.resolve(__dirname, '..');
  const reader = fs.readFileSync(path.join(root, 'pages/column-reader/index.wxml'), 'utf8');
  const directory = fs.readFileSync(path.join(root, 'pages/curated/index.wxml'), 'utf8');
  assert.doesNotMatch(directory, /poster-swiper|手绘讲解/);
  assert.match(reader, /poster-swiper/);
  assert.match(reader, /手绘讲解/);
  assert.match(reader, /bindchange="handlePosterChange"/);
  assert.match(reader, /bindtap="previewPoster"/);
  assert.match(reader, /blueprint/);
});
