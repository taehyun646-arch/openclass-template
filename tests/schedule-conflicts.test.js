const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScheduleConflicts, classIdentity, sameClassIdentity, weekday } = require('../api/index')._test;

test('학급명 표기 방식이 달라도 같은 학급으로 정규화한다', () => {
  assert.equal(classIdentity('3학년 12반'), '3-12');
  assert.equal(classIdentity('3-12'), '3-12');
  assert.equal(classIdentity('3-12 교실'), '3-12');
  assert.equal(classIdentity(' 3학년 12반 교실 '), '3-12');
  assert.equal(sameClassIdentity('3학년 12반', '3-12'), true);
  assert.equal(sameClassIdentity('3-12 교실', '3학년 12반'), true);
  assert.equal(sameClassIdentity('3학년 12반', '3-11'), false);
});

test('확정 수업과 참관 일정이 새 시간표와 충돌하면 각각 표시한다', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T00:00:00+09:00') });
  const date = '2026-09-02';
  const day = weekday(date);
  const state = {
    teachers: [
      { id: 'presenter', name: '김교사', subject_group: '영어' },
      { id: 'observer', name: '이교사', subject_group: '수학' }
    ],
    timetables: [
      { id: 'changed', teacher_id: 'presenter', weekday: day, period: 2, class_name: '1-2', active: true, open_class_eligible: true },
      { id: 'observer-class', teacher_id: 'observer', weekday: day, period: 2, class_name: '2-1', active: true, open_class_eligible: true }
    ],
    blocked_dates: [],
    open_classes: [
      { id: 'class-1', teacher_id: 'presenter', class_date: date, weekday: day, period: 2, subject: '영어', class_name: '1-1', room: '영어실', topic: '', capacity: 4, status: '확정', semester: 2 }
    ],
    observations: [
      { id: 'obs-1', class_id: 'class-1', observer_id: 'observer', status: '확정', attendance: '미확인', semester: 2 }
    ]
  };

  const conflicts = buildScheduleConflicts(state);
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.some(item => item.type === '공개수업시간표충돌' && item.teacherId === 'presenter'));
  assert.ok(conflicts.some(item => item.type === '참관시간표충돌' && item.teacherId === 'observer'));
});

test('확정 일정과 시간표가 맞으면 충돌을 만들지 않는다', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T00:00:00+09:00') });
  const date = '2026-09-02';
  const day = weekday(date);
  const state = {
    teachers: [{ id: 'presenter', name: '김교사', subject_group: '영어' }],
    timetables: [{ id: 'same', teacher_id: 'presenter', weekday: day, period: 2, class_name: '1-1', active: true, open_class_eligible: true }],
    blocked_dates: [],
    open_classes: [{ id: 'class-1', teacher_id: 'presenter', class_date: date, weekday: day, period: 2, subject: '영어', class_name: '1-1', room: '영어실', topic: '', capacity: 4, status: '확정', semester: 2 }],
    observations: []
  };

  assert.deepEqual(buildScheduleConflicts(state), []);
});

test('기존 신청의 한글 학급명과 컴시간의 축약 학급명은 충돌로 보지 않는다', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T00:00:00+09:00') });
  const date = '2026-09-02';
  const day = weekday(date);
  const state = {
    teachers: [{ id: 'presenter', name: '김교사', subject_group: '영어' }],
    timetables: [{ id: 'synced', teacher_id: 'presenter', weekday: day, period: 3, class_name: '3-12', active: true, open_class_eligible: true }],
    blocked_dates: [],
    open_classes: [{ id: 'class-1', teacher_id: 'presenter', class_date: date, weekday: day, period: 3, subject: '영어', class_name: '3학년 12반', room: '3-12 교실', topic: '', capacity: 4, status: '확정', semester: 2 }],
    observations: []
  };

  assert.deepEqual(buildScheduleConflicts(state), []);
});
