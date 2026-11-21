const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTimetableRoom, mapTimetable } = require('../api/index')._test;

test('시간표 장소가 비어 있으면 학급명을 교실명으로 변환한다', () => {
  assert.equal(resolveTimetableRoom('', '3-8'), '3-8 교실');
  assert.equal(resolveTimetableRoom('', '3학년 8반'), '3-8 교실');
  assert.equal(resolveTimetableRoom('3-8', '3-8'), '3-8 교실');
});

test('특별실 장소는 그대로 유지하고 시간표 응답에도 기본 교실을 반영한다', () => {
  assert.equal(resolveTimetableRoom('음악실', '3-8'), '음악실');
  assert.deepEqual(mapTimetable({ id: 't1', weekday: '목', period: 7, class_name: '3-8', room: '', subject: '가정' }), {
    id: 't1', weekday: '목', period: 7, className: '3-8', room: '3-8 교실', subject: '가정'
  });
});
