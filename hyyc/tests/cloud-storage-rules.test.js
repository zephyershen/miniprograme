const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const rules = require(path.join(__dirname, '..', '..', 'docs', 'cloud-storage-rules.json'));

function evaluateRead(resourcePath) {
  const evaluate = new Function('resource', `return Boolean(${rules.read});`);
  return evaluate({ path: resourcePath });
}

function evaluateWrite(resourcePath, resourceOpenId = 'viewer', auth = {
  openid: 'viewer',
  uid: ''
}) {
  const evaluate = new Function('resource', 'auth', `return Boolean(${rules.write});`);
  return evaluate({ path: resourcePath, openid: resourceOpenId }, auth);
}

test('public knowledge media includes source avatars but keeps protected media private', () => {
  assert.equal(evaluateRead('knowledge-source-avatars/x/rohan-paul.webp'), true);
  assert.equal(evaluateRead('knowledge-previews/source/item-1.webp'), true);
  assert.equal(evaluateRead('ai-column/posters-hd/v2/02-context-01.jpg'), false);
});

test('keeps every user-media state private and serves approved media through the backend', () => {
  const owner = 'a'.repeat(64);
  const upload = 'b'.repeat(48);
  assert.equal(evaluateRead(`user-media/staging/${owner}/avatars/${upload}.jpg`), false);
  assert.equal(evaluateRead(`user-media/staging/${owner}/comments/${upload}.png`), false);
  assert.equal(evaluateRead(`user-media/review/avatars/${owner}/${upload}.jpg`), false);
  assert.equal(evaluateRead(`user-media/published/avatars/${owner}/${upload}.jpg`), false);
  assert.equal(evaluateRead(`user-media/published/comments/${owner}/${upload}.png`), false);
});

test('blocks legacy reads and every direct client write', () => {
  const owner = 'a'.repeat(64);
  const upload = 'b'.repeat(48);
  const staged = `user-media/staging/${owner}/comments/${upload}.webp`;
  assert.equal(evaluateRead('user-media/avatars/legacy.jpg'), false);
  assert.equal(evaluateRead('user-media/comments/legacy.jpg'), false);
  assert.equal(evaluateWrite(staged), false);
  assert.equal(evaluateWrite(staged, 'attacker'), false);
  assert.equal(evaluateWrite(`user-media/published/comments/${owner}/${upload}.webp`), false);
  assert.equal(evaluateWrite('user-media/comments/arbitrary.webp'), false);
  assert.equal(evaluateWrite('knowledge-previews/source/arbitrary.webp'), false);
});
