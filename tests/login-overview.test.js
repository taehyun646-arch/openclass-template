const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPublicTeacherProgress, buildPublicApplicationOverview } = require('../api/index')._test;

test('로그인 현황판은 완료 실적과 관리자 수정값을 반영해 남은 교사만 마스킹한다', () => {
  const teachers = [
    { id: 'teacher-a', name: '김영현', subject_group: '영어' },
    { id: 'teacher-b', name: '박지민', subject_group: '수학' },
    { id: 'teacher-c', name: '이서연', subject_group: '과학' }
  ];
  const classes = [
    { id: 'class-a', teacher_id: 'teacher-a', semester: 1, class_date: '2026-05-01', status: '확정' }
  ];
  const observations = [
    { class_id: 'class-a', observer_id: 'teacher-a', semester: 1, status: '확정', attendance: '참석' },
    { class_id: 'class-a', observer_id: 'teacher-a', semester: 2, status: '확정', attendance: '참석' },
    { class_id: 'class-a', observer_id: 'teacher-b', semester: 1, status: '확정', attendance: '참석' }
  ];
  const settings = [{
    setting_key: 'annual_status_overrides',
    setting_value: JSON.stringify({
      'teacher-c': { firstOpenCompleted: true, firstObservationCompleted: 1, secondObservationCompleted: 1 }
    })
  }];

  const result = buildPublicTeacherProgress(teachers, classes, observations, settings);

  assert.deepEqual(result.remainingOpenTeachers, [{ displayName: '박지*', subject: '수학' }]);
  assert.deepEqual(result.remainingObservationTeachers, [{ displayName: '박지*', subject: '수학', remaining: 1 }]);
  assert.deepEqual(result.completedTeachers, [
    { displayName: '이서*', subject: '과학' },
    { displayName: '김영*', subject: '영어' }
  ]);
});

test('로그인 신청 현황은 공개수업 대상자의 신청 여부와 필요한 참관 신청 횟수를 마스킹해 구분한다', () => {
  const teachers = [
    { id: 'teacher-a', name: '김영현', subject_group: '영어', second_semester_target: true },
    { id: 'teacher-b', name: '박지민', subject_group: '수학', second_semester_target: true },
    { id: 'teacher-c', name: '이서연', subject_group: '과학', second_semester_target: false }
  ];
  const classes = [
    { id: 'class-a', teacher_id: 'teacher-a', semester: 2, class_date: '2026-09-01', status: '승인대기' },
    { id: 'class-other', teacher_id: 'teacher-c', semester: 2, class_date: '2026-09-02', status: '확정' }
  ];
  const observations = [
    { class_id: 'class-a', observer_id: 'teacher-a', semester: 1, status: '확정', attendance: '참석' },
    { class_id: 'class-other', observer_id: 'teacher-a', semester: 2, status: '확정', attendance: '미확인' },
    { class_id: 'class-a', observer_id: 'teacher-c', semester: 1, status: '확정', attendance: '참석' },
    { class_id: 'class-other', observer_id: 'teacher-c', semester: 2, status: '확정', attendance: '참석' }
  ];

  const result = buildPublicApplicationOverview(teachers, classes, observations, []);

  assert.deepEqual(result.open.applied, [{ displayName: '김영*', subject: '영어' }]);
  assert.deepEqual(result.open.missing, [{ displayName: '박지*', subject: '수학' }]);
  assert.deepEqual(result.observation.ready, [
    { displayName: '이서*', subject: '과학', required: 1, applied: 1 },
    { displayName: '김영*', subject: '영어', required: 1, applied: 1 }
  ]);
  assert.deepEqual(result.observation.missing, [{ displayName: '박지*', subject: '수학', remaining: 2, required: 2, applied: 0 }]);
});

test('1학기 참관 2회 완료 교사와 순회교사는 2학기 참관 신청 대상에서 제외한다', () => {
  const teachers = [
    { id: 'completed', name: '김완료', subject_group: '영어' },
    { id: 'exempt', name: '이순회', subject_group: '수학', exclusion_reason: '순회교사' },
    { id: 'absent', name: '박미참', subject_group: '과학' }
  ];
  const classes = [{ id: 'second-class', semester: 2, status: '확정' }];
  const observations = [{ class_id: 'second-class', observer_id: 'absent', semester: 2, status: '확정', attendance: '불참' }];
  const settings = [{ setting_key: 'annual_status_overrides', setting_value: JSON.stringify({ completed: { firstObservationCompleted: 2 } }) }];
  const result = buildPublicApplicationOverview(teachers, classes, observations, settings);
  assert.deepEqual(result.observation.ready, []);
  assert.deepEqual(result.observation.missing, [{ displayName: '박미*', subject: '과학', remaining: 2, required: 2, applied: 0 }]);
});
