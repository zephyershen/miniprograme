const COURSE_TRACKS = Object.freeze([
  { key: 'understand', label: '先把原理听懂' },
  { key: 'instruct', label: '把事情说清楚' },
  { key: 'work', label: '用到每天的工作里' },
  { key: 'execute', label: '让 AI 开始做事' }
]);

const PRACTICAL_TRACKS = Object.freeze([
  { key: 'codex', label: 'Codex 上手' },
  { key: 'claude-code', label: 'Claude Code 上手' },
  { key: 'safe-connect', label: '安全连接' }
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function lines(value) {
  return (Array.isArray(value) ? value : []).join('\n');
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function commandLines(value) {
  return (Array.isArray(value) ? value : []).map((item) => [
    item.label || '',
    item.command || item.value || '',
    item.platform || ''
  ].join(' | ')).join('\n');
}

function parseCommands(value) {
  return splitLines(value).map((line, index) => {
    const [label, command, platform] = line.split('|').map((item) => item.trim());
    return {
      id: `command-${index + 1}`,
      label: label || `命令 ${index + 1}`,
      command: command || label,
      platform: command ? platform || '' : ''
    };
  }).filter((item) => item.command);
}

function sourceLines(value) {
  return (Array.isArray(value) ? value : []).map((item) => [
    item.title || '',
    item.url || item.itemId || ''
  ].join(' | ')).join('\n');
}

function parseSources(value) {
  return splitLines(value).map((line, index) => {
    const [title, target] = line.split('|').map((item) => item.trim());
    return {
      id: `source-${index + 1}`,
      title: title || '查看原始来源',
      ...(target && /^https:\/\//i.test(target) ? { url: target } : {}),
      ...(target && !/^https:\/\//i.test(target) ? { itemId: target } : {})
    };
  });
}

function editableForm(entry) {
  const draft = clone(entry && entry.draft || {});
  const sections = draft.sections || {};
  const platforms = (draft.platformGuides || []).map((guide, index) => ({
    id: guide.id || `platform-${index + 1}`,
    label: guide.label || '',
    terminal: guide.terminal || '',
    commandsText: commandLines(guide.commands),
    stepsText: lines(guide.steps)
  }));
  return {
    id: draft.id || entry && entry.id || '',
    kind: draft.kind || entry && entry.kind || 'course',
    title: draft.title || '',
    subtitle: draft.subtitle || '',
    track: draft.track || '',
    term: draft.term || '',
    tagsText: lines(draft.tags),
    duration: draft.duration || '',
    order: String(draft.order || ''),
    posters: clone(draft.posters || []),
    relatedCourseText: lines(draft.relatedCourseIds),
    relatedPracticalText: lines(draft.relatedPracticalIds),
    summary: sections.summary || '',
    scenario: sections.scenario || '',
    stepsText: lines(sections.steps),
    pitfallsText: lines(sections.pitfalls),
    avoid: sections.avoid || '',
    takeaway: sections.takeaway || '',
    goal: draft.goal || '',
    prerequisitesText: lines(sections.prerequisites),
    verificationText: lines(sections.verification),
    troubleshootingText: lines(sections.troubleshooting),
    commandsText: commandLines(draft.commands),
    sourcesText: sourceLines(draft.sources),
    platforms
  };
}

function draftFromForm(form) {
  const common = {
    id: form.id,
    kind: form.kind,
    title: String(form.title || '').trim(),
    subtitle: String(form.subtitle || '').trim(),
    track: form.track,
    term: String(form.term || '').trim(),
    tags: splitLines(form.tagsText),
    duration: String(form.duration || '').trim(),
    order: Number(form.order) || 1,
    posters: clone(form.posters || []).map((poster) => ({
      key: poster.key,
      ...(poster.mediaId ? { mediaId: poster.mediaId } : {}),
      ...(poster.fileId ? { fileId: poster.fileId } : {}),
      alt: String(poster.alt || '').trim()
    })),
    relatedCourseIds: splitLines(form.relatedCourseText),
    relatedPracticalIds: splitLines(form.relatedPracticalText)
  };
  if (form.kind === 'course') {
    return {
      ...common,
      sections: {
        summary: String(form.summary || '').trim(),
        scenario: String(form.scenario || '').trim(),
        steps: splitLines(form.stepsText),
        pitfalls: splitLines(form.pitfallsText),
        avoid: String(form.avoid || '').trim(),
        takeaway: String(form.takeaway || '').trim()
      }
    };
  }
  return {
    ...common,
    catalogTitle: common.title,
    goal: String(form.goal || '').trim(),
    platformGuides: (form.platforms || []).map((guide, index) => ({
      id: guide.id || `platform-${index + 1}`,
      label: String(guide.label || '').trim(),
      terminal: String(guide.terminal || '').trim(),
      commands: parseCommands(guide.commandsText),
      steps: splitLines(guide.stepsText)
    })).filter((guide) => guide.label || guide.commands.length || guide.steps.length),
    commands: parseCommands(form.commandsText),
    sources: parseSources(form.sourcesText),
    sections: {
      prerequisites: splitLines(form.prerequisitesText),
      steps: splitLines(form.stepsText),
      verification: splitLines(form.verificationText),
      troubleshooting: splitLines(form.troubleshootingText),
      pitfalls: splitLines(form.pitfallsText),
      avoid: String(form.avoid || '').trim(),
      takeaway: String(form.takeaway || '').trim()
    }
  };
}

function entryStatus(status) {
  if (status === 'published') return { label: '已发布', tone: 'live' };
  if (status === 'unpublished') return { label: '已下架', tone: 'off' };
  return { label: '草稿', tone: 'draft' };
}

function columnAdminLoadError(error) {
  const code = error && error.code;
  const message = String(error && error.message || '');
  if (code === 'INVALID_REQUEST' && message.includes('不支持的操作')) {
    return {
      title: '管理服务还没有更新',
      copy: '新版管理服务尚未部署完成。请稍后重新读取，现有会员内容不会受影响。'
    };
  }
  if (code === 'ADMIN_REQUIRED' || message.includes('真实管理员')) {
    return {
      title: '当前账号没有管理权限',
      copy: '请使用已配置为管理员的微信账号进入。身份预览不会影响真实管理员权限。'
    };
  }
  return {
    title: '内容暂时没有读取成功',
    copy: message || '请检查网络后重新读取。'
  };
}

function decorateEntryList(payload, activeKind = 'course') {
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const filtered = items.filter((item) => item.kind === activeKind);
  return filtered.map((item, index) => {
    const track = tracksForKind(item.kind).find((value) => value.key === item.track);
    return {
      ...item,
      kindLabel: item.kind === 'practical' ? '动手课' : '基础课',
      trackLabel: track ? track.label : item.track,
      statusView: entryStatus(item.status),
      orderLabel: Number(item.order).toFixed(Number(item.order) % 1 ? 1 : 0),
      canMoveUp: index > 0 && filtered[index - 1].track === item.track,
      canMoveDown: index < filtered.length - 1 && filtered[index + 1].track === item.track
    };
  });
}

function tracksForKind(kind) {
  return (kind === 'practical' ? PRACTICAL_TRACKS : COURSE_TRACKS).map((item) => ({ ...item }));
}

module.exports = {
  COURSE_TRACKS,
  PRACTICAL_TRACKS,
  splitLines,
  parseCommands,
  parseSources,
  editableForm,
  draftFromForm,
  entryStatus,
  columnAdminLoadError,
  decorateEntryList,
  tracksForKind
};
