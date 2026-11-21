const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkbook, subjectCategory, columnLetter } = require('../api/export')._test;

test('관리자 엑셀 파일은 주요 현황을 여러 시트로 만든다', async () => {
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const observerId = '22222222-2222-4222-8222-222222222222';
  const classId = '33333333-3333-4333-8333-333333333333';
  const state = {
    teachers: [
      { id: teacherId, name: '김영현', subject_group: '영어', role: '일반교사', second_semester_target: true, active: true },
      { id: observerId, name: '구지연', subject_group: '가정', role: '일반교사', second_semester_target: true, active: true }
    ],
    open_classes: [{ id: classId, teacher_id: teacherId, class_date: '2026-09-02', weekday: '수', period: 1, subject: '영어', class_name: '1-6', room: '1-6 교실', topic: '읽기', capacity: 4, status: '확정', semester: 2, submitted_at: '2026-08-24T01:00:00Z', admin_note: '' }],
    observations: [{ id: '44444444-4444-4444-8444-444444444444', class_id: classId, observer_id: observerId, status: '확정', attendance: '미확인', semester: 2, applied_at: '2026-08-24T02:00:00Z', note: '' }],
    documents: [],
    change_requests: [],
    app_settings: [{ setting_key: 'school_year', setting_value: '2026' }]
  };

  const workbook = buildWorkbook(state);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    '관리자 요약', '정보공시용 수업공개계획', '공개수업 신청·일정', '참관 신청·출석', '교사별 연간 이행', '자료 제출 현황', '일정 변경 요청'
  ]);
  const disclosure = workbook.getWorksheet('정보공시용 수업공개계획');
  assert.equal(disclosure.columnCount, 17);
  assert.equal(disclosure.getCell('A1').value, '교과군');
  assert.equal(disclosure.getCell('D1').value, '1학기 수업공개');
  assert.equal(disclosure.getCell('E1').value, '2학기 수업공개일');
  assert.equal(disclosure.getCell('K1').value, '참관 희망 교사');
  assert.equal(disclosure.getCell('A2').isMerged, true);
  assert.equal(disclosure.getCell('C3').value, '구○○');
  assert.equal(disclosure.getCell('C4').value, '김○○');
  assert.equal(disclosure.getCell('E4').value, 9);
  assert.equal(disclosure.getCell('F4').value, 2);
  assert.equal(disclosure.getCell('K4').value, '구○○');
  assert.equal(workbook.getWorksheet('자료 제출 현황').rowCount, 7);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), 'PK');

  const filteredWorkbook = buildWorkbook(state, { report: 'annual', filter: 'second_open_applied', sort: 'name' });
  assert.deepEqual(filteredWorkbook.worksheets.map(sheet => sheet.name), ['교사별 연간 이행']);
  const filteredAnnual = filteredWorkbook.getWorksheet('교사별 연간 이행');
  assert.equal(filteredAnnual.rowCount, 5);
  assert.equal(filteredAnnual.getCell('C5').value, '김영현');

  const disclosureOnly = buildWorkbook(state, { report: 'disclosure', filter: 'all', sort: 'name' });
  assert.deepEqual(disclosureOnly.worksheets.map(sheet => sheet.name), ['정보공시용 수업공개계획']);
  assert.equal(disclosureOnly.getWorksheet('정보공시용 수업공개계획').columnCount, 17);
});

test('교과군과 엑셀 열 문자를 올바르게 계산한다', () => {
  assert.equal(subjectCategory('영어'), '외국어');
  assert.equal(subjectCategory('기술·가정'), '생활');
  assert.equal(columnLetter(18), 'R');
  assert.equal(columnLetter(28), 'AB');
});

test('정보공시용 시트는 화면의 이름순 선택과 관계없이 교과군·교과·성명 순서를 유지한다', () => {
  const state = {
    teachers: [
      { id: '11111111-1111-4111-8111-111111111111', name: '강영희', subject_group: '영어', role: '일반교사', second_semester_target: true, active: true },
      { id: '22222222-2222-4222-8222-222222222222', name: '차민수', subject_group: '국어', role: '일반교사', second_semester_target: true, active: true },
      { id: '33333333-3333-4333-8333-333333333333', name: '가영희', subject_group: '역사', role: '일반교사', second_semester_target: true, active: true },
      { id: '44444444-4444-4444-8444-444444444444', name: '하민수', subject_group: '도덕', role: '일반교사', second_semester_target: true, active: true }
    ],
    open_classes: [], observations: [], documents: [], change_requests: [], app_settings: []
  };

  const workbook = buildWorkbook(state, { report: 'disclosure', filter: 'all', sort: 'name' });
  const sheet = workbook.getWorksheet('정보공시용 수업공개계획');
  assert.deepEqual([3, 4, 5, 6].map(row => sheet.getCell(row, 2).value), ['국어', '도덕', '역사', '영어']);
  assert.deepEqual([3, 4, 5, 6].map(row => sheet.getCell(row, 3).value), ['차○○', '하○○', '가○○', '강○○']);
});

test('자료 제출 현황 엑셀은 1학기 공개수업도 제출 대상으로 표시한다', () => {
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const classId = '22222222-2222-4222-8222-222222222222';
  const state = {
    teachers: [{ id: teacherId, name: '김교사', subject_group: '국어', role: '일반교사', second_semester_target: false, active: true }],
    open_classes: [{ id: classId, teacher_id: teacherId, class_date: '2026-04-01', weekday: '수', period: 2, subject: '국어', class_name: '3-1', room: '3-1 교실', status: '확정', semester: 1 }],
    observations: [],
    documents: [{ id: '33333333-3333-4333-8333-333333333333', class_id: classId, submitter_id: teacherId, document_type: '지도안', submission_method: '수기', status: '수기제출확인', submitted_at: '2026-04-01T03:00:00Z', file_name: '', file_path: '', note: '1학기 CSV 제출 확인' }],
    change_requests: [], app_settings: []
  };

  const workbook = buildWorkbook(state, { report: 'documents', filter: 'all', sort: 'name' });
  const sheet = workbook.getWorksheet('자료 제출 현황');
  assert.equal(sheet.getCell('A5').value, '1학기');
  assert.equal(sheet.getCell('G5').value, '수업 지도안');
  assert.equal(sheet.getCell('H5').value, '수기제출확인');
  assert.equal(sheet.rowCount, 7);
});
