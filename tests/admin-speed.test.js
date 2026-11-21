const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const api = require('../api/index')._test;
const { mockDb, fixture, actor } = require('./helpers/admin-db');
function freeze(t) { t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T15:30:00Z') }); }
function oldApi() {
  const filename = path.join(__dirname, '../api/index.js');
  const c = vm.createContext({ require: createRequire(filename), module: { exports: {} }, process, console, Buffer, URL, Date });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + '\n' + require('./helpers/legacy-admin'), c, { filename });
  return c.module.exports._test;
}
const plain = v => JSON.parse(JSON.stringify(v));
test('parallel pages retain ordering at empty/exact-page boundaries', async () => {
  for (const count of [0, 1, 1000, 1001, 2500]) {
    const rows = Array.from({ length: count }, (_, i) => ({ id: String(count - i).padStart(5, '0') }));
    const db = mockDb({ teachers: rows });
    assert.deepEqual(await api.fetchAllRows(db, 'teachers'), rows.sort((a, b) => a.id.localeCompare(b.id)));
    assert.equal(db.calls.length, 1 + Math.ceil(count / 1000));
    if (count > 1000) assert.ok(db.metrics().peak >= 2);
  }
  assert.deepEqual(await api.fetchAllRows(mockDb({ app_settings: [{ setting_key: 'z' }, { setting_key: 'a' }] }), 'app_settings'), [{ setting_key: 'a' }, { setting_key: 'z' }]);
});
test('count/page failures reject incomplete state', async () => {
  await assert.rejects(api.fetchAllRows({ from: () => ({ select: () => Promise.resolve({ error: { message: 'count failed' } }) }) }, 'teachers'), /count failed/);
  await assert.rejects(api.fetchAllRows({ from: () => ({ select: () => Promise.resolve({ count: null }) }) }, 'teachers'), /전체 건수/);
  const db = { from: () => ({ select: (_c, o) => o ? Promise.resolve({ count: 1 }) : { order: () => ({ range: () => Promise.resolve({ error: { message: 'page failed' } }) }) } }) };
  await assert.rejects(api.fetchAllRows(db, 'teachers'), /page failed/);
});
test('KST last-Monday cutoff preserves future conflicts and historical reports', async t => {
  freeze(t); const seed = fixture(), old = oldApi();
  const before = await old.loadState(mockDb(seed)), after = await api.loadState(mockDb(seed));
  assert.equal(before.weekly_timetables.length, 8873); assert.equal(after.weekly_timetables.length, 3000);
  assert.ok(after.weekly_timetables.every(r => r.lesson_date >= '2026-10-05'));
  assert.deepEqual(api.buildScheduleConflicts(after), plain(old.buildScheduleConflicts(before)));
  assert.equal(api.buildScheduleConflicts(after).length, 2);
  assert.ok(api.buildScheduleConflicts(after).every(r => r.date >= '2026-10-12'));
  const a = await api.buildBootstrap(mockDb(seed), after, actor), b = await old.buildBootstrap(mockDb(seed), before, actor);
  assert.deepEqual(a.admin.stats, plain(b.admin.stats));
  assert.deepEqual(plain(a.admin.annualTeacherStatuses), plain(b.admin.annualTeacherStatuses));
});
test('second reconciliation skips writes; changed/resolved/revived conflicts write only needed rows', async t => {
  freeze(t); const db = mockDb(fixture()), state = await api.loadState(db);
  await api.buildBootstrap(db, state, actor); assert.equal(db.metrics().upserts, 1);
  db.reset(); await api.buildBootstrap(db, state, actor); assert.equal(db.metrics().upserts, 0);
  const first = db.tables.notifications[0]; first.read_at = 'read'; first.metadata = Object.fromEntries(Object.entries(first.metadata).reverse());
  state.notifications = structuredClone(db.tables.notifications); db.reset();
  await api.reconcileScheduleConflicts(db, state, actor); assert.equal(db.metrics().upserts, 0);
  first.message = 'stale'; state.notifications = structuredClone(db.tables.notifications); db.reset();
  await api.buildBootstrap(db, state, actor); assert.equal(db.calls.find(c => c.operation === 'upsert').written, 1); assert.equal(first.read_at, 'read');
  state.observations = []; db.reset(); await api.buildBootstrap(db, state, actor);
  assert.equal(db.calls.find(c => c.operation === 'update').written, 2);
  db.reset(); await api.buildBootstrap(db, state, actor); assert.equal(db.calls.filter(c => c.operation === 'update').length, 0);
  state.observations = fixture().observations; db.reset(); await api.buildBootstrap(db, state, actor);
  assert.equal(db.calls.find(c => c.operation === 'upsert').written, 2); assert.equal(first.read_at, null);
});
test('individual/bulk approval and schedule-change validation unchanged by filtering', async t => {
  freeze(t);
  for (const [name, payload, status] of [
    ['processOpenClass', { classId: 'class-1', approve: true }, '승인대기'],
    ['approveOpenClassesBulk', { classIds: ['class-1', 'class-2'] }, '승인대기'],
    ['adminUpdateOpenClass', { classId: 'class-1', date: '2026-10-19', period: 1, subject: '영어', className: '1-1', room: '영어실' }, '확정'],
    ['processChange', { changeId: 'change', approve: true }, '확정'],
    ['processOpenClass', { classId: 'class-0', approve: true }, '승인대기']
  ]) {
    const seed = fixture(); seed.open_classes.forEach(r => { r.status = status; r.source = '시간표'; }); seed.open_classes[2].room = '별관';
    const old = oldApi(), beforeDb = mockDb(seed), afterDb = mockDb(seed);
    const before = await old.loadState(beforeDb), after = await api.loadState(afterDb); beforeDb.reset(); afterDb.reset();
    const execute = async (fn, db, state) => { try { return plain(await fn(db, state, actor, payload, true)); } catch (e) { return { error: e.message }; } };
    const actual = await execute(api[name], afterDb, after);
    assert.deepEqual(actual, await execute(old[name], beforeDb, before), name);
    if (payload.classId === 'class-0') assert.match(actual.error, /지난 공개수업/);
    else assert.equal(actual.error, undefined, name + ' must succeed');
    assert.deepEqual(afterDb.calls.map(plain), beforeDb.calls.map(plain), name + ' DB actions');
  }
});
test('admin bootstrap before/after mock measurement', async t => {
  freeze(t); const seed = fixture(), setup = mockDb(seed);
  await api.buildBootstrap(setup, await api.loadState(setup), actor); seed.notifications = structuredClone(setup.tables.notifications);
  const old = oldApi(), a = mockDb(seed), b = mockDb(seed);
  await old.buildBootstrap(a, await old.loadState(a), actor); await api.buildBootstrap(b, await api.loadState(b), actor);
  t.diagnostic(JSON.stringify({ fixture: '8873 weekly rows / 9 weeks; 3000 retained', before: a.metrics(), after: b.metrics() }));
  assert.ok(b.metrics().rows < a.metrics().rows); assert.equal(a.metrics().upserts, 1); assert.equal(b.metrics().upserts, 0);
  assert.equal(a.calls.filter(c => c.table === 'weekly_timetables').length, 9); assert.equal(b.calls.filter(c => c.table === 'weekly_timetables').length, 4);
});
