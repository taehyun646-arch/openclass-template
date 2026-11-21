process.env.APP_URL = 'https://open-class-sample.vercel.app/';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessage } = require('../api/index')._test;
const { frontend } = require('./helpers/frontend');

function stateFor(documents = []) {
  return {
    teachers: [{ id: 't1', name: '김공개' }, { id: 't2', name: '이참관' }, { id: 't3', name: '박취소' }],
    open_classes: [{ id: 'c1', teacher_id: 't1', class_date: '2026-10-15', weekday: '목', period: 3, class_name: '1-2', room: '영어실', status: '확정', semester: 2, capacity: 4 }],
    observations: [{ class_id: 'c1', observer_id: 't2', status: '확정' }, { class_id: 'c1', observer_id: 't3', status: '취소' }],
    documents
  };
}

test('준비 안내에 일정·장소·참관 인원·준비 자료와 위치를 넣는다', () => {
  const message = buildMessage(stateFor(), { type: 'presenterPrep', classId: 'c1' });
  for (const expected of ['김공개 선생님', '10월 15일(목) 3교시', '대상: 1-2', '장소: 영어실', '참관 예정 인원: 1명',
    '수업 지도안: 수업 하루 전까지 제출', '참관록 양식을 참관인에게 배부', '수업 후 수업나눔 협의록을 제출',
    '공개수업 운영 > 공용 양식 자료실', '공개수업 운영 > 자료 제출', 'https://open-class-sample.vercel.app/']) {
    assert.ok(message.includes(expected), expected);
  }
  assert.doesNotMatch(message, /박취소/);
});

test('온라인·수기 확인된 자료만 제출 완료로 표시하고 수기 예정은 완료로 보지 않는다', () => {
  const documents = [
    { class_id: 'c1', submitter_id: 't1', document_type: '지도안', status: '온라인제출' },
    { class_id: 'c1', submitter_id: 't1', document_type: '협의록', status: '수기제출확인' },
    { class_id: 'c1', submitter_id: 't1', document_type: '참관록', status: '수기제출예정' },
    { class_id: 'other', submitter_id: 't1', document_type: '참관록', status: '온라인제출' },
    { class_id: 'c1', submitter_id: 't2', document_type: '참관록', status: '온라인제출' }
  ];
  const message = buildMessage(stateFor(documents), { type: 'presenterPrep', classId: 'c1' });
  assert.match(message, /수업 지도안: 제출 완료/);
  assert.match(message, /수업나눔 협의록: 제출 완료/);
  assert.doesNotMatch(message, /참관록: 제출 완료/);
  assert.doesNotMatch(message, /수업 하루 전까지 제출/);
});

test('참관록도 제출 완료를 표시하되 양식 배부 안내는 유지한다', () => {
  const message = buildMessage(stateFor([{ class_id: 'c1', submitter_id: 't1', document_type: '참관록', status: '온라인제출' }]), { type: 'presenterPrep', classId: 'c1' });
  assert.match(message, /참관록: 제출 완료 · 참관록 양식을 참관인에게 배부/);
});

test('관리자가 입력한 지도안 기한을 반영하고 빈 기한은 기본값을 사용한다', () => {
  assert.match(buildMessage(stateFor(), { type: 'presenterPrep', classId: 'c1', lessonPlanDeadline: '10월 14일 오후 4시까지' }), /10월 14일 오후 4시까지 제출/);
  assert.match(buildMessage(stateFor(), { type: 'presenterPrep', classId: 'c1', lessonPlanDeadline: '  ' }), /수업 하루 전까지 제출/);
});

test('메시지 화면은 준비 안내·기한을 제거하고 준비 사항 포함 리마인드를 표시한다', () => {
  const ui = frontend();
  ui.run("state = { actor: { isAdmin: true }, admin: { allDocuments: [] } };");
  const html = ui.run("renderMessageBuilder([{id:'c1',date:'2026-10-15',period:3,teacherName:'김공개',className:'1-2',room:'영어실'}])");
  assert.match(html, /수업 리마인드\(준비 사항 포함\)/);
  assert.doesNotMatch(html, /presenterPrep|지도안 제출 기한|공개 교사 준비 안내/);
  assert.match(html, /copySelectedMessageRecipients/);
  assert.match(html, /제출자료 리마인드/);
});
