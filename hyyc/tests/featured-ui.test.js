const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pageRoot = path.resolve(__dirname, '../pages/featured');

function read(name) {
  return fs.readFileSync(path.join(pageRoot, name), 'utf8');
}

function minHeightFor(styles, selectorPattern) {
  const rule = styles.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `missing style rule for ${selectorPattern}`);
  const height = rule[1].match(/min-height:\s*(\d+)rpx/);
  assert.ok(height, `missing min-height for ${selectorPattern}`);
  return Number(height[1]);
}

test('featured result and completion copy follow the selected time range', () => {
  const markup = read('index.wxml');
  assert.match(markup, /filters\.time === '1d' \? '24 小时内精选'/);
  assert.match(markup, /filters\.time === '30d' \? '近 30 天精选'/);
  assert.match(markup, /: '近 7 天精选'\)\}\}/);
  assert.match(markup, /filters\.time === '1d' \? '24 小时内精选已看完'/);
  assert.match(markup, /filters\.time === '30d' \? '近 30 天精选已看完'/);
  assert.match(markup, /: '近 7 天精选已看完'\)\}\}/);
  assert.doesNotMatch(markup, /今日精选|今天的精选看完了/);
});

test('featured filter controls expose clear semantics and mobile touch targets', () => {
  const markup = read('index.wxml');
  const styles = read('index.wxss');
  assert.match(markup, /aria-label="时间范围：/);
  assert.match(markup, /aria-label="排序方式：/);
  assert.match(markup, /aria-label="打开筛选，当前\{\{filterSummary\}\}"/);
  assert.match(markup, />筛选 · \{\{filterSummary\}\} ↘<\/text>/);
  assert.ok(minHeightFor(styles, '\\.window-choice,\\s*\\.sort-choice') >= 72);
  assert.ok(minHeightFor(styles, '\\.curated-meta-line') >= 72);
});
