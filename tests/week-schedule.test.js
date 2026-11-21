const test = require('node:test');
const assert = require('node:assert/strict');
const { currentAndNextWeekRange } = require('../api/index')._test;

test('로그인 일정은 이번 주 월요일부터 다음 주 일요일까지 계산한다', () => {
  assert.deepEqual(currentAndNextWeekRange('2026-08-25'), {
    start: '2026-08-24',
    end: '2026-09-06'
  });
});

test('기준일이 일요일이어도 같은 주 월요일부터 계산한다', () => {
  assert.deepEqual(currentAndNextWeekRange('2026-08-30'), {
    start: '2026-08-24',
    end: '2026-09-06'
  });
});
