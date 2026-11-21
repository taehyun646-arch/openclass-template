const test = require('node:test'), assert = require('node:assert/strict');
const { buildAdminTodo, buildAdminData, buildBootstrap, loadState, weekday } = require('../api/index')._test;
const { mockDb, fixture, actor } = require('./helpers/admin-db');
const { frontend } = require('./helpers/frontend');
const plain = v => JSON.parse(JSON.stringify(v));
function cls(id, date, period = 1, semester = 2, status = '확정') {
  return { id, date, period, semester, status, teacherId: 'presenter', teacherName: '김교사', observerCount: 2 };
}
function todoFixture() {
  const classes = [cls('today-2', '2026-10-12', 2), cls('past', '2026-10-11'), cls('friday', '2026-10-23'), cls('today-1', '2026-10-12'), cls('saturday', '2026-10-24'), cls('first', '2026-06-01', 1, 1), cls('future-first', '2026-10-13', 1, 1), cls('pending', '2026-10-13', 1, 2, '승인대기')];
  const state = {
    documents: [
      { class_id: 'past', submitter_id: 'presenter', document_type: '지도안', status: '온라인제출' },
      { class_id: 'past', submitter_id: 'presenter', document_type: '협의록', status: '수기제출확인' },
      { class_id: 'past', submitter_id: 'presenter', document_type: '참관록', status: '수기제출예정' },
      { class_id: 'first', submitter_id: 'someone-else', document_type: '지도안', status: '온라인제출' }
    ],
    notifications: [
      { notification_type: '공개수업시간표충돌', resolved_at: null, read_at: 'read' },
      { notification_type: '참관시간표충돌', resolved_at: null },
      { notification_type: '학사일정충돌', resolved_at: 'resolved' },
      { notification_type: '일정변경', resolved_at: null }
    ]
  };
  const admin = { approvedClasses: classes.filter(r => r.semester === 2 && r.status === '확정'), documentClasses: classes.filter(r => r.status === '확정'), pendingClasses: [classes.at(-1)], pendingChanges: [{ id: 'change', requesterName: '김교사', requesterSubject: '영어' }] };
  return { state, admin };
}
test('todo counts actionable work and includes next Friday, excludes past/first-semester/unconfirmed message classes', () => {
  const { state, admin } = todoFixture();
  const todo = buildAdminTodo(state, admin, '2026-10-12');
  assert.deepEqual(todo.pendingChanges, [{ id: 'change', teacherName: '김교사', subject: '영어' }]);
  assert.equal(todo.pendingClasses, 1); assert.equal(todo.conflicts, 2);
  assert.equal(todo.missingDocuments, 4); assert.equal(todo.missingDocumentClasses, 2);
  assert.equal(todo.total, 8, 'message classes excluded from total');
  assert.deepEqual(todo.messageClasses.map(r => r.id), ['today-1', 'today-2', 'friday']);
  assert.equal(todo.messageEnd, '2026-10-23'); assert.equal(todo.messageClasses[0].isToday, true);
});
test('KST midnight and Sunday next-Friday boundary, no-action state', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T15:00:00Z') });
  const { state, admin } = todoFixture(); assert.equal(buildAdminTodo(state, admin).today, '2026-10-12');
  assert.equal(buildAdminTodo(state, admin, '2026-10-18').messageEnd, '2026-10-23');
  const empty = buildAdminTodo({ documents: [], notifications: [] }, { pendingChanges: [], pendingClasses: [], approvedClasses: [cls('soon', '2026-10-13')], documentClasses: [] });
  assert.equal(empty.total, 0); assert.equal(empty.messageClasses.length, 1);
});
test('bootstrap includes todo only for admin, with no additional DB requests to compute it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T15:30:00Z') });
  const db = mockDb(fixture()), state = await loadState(db); db.reset();
  const admin = await buildBootstrap(db, state, actor);
  assert.ok(admin.admin.todo); assert.equal(admin.admin.todo.conflicts, 2);
  assert.deepEqual(db.calls.map(c => c.operation), ['upsert', 'select']);
  db.reset(); const teacher = await buildBootstrap(db, state, { id: 'observer', name: '이교사', role: '교사', isAdmin: false });
  assert.equal(teacher.admin, undefined); assert.equal(teacher.todo, undefined);
  assert.ok(!JSON.stringify(teacher).includes('김교사'), 'other teacher name remains masked');
});
function ui() {
  const stored = new Map(), events = new Map();
  const h = frontend({ sessionStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) } });
  const { state, admin } = todoFixture();
  const todo = buildAdminTodo(state, admin, '2026-10-12');
  h.context.fixture = { actor, config: { schoolYear: '2026' }, admin: { todo, approvedClasses: admin.approvedClasses, observationApplications: [{ classId: 'today-1', observerName: '이교사' }, { classId: 'today-1', observerName: '이교사' }] } };
  h.run('state = fixture;');
  // Register key handler using the real source with a capture-only document.
  const keys = frontend({ document: { addEventListener: (name, fn) => events.set(name, fn), getElementById: h.element }, sessionStorage: h.context.sessionStorage });
  keys.context.fixture = h.context.fixture; keys.run('state=fixture;');
  return { ...h, stored, keys, events };
}
test('popup respects session dismissal and zero actionable count; explicit reopen works without fetch', () => {
  const h = ui(); h.run('initializeAdminTodo()');
  let html = h.run('renderAdminTodoPopup()');
  assert.match(html, /role="dialog"/); assert.match(html, /aria-label="관리자 오늘 할 일"/);
  assert.match(html, /김교사 · 영어/); assert.match(html, />오늘<\/strong>/);
  assert.match(html, /이번 주·다음 주 수업 3건/); assert.match(html, /문구/);
  const labels = ['일정 변경 승인 대기', '공개수업 신청 승인 대기', '시간표 충돌 미해결', '메신저 문구 만들기', '제출자료 미완료'];
  for (let i = 1; i < labels.length; i++) assert.ok(html.indexOf(labels[i]) > html.indexOf(labels[i - 1]));
  h.run('closeAdminTodo(); adminTodoOpen=null; initializeAdminTodo();'); assert.equal(h.run('renderAdminTodoPopup()'), '');
  h.run('openAdminTodo()'); assert.match(h.element('adminTodoHost').innerHTML, /오늘 할 일/);
  h.run('adminTodoOpen=null; state.admin.todo.total=0; initializeAdminTodo();');
  assert.equal(h.run('renderAdminTodoPopup()'), ''); assert.match(h.run('renderAdminTodoButton()'), /할 일 없음/);
  h.run('openAdminTodo()'); assert.match(h.run('renderAdminTodoPopup()'), /이번 주·다음 주 수업/);
  h.run('state.actor={isAdmin:false}; initializeAdminTodo();');
  assert.equal(h.run('renderAdminTodoPopup()'), ''); assert.equal(h.run('renderAdminTodoButton()'), '');
});
test('Escape dismisses admin dialog and persists session state', () => {
  const { keys, events, stored } = ui(); keys.run('initializeAdminTodo()');
  events.get('keydown')({ key: 'Escape' });
  assert.equal(keys.run('adminTodoOpen'), false); assert.equal([...stored.values()][0], '1');
});
test('jump targets open conflict section and route documents to admin center', () => {
  const h = ui(); const visited = [];
  for (const id of ['adminChangeApprovals', 'adminOpenApprovals', 'adminScheduleConflicts', 'adminDocumentCenter']) {
    h.element(id).scrollIntoView = () => visited.push(id); h.element(id).focus = () => {};
  }
  h.run('render = () => {}; initializeAdminTodo();');
  for (const destination of ['changes', 'open', 'conflicts', 'documents']) h.run(`goAdminTodoSection('${destination}')`);
  assert.deepEqual(visited, ['adminChangeApprovals', 'adminOpenApprovals', 'adminScheduleConflicts', 'adminDocumentCenter']);
  assert.equal(h.run("adminSectionOpenState.get('schedule-conflicts')"), true); assert.equal(h.run('activeTab'), 'admin');
});
test('inline message generation and copies reuse class message/recipient functions', async () => {
  const h = ui(), calls = [], copies = [];
  h.context.api = async (action, payload) => { calls.push({ action, ...plain(payload) }); return { messageText: '생성 문구' }; };
  h.context.copyPlainText = async text => copies.push(text);
  h.run('showToast=()=>{}; state.admin.reminderFixedRecipients=["교장","교감","연구부장"]; initializeAdminTodo();');
  await h.run("makeAdminTodoMessage('today-1','reminder')");
  assert.equal(h.run('adminTodoMessage.text'), '생성 문구');
  assert.match(h.element('adminTodoHost').innerHTML, /교장, 교감, 연구부장, 김교사, 이교사/);
  await h.run("copyMessageRecipients('today-1','reminder')");
  await h.run("makeAdminTodoMessage('today-1','presenterPrep')");
  assert.deepEqual(copies, ['교장, 교감, 연구부장, 김교사, 이교사']);
  assert.deepEqual(calls.map(r => r.type), ['reminder'], 'removed preparation type is not called');
  assert.doesNotMatch(h.element('adminTodoHost').innerHTML, /준비 안내 문구|참관 리마인드 문구/);
  assert.match(h.element('adminTodoHost').innerHTML, /리마인드 문구/);
  h.element('adminTodoMessageText').value = '편집 문구'; await h.run("copyMessage('adminTodoMessageText')"); assert.equal(copies.at(-1), '편집 문구');
  assert.equal(h.element('loading').loading, false);
  h.run('state.actor={isAdmin:false}'); await h.run("makeAdminTodoMessage('today-1','reminder')"); assert.equal(calls.length, 1);
});
test('failed inline generation releases loading and stale account response is ignored', async () => {
  const h = ui(); let message;
  h.context.api = async () => { throw new Error('failed'); }; h.context.showRequestError = e => { message = e.message; };
  await h.run("makeAdminTodoMessage('today-1','reminder')"); assert.equal(message, 'failed'); assert.equal(h.run('adminTodoMessage'), null); assert.equal(h.element('loading').loading, false);
  let resolve; h.context.api = () => new Promise(done => { resolve = done; });
  const promise = h.run("makeAdminTodoMessage('today-1','reminder')");
  h.run('state.actor={isAdmin:false}; initializeAdminTodo();'); resolve({ messageText: 'private message' }); await promise;
  assert.equal(h.run('adminTodoMessage'), null); assert.equal(h.run('renderAdminTodoPopup()'), '');
});

test('real admin render places todo button in header and dialog outside layout', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T15:30:00Z') });
  const db = mockDb(fixture());
  const data = await buildBootstrap(db, await loadState(db), actor);
  const h = frontend(); h.context.bootstrap = data;
  h.run('state=bootstrap; render();');
  const html = h.element('root').innerHTML;
  assert.ok(html.indexOf('id="adminTodoButton"') < html.indexOf('</header>'));
  assert.match(html, /id="adminTodoHost"/); assert.match(html, /role="dialog"/);
  assert.match(html, /id="adminChangeApprovals"/); assert.match(html, /id="adminOpenApprovals"/); assert.match(html, /id="adminScheduleConflicts"/);
});
