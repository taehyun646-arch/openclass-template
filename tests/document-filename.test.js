const test = require('node:test');
const assert = require('node:assert/strict');
const { standardDocumentFileName, signedDownloadUrl, documentSubmissionNote } = require('../api/index')._test;

test('제출 자료 이름을 수업 정보 기준으로 통일한다', () => {
  const state = { app_settings: [{ setting_key: 'school_year', setting_value: '2026' }] };
  const cls = { class_date: '2026-09-02', period: 1, semester: 2 };
  assert.equal(
    standardDocumentFileName(state, cls, '김영현', '지도안', '제멋대로 작성한 이름.PDF'),
    '2026_2학기_김영현_20260902_1교시_수업지도안.pdf'
  );
  assert.equal(
    standardDocumentFileName(state, cls, '김영현', '협의록', '회의록.hwpx'),
    '2026_2학기_김영현_20260902_1교시_수업나눔협의록.hwpx'
  );
});

test('다운로드 링크와 제출 기록에 표준 이름과 원본 이름을 남긴다', () => {
  const fileName = '2026_2학기_김영현_20260902_1교시_참관록.hwp';
  const url = signedDownloadUrl('https://example.supabase.co/storage/signed/file?token=abc', fileName);
  assert.match(url, /&download=2026_2%ED%95%99%EA%B8%B0_/);
  assert.equal(documentSubmissionNote('', '아무이름.hwp'), '원본 파일명: 아무이름.hwp');
});
