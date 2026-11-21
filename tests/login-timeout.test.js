const test = require('node:test');
const assert = require('node:assert/strict');
const { frontend } = require('./helpers/frontend');

function hangUntilAborted(_url, { signal }) {
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    reject(error);
  }, { once: true }));
}

for (const call of ["api('getLoginOptions')", "api('bootstrap')", 'getSiteStatus()']) {
  test(`${call}은 15초가 지나면 중단되고 타이머를 해제한다`, async () => {
    const ui = frontend({ fetch: hangUntilAborted });
    const pending = ui.run(call);
    const rejected = assert.rejects(pending, /서버 응답이 늦습니다/);
    assert.equal(ui.timers.size, 1);
    const timer = [...ui.timers.values()][0];
    assert.equal(timer.ms, 15000);
    timer.fn();
    await rejected;
    assert.equal(ui.timers.size, 0);
  });
}

test('응답 헤더를 받았어도 JSON 본문이 멈추면 15초 제한이 적용된다', async () => {
  let signal;
  const ui = frontend({ fetch: async (_url, options) => {
    signal = options.signal;
    return { status: 200, ok: true, json: () => hangUntilAborted('', { signal }) };
  } });
  const pending = ui.run("api('getLoginOptions')");
  const rejected = assert.rejects(pending, /서버 응답이 늦습니다/);
  await new Promise(setImmediate);
  [...ui.timers.values()][0].fn();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(ui.timers.size, 0);
});

for (const status of [200, 502, 504]) {
  test(`HTML 응답(${status})은 지연 안내로 처리한다`, async () => {
    const ui = frontend({ fetch: async () => ({ status, ok: status === 200, json: async () => { throw new SyntaxError('HTML'); } }) });
    await assert.rejects(ui.run("api('getLoginOptions')"), /서버 응답이 늦습니다/);
    assert.equal(ui.timers.size, 0);
  });
}

test('정상 응답과 정상 JSON 오류는 타이머를 해제하고 원래 메시지를 유지한다', async () => {
  const ui = frontend({ fetch: async () => ({ status: 200, ok: true, json: async () => ({ ok: true, data: {} }) }) });
  assert.equal((await ui.run("api('getLoginOptions')")).ok, true);
  assert.equal(ui.timers.size, 0);
  ui.context.fetch = async () => ({ status: 500, ok: false, json: async () => ({ ok: false, message: '환경변수 설정 필요' }) });
  await assert.rejects(ui.run("api('getLoginOptions')"), /환경변수 설정 필요/);
  assert.equal(ui.timers.size, 0);
});

test('초기 로그인 지연 시 재시도 버튼을 표시하고 로딩을 종료한다', async () => {
  const ui = frontend({ fetch: async () => ({ status: 504, ok: false }) });
  await ui.run('startApp()');
  assert.match(ui.element('root').innerHTML, /서버 응답이 늦습니다/);
  assert.match(ui.element('root').innerHTML, /onclick="retryApp\(\)"/);
  assert.equal(ui.element('loading').loading, false);
  assert.equal(ui.timers.size, 0);
});

test('비로그인 재조회 실패도 로딩을 종료하고 재시도 버튼을 표시한다', async () => {
  const ui = frontend({ fetch: async () => ({ status: 504, ok: false }) });
  await ui.run('loadApp()');
  assert.match(ui.element('root').innerHTML, /다시 시도/);
  assert.equal(ui.element('loading').loading, false);
});

test('관리자 로그인 지연은 안내와 재시도 버튼을 표시하고 로딩을 종료한다', async () => {
  const ui = frontend({ fetch: hangUntilAborted });
  ui.run('loginOptions = { teachers: [], semesterClasses: [] };');
  ui.element('adminPassword').value = 'test-password';
  const pending = ui.run('enterAdmin({ preventDefault() {} })');
  [...ui.timers.values()][0].fn();
  await pending;
  assert.match(ui.element('root').innerHTML, /서버 응답이 늦습니다/);
  assert.match(ui.element('root').innerHTML, /다시 시도/);
  assert.equal(ui.element('loading').loading, false);
  assert.equal(ui.timers.size, 0);
});

test('변경 요청 지연 후 재시도는 변경 요청을 반복하지 않고 조회만 한다', async () => {
  const requests = [];
  const ui = frontend({ fetch: async (url, options) => {
    requests.push(url === '/api' ? JSON.parse(options.body).action : url);
    if (requests.length === 1) return { status: 504, ok: false };
    return { status: 200, ok: true, json: async () => url === '/api/status' ? { maintenance: false } : { ok: true, data: {} } };
  } });
  ui.run("userSession = { actorType: 'teacher', teacherId: 't1' }; render = () => {};");
  await ui.run("mutate('applyObservations', {})");
  assert.equal(ui.element('loading').loading, false);
  assert.match(ui.element('toast').innerHTML, /다시 시도/);
  await ui.run('retryApp()');
  assert.deepEqual(requests, ['applyObservations', 'bootstrap', '/api/status']);
});
