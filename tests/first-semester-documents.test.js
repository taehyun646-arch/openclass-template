const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, checkedCsvDocumentTypes, buildDocumentTasks } = require('../api/index')._test;

test('1학기 CSV의 지도안·참관록·협의록 체크값을 각각 읽는다', () => {
  const rows = parseCsv('성명,참관 희망 교사,지도안,참관록,협의록\n김교사,이교사,TRUE,TRUE,FALSE');
  const header = rows[0];
  assert.deepEqual(checkedCsvDocumentTypes(header, rows[1]), ['지도안', '참관록']);
});

test('체크되지 않은 제출자료는 가져오지 않는다', () => {
  const rows = parseCsv('성명,참관 희망 교사,지도안,참관록,협의록\n김교사,이교사,FALSE,,FALSE');
  assert.deepEqual(checkedCsvDocumentTypes(rows[0], rows[1]), []);
});

test('교사 자료 제출 대상에 1학기와 2학기 확정 수업을 모두 포함한다', () => {
  const actor = { id: 'teacher-1' };
  const classes = [
    { id: 'class-1', teacherId: 'teacher-1', semester: 1, status: '확정' },
    { id: 'class-2', teacherId: 'teacher-1', semester: 2, status: '확정' },
    { id: 'class-3', teacherId: 'teacher-1', semester: 2, status: '승인대기' },
    { id: 'class-4', teacherId: 'teacher-2', semester: 1, status: '확정' }
  ];
  const documents = [{ classId: 'class-1', type: '지도안', status: '수기제출확인', method: '수기' }];
  const tasks = buildDocumentTasks(actor, classes, {}, documents);
  assert.equal(tasks.length, 6);
  assert.deepEqual([...new Set(tasks.map(task => task.classInfo.semester))], [1, 2]);
  assert.equal(tasks.find(task => task.classId === 'class-1' && task.type === '지도안').status, '수기제출확인');
});
