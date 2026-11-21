const test = require('node:test');
const assert = require('node:assert/strict');
const { observerContactsForClass, teacherResponse } = require('../api/index')._test;

test('공개수업 진행 교사에게 자신의 참관인 이름과 교과를 제공한다', () => {
  const state = {
    teachers: [
      { id: 'observer-2', name: '오하람', subject_group: '수학' },
      { id: 'observer-1', name: '김철수', subject_group: '국어' }
    ],
    observations: [
      { class_id: 'class-1', observer_id: 'observer-2', status: '확정' },
      { class_id: 'class-1', observer_id: 'observer-1', status: '확정' },
      { class_id: 'class-1', observer_id: 'observer-3', status: '취소' }
    ]
  };

  assert.deepEqual(observerContactsForClass(state, 'class-1'), [
    { name: '김철수', subject: '국어' },
    { name: '오하람', subject: '수학' }
  ]);
});

test('일반 화면에서는 본인 수업의 참관인을 포함해 다른 교사 이름을 모두 마스킹한다', () => {
  const response = teacherResponse({
    actor: { name: '박교사' },
    myOpenClasses: [{ id: 'class-1', teacherName: '박교사', observerContacts: [{ name: '김철수', subject: '국어' }] }],
    availableClasses: [{ teacherName: '오하람' }]
  });

  assert.equal(response.actor.name, '박교*');
  assert.equal(response.myOpenClasses[0].teacherName, '박교*');
  assert.equal(response.availableClasses[0].teacherName, '오하*');
  assert.deepEqual(response.myOpenClasses[0].observerContacts, [{ name: '김철*', subject: '국어' }]);
});
