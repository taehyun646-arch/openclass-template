const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', 'public', 'script.js');
const script = fs.readFileSync(filename, 'utf8');

async function renderLogin(options = {}) {
  const root = { innerHTML: '' };
  const context = vm.createContext({
    document: {
      addEventListener() {},
      getElementById(id) {
        assert.equal(id, 'root');
        return root;
      }
    },
    sessionStorage: { getItem: () => null },
    // Rendering must use the supplied login data without contacting the live API.
    fetch: () => { throw new Error('로그인 화면 테스트에서 실제 API 호출을 허용하지 않는다'); },
    options: { teachers: [], semesterClasses: [], ...options }
  });
  vm.runInContext(script, context, { filename });
  vm.runInContext('loginOptions = options;', context);
  await vm.runInContext('renderLogin()', context);
  return root.innerHTML;
}

test('로그인 화면은 교사 선택, 공개수업 일정, 참관왕, 접힌 연간 현황을 표시한다', async () => {
  const html = await renderLogin();
  assert.match(html, /id="loginTeacher"/);
  assert.match(html, /이번 주·다음 주 공개수업 일정/);
  assert.match(html, /메신저 확인하기/);
  assert.match(html, /월간 공개수업 일정 확인하기/);
  assert.match(html, /2026 올해의 참관왕/);
  assert.match(html, /<details[^>]*class="login-progress-board login-progress-details"[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*class="login-progress-board login-progress-details"[^>]*\bopen\b/);
  assert.match(html, /연간 이행 현황/);
});

test('로그인 화면의 참관왕은 마스킹된 이름과 실제 완료 횟수를 표시한다', async () => {
  const html = await renderLogin({ applicationOverview: { leaders: [{ rank: 1, displayName: '김교*', subject: '영어', count: 3 }] } });
  assert.match(html, /aria-label="1위"/);
  assert.match(html, /김교\*/);
  assert.match(html, /<b>3<em>회<\/em><\/b>/);
  assert.doesNotMatch(html, /아직 참석 확인이 완료된 참관 기록이 없습니다/);
});

test('일정과 참관 완료 기록이 없으면 로그인 화면에 빈 상태 안내를 표시한다', async () => {
  const html = await renderLogin();
  assert.match(html, /이번 주와 다음 주에 확정된 공개수업이 없습니다/);
  assert.match(html, /아직 참석 확인이 완료된 참관 기록이 없습니다/);
});
