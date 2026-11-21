const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPaperDocumentRecord } = require('../api/index')._test;

test('관리자가 미신청 자료를 직접 수기 접수 기록으로 만들 수 있다', () => {
  const now = '2026-08-25T03:04:05.000Z';
  const row = adminPaperDocumentRecord(
    { id: 'class-1', teacher_id: 'teacher-1' },
    '지도안',
    { id: 'admin-1' },
    now
  );

  assert.deepEqual(row, {
    class_id: 'class-1',
    document_type: '지도안',
    submitter_id: 'teacher-1',
    submission_method: '수기',
    file_name: '',
    file_path: '',
    status: '수기제출확인',
    submitted_at: now,
    confirmed_by: 'admin-1',
    confirmed_at: now,
    note: '관리자 직접 수기 접수'
  });
});
