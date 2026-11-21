const test = require('node:test');
const assert = require('node:assert/strict');
const { approveOpenClassesBulk, weekday } = require('../api/index')._test;

const TEST_NOW = new Date('2026-09-01T00:00:00+09:00');

function freezeTime(t) {
  t.mock.timers.enable({ apis: ['Date'], now: TEST_NOW });
}

function pendingClass(id, teacherId, room, date = '2026-09-03') {
  return {
    id,
    teacher_id: teacherId,
    semester: 2,
    status: '승인대기',
    class_date: date,
    weekday: weekday(date),
    period: 1,
    class_name: '1-1',
    room,
    source: '시간표'
  };
}

function stateFor(classes) {
  return {
    open_classes: classes,
    blocked_dates: [],
    weekly_timetables: [],
    timetables: classes.map(item => ({
      id: `tt-${item.id}`,
      teacher_id: item.teacher_id,
      active: true,
      open_class_eligible: true,
      weekday: item.weekday,
      period: item.period,
      class_name: item.class_name
    }))
  };
}

function supabaseMock(classes) {
  const approvedIds = [];
  const queriedIds = [];
  return {
    approvedIds,
    queriedIds,
    rpc: async (name, payload) => {
      assert.equal(name, 'approve_open_class_atomic');
      assert.equal(payload.p_admin_id, 'admin');
      approvedIds.push(payload.p_class_id);
      return { error: null };
    },
    from: table => {
      if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
      assert.equal(table, 'open_classes');
      return {
        select: columns => {
          assert.equal(columns, 'source');
          return {
            eq: (column, id) => {
              assert.equal(column, 'id');
              queriedIds.push(id);
              const cls = classes.find(item => item.id === id);
              assert.ok(cls, '조회한 수업이 테스트 데이터에 있어야 한다');
              return { maybeSingle: async () => ({ data: { source: cls.source }, error: null }) };
            }
          };
        }
      };
    }
  };
}

test('선택한 공개수업 여러 건을 기존 승인 검증으로 모두 승인한다', async t => {
  freezeTime(t);
  const classes = [pendingClass('c1', 't1', '1-1 교실'), pendingClass('c2', 't2', '1-2 교실')];
  const state = stateFor(classes);
  const supabase = supabaseMock(classes);

  const result = await approveOpenClassesBulk(supabase, state, { id: 'admin', name: '관리자' }, { classIds: ['c1', 'c2'] });

  assert.deepEqual(supabase.queriedIds, ['c1', 'c2']);
  assert.deepEqual(supabase.approvedIds, ['c1', 'c2']);
  assert.equal(result.details.approvedCount, 2);
  assert.equal(result.details.failedCount, 0);
  assert.deepEqual(classes.map(item => item.status), ['확정', '확정']);
});

test('일괄 승인 중 장소 충돌 항목은 남기고 검증을 통과한 항목만 승인한다', async t => {
  freezeTime(t);
  const classes = [pendingClass('c1', 't1', '1-1 교실'), pendingClass('c2', 't2', '1-1 교실')];
  const state = stateFor(classes);
  const supabase = supabaseMock(classes);

  const result = await approveOpenClassesBulk(supabase, state, { id: 'admin', name: '관리자' }, { classIds: ['c1', 'c2'] });

  assert.deepEqual(supabase.approvedIds, ['c1']);
  assert.equal(result.details.approvedCount, 1);
  assert.equal(result.details.failedCount, 1);
  assert.match(result.details.failures[0].message, /같은 시간과 장소/);
  assert.deepEqual(classes.map(item => item.status), ['확정', '승인대기']);
});

for (const [label, date, expectedError] of [
  ['마감일인 11월 30일의 일정은 승인한다', '2026-11-30', null],
  ['마감일 다음 날의 일정은 승인하지 않는다', '2026-12-01', /11월 30일까지/],
  ['이미 지난 일정은 승인하지 않는다', '2026-08-31', /지난 공개수업/]
]) {
  test(label, async t => {
    freezeTime(t);
    const classes = [pendingClass('c1', 't1', '1-1 교실', date)];
    const supabase = supabaseMock(classes);
    const approve = () => approveOpenClassesBulk(supabase, stateFor(classes), { id: 'admin', name: '관리자' }, { classIds: ['c1'] });
    if (expectedError) {
      await assert.rejects(approve, expectedError);
      assert.deepEqual(supabase.approvedIds, []);
      assert.deepEqual(supabase.queriedIds, []);
      assert.equal(classes[0].status, '승인대기');
    } else {
      const result = await approve();
      assert.equal(result.details.approvedCount, 1);
      assert.deepEqual(supabase.approvedIds, ['c1']);
      assert.equal(classes[0].status, '확정');
    }
  });
}
