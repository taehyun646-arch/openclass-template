const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const openClassApi = require('../api/index');
const cron = require('../api/cron-comcigan');

function response() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('Cron은 잘못된 인증·미설정 비밀값·잘못된 메서드에서 동기화하지 않는다', async t => {
  const previous = process.env.CRON_SECRET;
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  let calls = 0;
  t.mock.method(openClassApi, 'runScheduledComciganSync', async () => { calls++; });
  process.env.CRON_SECRET = 'test-cron-secret';
  for (const header of [undefined, 'Bearer wrong', 'Bearer test-cron-secreu']) {
    const res = response();
    await cron({ method: 'GET', headers: { authorization: header } }, res);
    assert.equal(res.statusCode, 401);
  }
  delete process.env.CRON_SECRET;
  const missing = response();
  await cron({ method: 'GET', headers: { authorization: 'Bearer undefined' } }, missing);
  assert.equal(missing.statusCode, 401);
  process.env.CRON_SECRET = 'test-cron-secret';
  const method = response();
  await cron({ method: 'POST', headers: { authorization: 'Bearer test-cron-secret' } }, method);
  assert.equal(method.statusCode, 405);
  assert.equal(calls, 0);
});

test('인증된 Cron은 동기화 결과를 반환하고 실패는 500으로 알린다', async t => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret';
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  t.mock.method(openClassApi, 'runScheduledComciganSync', async () => ({ skipped: true, reason: 'manual-lock' }));
  const req = { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } };
  const ok = response();
  await cron(req, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.reason, 'manual-lock');
  openClassApi.runScheduledComciganSync = async () => { throw new Error('mock sync failure'); };
  const failed = response();
  await cron(req, failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.ok, false);
});

test('로그인·bootstrap은 컴시간 동기화를 기다리지 않는다', async () => {
  const module = { exports: {} };
  const filename = path.join(__dirname, '..', 'api', 'index.js');
  const context = vm.createContext({ module, require: name => name === '../lib/auth' ? require('../lib/auth') : require(name), console, process });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  vm.runInContext(`
    supabaseClient = () => ({});
    applyConfirmedTargetCorrection = async () => {};
    maybeAutoSyncComcigan = () => { throw new Error('로그인 중 동기화 호출'); };
    getLoginOptions = async () => ({ login: true });
    loadTeacherState = async () => ({});
    actorFromRequest = () => ({});
    buildBootstrap = async () => ({ bootstrap: true });
  `, context);
  for (const action of ['getLoginOptions', 'bootstrap']) {
    const res = response();
    await module.exports({ method: 'POST', headers: {}, body: { action, actorType: 'teacher', teacherId: 't1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  }
});
