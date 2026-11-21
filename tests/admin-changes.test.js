const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAdminData } = require('../api/index')._test;

test('관리자 일정 변경 승인 목록에 신청 교사와 교과를 포함한다', () => {
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const state = {
    teachers: [{ id: teacherId, name: '정하늘', subject_group: '수학', role: '일반교사', active: true, second_semester_target: true }],
    open_classes: [{
      id: '33333333-3333-4333-8333-333333333333', teacher_id: teacherId, semester: 2, status: '승인대기',
      class_date: '2026-09-15', weekday: '화', period: 6, subject: '수학', class_name: '2-8', room: '2-8 교실',
      capacity: 4, submitted_at: '2026-08-26T02:30:00Z', admin_note: '', source: '앱'
    }],
    observations: [],
    timetables: [],
    weekly_timetables: [],
    blocked_dates: [],
    documents: [],
    app_settings: [],
    change_requests: [{
      id: '22222222-2222-4222-8222-222222222222',
      class_id: '33333333-3333-4333-8333-333333333333',
      requester_id: teacherId,
      original_date: '2026-09-15', original_period: 6, original_class_name: '2-8', original_room: '2-8 교실',
      requested_date: '2026-09-22', requested_weekday: '화', requested_period: 4, requested_class_name: '3-1', requested_room: '3-1 교실', requested_subject: '수학',
      reason: '일정 변경', status: '승인대기', requested_at: '2026-08-26T03:00:00Z', admin_note: '', affected_observers: ''
    }]
  };

  const result = buildAdminData(state, [{
    id: '33333333-3333-4333-8333-333333333333', teacherId, teacherName: '정하늘', semester: 2, status: '승인대기',
    date: '2026-09-15', weekday: '화', period: 6, subject: '수학', className: '2-8', room: '2-8 교실',
    capacity: 4, appliedAt: '2026-08-26-11:30', adminNote: '', source: '앱'
  }]);

  assert.equal(result.pendingChanges.length, 1);
  assert.equal(result.pendingChanges[0].requesterName, '정하늘');
  assert.equal(result.pendingChanges[0].requesterSubject, '수학');
  assert.match(result.pendingChanges[0].requestedAt, /2026-08-26/);
  assert.match(result.pendingChanges[0].requestedAt, /12:00/);
  assert.equal(result.pendingClasses.length, 1);
  assert.match(result.pendingClasses[0].appliedAt, /2026-08-26/);
  assert.match(result.pendingClasses[0].appliedAt, /11:30/);
});
