const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('전체 안내는 공개수업 일정 유무와 관계없이 전용 결과 칸에 표시한다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

  assert.match(source, /id="stageMessageText"/);
  assert.match(source, /isStageMessage \? 'stageMessageText' : 'messageText'/);
  assert.match(source, /copyMessage\('stageMessageText'\)/);
});
