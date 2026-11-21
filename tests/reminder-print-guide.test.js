const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const api = require('../api/index')._test;
const { frontend } = require('./helpers/frontend');
const { mockDb, fixture, actor } = require('./helpers/admin-db');
const plain = v => JSON.parse(JSON.stringify(v));

test('reminder uses confirmed observer count and excludes all personal document status', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T00:00:00+09:00') });
  const state = fixture();
  state.open_classes[0].class_date = '2026-10-13';
  state.observations = [
    { class_id: 'class-0', observer_id: 'observer', status: '확정' },
    { class_id: 'class-0', observer_id: 'admin', status: '확정' },
    { class_id: 'class-0', observer_id: 'presenter', status: '취소' }
  ];
  state.documents.push({ class_id: 'class-0', submitter_id: 'presenter', document_type: '협의록', status: '수기제출예정' });
  const message = api.buildMessage(state, { type: 'reminder', classId: 'class-0' });
  assert.match(message, /오늘\(10\.13\.\)/);
  assert.match(message, /참관 인원\(2명\).*3부씩/);
  assert.match(message, /참관 예정: 이교사, 관리자 선생님/);
  assert.doesNotMatch(message, /미제출|제출 완료/);
  assert.doesNotMatch(message.split('[준비 사항]')[1], /김교사/);
});

test('other-day date remains weekday format; empty room uses classroom fallback with no room heading', () => {
  const cls = { date: '2026-10-15', period: 3, className: '1-2', teacherName: '김공개', room: '  ' };
  const message = api.buildClassReminderMessage(cls, ['이참관', '박참관'], '2026-10-13');
  assert.match(message, /10\.15\.\(목\)/); assert.doesNotMatch(message, /오늘\(/);
  assert.doesNotMatch(message, / - 장소:/);
  assert.match(message, /수업 시작 전 공개수업 교실에 비치해 주시면 감사하겠습니다/);
  assert.match(message, /간단한 필기구/); assert.match(message, /수업공개 선생님께 문의 바랍니다/);
  const zero = api.buildClassReminderMessage(cls, [], '2026-10-13');
  assert.match(zero, /참관 예정자가 아직 없습니다/); assert.match(zero, /참관 인원\(0명\).*1부씩/);
});

function settingsDb(error = null) {
  const calls = [], settings = new Map();
  return { calls, settings, from(table) {
    if (table === 'app_settings') return { upsert: async (row, options) => { calls.push({ table, row, options }); if (!error) settings.set(row.setting_key, row.setting_value); return { error }; } };
    assert.equal(table, 'audit_logs'); return { insert: async row => { calls.push({ table, row }); return { error: null }; } };
  } };
}
test('fixed recipients save canonical ordered names and audit, and empty save clears setting without deletion', async () => {
  const db = settingsDb();
  await api.dispatchAction(db, {}, actor, 'updateReminderFixedRecipients', { recipients: ' 교장님 , 교감님, 교장님, 연구부장님, , ' });
  assert.equal(db.settings.get('reminder_fixed_recipients'), '교장님, 교감님, 연구부장님');
  assert.deepEqual(db.calls[0].options, { onConflict: 'setting_key' });
  assert.equal(db.calls[1].row.actor_id, 'admin'); assert.equal(db.calls[1].row.target_id, 'reminder_fixed_recipients');
  assert.deepEqual(db.calls[1].row.detail.recipients, ['교장님', '교감님', '연구부장님']);
  await api.dispatchAction(db, {}, actor, 'updateReminderFixedRecipients', { recipients: '' });
  assert.equal(db.settings.get('reminder_fixed_recipients'), ''); assert.equal(db.calls.length, 4);
});
test('teacher action rejected; malformed input and failed setting save produce no audit', async () => {
  const db = settingsDb();
  await assert.rejects(api.dispatchAction(db, {}, { isAdmin: false }, 'updateReminderFixedRecipients', { recipients: '교장님' }), /관리자/);
  for (const recipients of [undefined, [], {}, 'x'.repeat(1001)]) await assert.rejects(api.dispatchAction(db, {}, actor, 'updateReminderFixedRecipients', { recipients }), /1,000자/);
  assert.equal(db.calls.length, 0);
  const failed = settingsDb(new Error('mock save failed'));
  await assert.rejects(api.dispatchAction(failed, {}, actor, 'updateReminderFixedRecipients', { recipients: '교장님' }), /mock save failed/);
  assert.equal(failed.calls.length, 1);
});
test('setting action follows existing signed-admin-token authentication before any setting writes', async () => {
  const filename = path.join(__dirname, '../api/index.js'), module = { exports: {} };
  const context = vm.createContext({ module, require: n => n === '../lib/auth' ? require('../lib/auth') : require(n), console, process });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  context.db = settingsDb();
  vm.runInContext(`supabaseClient=()=>db; applyConfirmedTargetCorrection=async()=>{};`, context);
  const response = { code: 0, body: null, setHeader() {}, status(c) {this.code=c;return this;}, json(b) {this.body=b;return this;} };
  await module.exports({ method: 'POST', headers: {}, body: { action: 'updateReminderFixedRecipients', actorType: 'admin', payload: { recipients: '교장님' } } }, response);
  assert.equal(response.code, 401); assert.equal(context.db.calls.length, 0);
});
test('fixed recipients default empty and are present only in administrator bootstrap', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T00:00:00+09:00') });
  for (const value of [undefined, ' 교장님, 교감님, 교장님, 연구부장님 ']) {
    const seed = fixture(); if (value !== undefined) seed.app_settings.push({ setting_key: 'reminder_fixed_recipients', setting_value: value });
    const db = mockDb(seed); const state = await api.loadState(db);
    const admin = await api.buildBootstrap(db, state, actor);
    assert.deepEqual(admin.admin.reminderFixedRecipients, value ? ['교장님', '교감님', '연구부장님'] : []);
    const teacher = await api.buildBootstrap(db, state, { id: 'observer', name: '이교사', isAdmin: false });
    assert.equal(teacher.admin, undefined); assert.doesNotMatch(JSON.stringify(teacher), /교장님|교감님|연구부장님|reminderFixedRecipients/);
    assert.doesNotMatch(JSON.stringify(teacher), /김교사/);
  }
});

function messageUi(fixed) {
  const ui = frontend(); ui.context.seed = { actor: { isAdmin: true }, admin: { reminderFixedRecipients: fixed, approvedClasses: [{ id: 'c1', teacherName: '김공개' }], observationApplications: [{ classId: 'c1', observerName: '이참관' }, { classId: 'c1', observerName: '김공개' }, { classId: 'c1', observerName: '이참관' }, { classId: 'other', observerName: '제외' }] } };
  ui.run('state=seed'); ui.element('messageClass').value = 'c1'; return ui;
}
test('reminder recipient order/deduplication and copying are identical in normal screen and popup', async () => {
  for (const [fixed, expected] of [[['교장님', '교감님', '김공개', '교장님', '연구부장님', '이참관'], ['교장님', '교감님', '김공개', '연구부장님', '이참관']], [[], ['김공개', '이참관']], [undefined, ['김공개', '이참관']]]) {
    const ui = messageUi(fixed), copied = []; ui.context.copyPlainText = async s => copied.push(s); ui.run('showToast=()=>{}; updateMessageRecipients();');
    assert.deepEqual(plain(ui.run("messageRecipientsForClass('c1','reminder')")), expected);
    assert.deepEqual(plain(ui.run('selectedMessageRecipients()')), expected);
    await ui.run('copySelectedMessageRecipients()'); await ui.run("copyMessageRecipients('c1','reminder')");
    assert.deepEqual(copied, [expected.join(', '), expected.join(', ')]);
    assert.deepEqual(plain(ui.run("messageRecipientsForClass('c1','observers')")), ['김공개', '이참관'], 'fixed names apply only to reminder');
  }
});
test('frontend generates only current reminder without deadline and saves settings through existing mutate', async () => {
  const ui = messageUi(['교장님']), calls = []; ui.context.api = async (action, payload) => { calls.push({ action, payload }); return { messageText: '단체 리마인드' }; };
  await ui.run("makeMessage('reminder')");
  assert.deepEqual(plain(calls), [{ action: 'buildMessage', payload: { classId: 'c1', type: 'reminder' } }]);
  assert.equal(ui.element('messageText').value, '단체 리마인드');
  assert.match(ui.element('messageRecipients').innerHTML, /교장님.*김공개.*이참관/);
  await ui.run("makeMessage('presenterPrep')"); assert.equal(calls.length, 1);
  ui.context.mutate = async (action, payload) => { calls.push({ action, payload }); };
  ui.context.event = { preventDefault() {} }; ui.element('reminderFixedRecipients').value = '교장님, 교감님';
  await ui.run('saveReminderFixedRecipients(event)');
  assert.deepEqual(plain(calls.at(-1)), { action: 'updateReminderFixedRecipients', payload: { recipients: '교장님, 교감님' } });
  assert.match(ui.run('renderReminderRecipientSettings()'), /리마인드 고정 수신자/);
  ui.run('state.actor.isAdmin=false'); assert.equal(ui.run('renderReminderRecipientSettings()'), '');
  await ui.run('saveReminderFixedRecipients(event)'); assert.equal(calls.length, 2);
});
