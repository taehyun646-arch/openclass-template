const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClassReminderMessage, buildMessage, templateFiles } = require('../api/index')._test;

test('선택한 공개수업의 당일 리마인드 문구를 만든다', () => {
  const cls = {
    date: '2026-09-14', period: 5, className: '1학년 3반', room: '1-3 교실', teacherName: '배지호'
  };
  const message = buildClassReminderMessage(cls, ['한도윤', '오세린'], '2026-09-14');
  assert.match(message, /오늘\(9\.14\.\)/);
  assert.match(message, /\(1학년 3반\) 5교시 배지호 선생님/);
  assert.match(message, /장소: 1-3 교실/);
  assert.match(message, /참관 예정: 한도윤, 오세린 선생님/);
  const preparation = message.split('[준비 사항]')[1].split('\n\n감사합니다.')[0];
  assert.equal(preparation, '\n - 수업공개 하시는 선생님: 참관 선생님들이 지도안을 직접 조회할 수 없으니, 수업 지도안과 참관록을 참관 인원(2명)에 여유분 1부를 더해 3부씩 인쇄하여 수업 시작 전 1-3 교실에 비치해 주시면 감사하겠습니다.\n - 참관 선생님: 간단한 필기구를 지참하여 참관 후 참관록을 수업공개 선생님께 제출 부탁드립니다. 지도안을 미리 보고 싶으시면 수업공개 선생님께 문의 바랍니다.');
  assert.doesNotMatch(preparation, /배지호/);
  assert.doesNotMatch(message, /미제출|제출 완료/);
});

test('선택한 교사의 실제 미제출 자료만 리마인드 문구에 넣는다', () => {
  const state = {
    teachers: [{ id: 'teacher-1', name: '정하늘' }],
    open_classes: [{ id: 'class-1', teacher_id: 'teacher-1', class_date: '2026-09-14', weekday: '월', period: 5, class_name: '1학년 3반', room: '1-3 교실', status: '확정', semester: 2, capacity: 4 }],
    observations: [],
    documents: [{ class_id: 'class-1', submitter_id: 'teacher-1', document_type: '지도안' }]
  };
  const message = buildMessage(state, { type: 'documentReminder', classId: 'class-1' });
  assert.match(message, /정하늘 선생님은 현재 협의록, 참관록 미제출 상태/);
  assert.doesNotMatch(message, /지도안, 협의록/);
  assert.match(message, /공개수업 운영 > 자료 제출/);
});

test('공용 양식 설정은 허용된 자료 유형과 경로만 노출한다', () => {
  const rows = [
    {
      setting_key: 'operation_template_지도안',
      setting_value: JSON.stringify({
        type: '지도안', fileName: '수업지도안_양식.hwp', filePath: 'templates/지도안/123.hwp', uploadedAt: '2026-08-25T00:00:00.000Z', uploadedBy: '관리자'
      })
    },
    {
      setting_key: 'operation_template_협의록',
      setting_value: JSON.stringify({ type: '협의록', fileName: '잘못된파일.hwp', filePath: 'documents/private.hwp' })
    }
  ];
  const files = templateFiles(rows);
  assert.equal(files.length, 1);
  assert.equal(files[0].type, '지도안');
  assert.equal(files[0].filePath, 'templates/지도안/123.hwp');
});
