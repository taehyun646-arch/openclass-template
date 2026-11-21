const test = require('node:test');
const assert = require('node:assert/strict');
const { frontend } = require('./helpers/frontend');

function uiAt(instant = '2026-10-11T15:05:00Z') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new Date(instant).getTime(); }
  }
  const ui = frontend({ Date: FixedDate });
  ui.run("state = { actor: { name: '관리자', isAdmin: true }, config: { capacity: 4 }, admin: {} };");
  return ui;
}

const classes = [
  { id: 'future-late', date: '2026-10-14', period: 2 },
  { id: 'past-old', date: '2026-10-09', period: 4 },
  { id: 'today-late', date: '2026-10-12', period: 5 },
  { id: 'future-high-period', date: '2026-10-13', period: 10 },
  { id: 'past-recent', date: '2026-10-11', period: 3 },
  { id: 'future-low-period', date: '2026-10-13', period: 2 },
  { id: 'today-early', date: '2026-10-12', period: 1 }
].map(row => ({ ...row, semester: 2, teacherName: row.id, className: '1-2', room: '영어실', subject: '영어' }));

function render(ui, rows = classes, observations = []) {
  ui.context.classes = rows;
  ui.context.observations = observations;
  return ui.run('renderAdminConfirmedClasses(classes, observations)');
}

function sections(html) {
  const boundary = html.indexOf('<details class="admin-collapsible" data-section-id="past-confirmed-classes"');
  assert.ok(boundary > 0, '지난 일정 영역이 본 일정 다음에 있어야 한다');
  return { remaining: html.slice(0, boundary), past: html.slice(boundary) };
}

function cardIds(html) {
  return [...html.matchAll(/openAdminClassEditor\('([^']+)'\)/g)].map(match => match[1]);
}

test('한국 시간 오늘·미래는 날짜와 교시 오름차순, 과거는 접힌 영역에서 최근 날짜부터 표시한다', () => {
  const ui = uiAt();
  const original = JSON.stringify(classes);
  const html = render(ui);
  const { remaining, past } = sections(html);
  assert.equal(ui.run('todayKst()'), '2026-10-12');
  assert.deepEqual(cardIds(remaining), ['today-early', 'today-late', 'future-low-period', 'future-high-period', 'future-late']);
  assert.deepEqual(cardIds(past), ['past-recent', 'past-old']);
  assert.match(remaining, /총 7건/);
  assert.match(past, /지난 일정 \(2건\)/);
  assert.doesNotMatch(past.match(/^<details[^>]*>/)[0], /\sopen(?:\s|>)/);
  assert.equal(JSON.stringify(classes), original, '정렬은 원본 데이터를 바꾸지 않는다');
});

test('미달 우선에서도 과거를 제외하고 남은 일정만 인원·날짜·교시 순으로 표시한다', () => {
  const ui = uiAt();
  ui.run("adminConfirmedSort = 'shortage';");
  const observations = [
    { classId: 'today-early', observerName: '참관1' },
    { classId: 'today-early', observerName: '참관2' },
    { classId: 'future-low-period', observerName: '참관3' }
  ];
  const { remaining, past } = sections(render(ui, classes, observations));
  assert.deepEqual(cardIds(remaining), ['today-late', 'future-high-period', 'future-late', 'future-low-period', 'today-early']);
  assert.deepEqual(cardIds(past), ['past-recent', 'past-old']);
  assert.match(remaining, /총 7건/);
});

test('KST 자정 경계에서 어제 일정이 지난 일정으로 이동한다', () => {
  const before = sections(render(uiAt('2026-10-11T14:59:59Z')));
  assert.ok(cardIds(before.remaining).includes('past-recent'));
  assert.deepEqual(cardIds(before.past), ['past-old']);
  const after = sections(render(uiAt('2026-10-11T15:00:00Z')));
  assert.ok(!cardIds(after.remaining).includes('past-recent'));
  assert.deepEqual(cardIds(after.past), ['past-recent', 'past-old']);
});

test('지난 일정에도 변경·삭제·정원 조정과 참관 신청 삭제 버튼을 유지하고 펼침 상태를 기억한다', () => {
  const ui = uiAt();
  ui.run("rememberAdminSection('confirmed-classes', true);");
  let { past } = sections(render(ui, classes, [{ id: 'o1', classId: 'past-recent', observerName: '참관교사' }]));
  assert.match(past, /openAdminClassEditor\('past-recent'\)/);
  assert.match(past, /deleteAdminOpenClass\('past-recent','past-recent'\)/);
  assert.match(past, /updateAdminClassCapacity\('past-recent', this.value, 'past-recent'\)/);
  assert.match(past, /deleteAdminObservation\('o1','참관교사','past-recent'\)/);
  assert.doesNotMatch(past.match(/^<details[^>]*>/)[0], /\sopen(?:\s|>)/);
  ui.run("rememberAdminSection('past-confirmed-classes', true);");
  ({ past } = sections(render(ui)));
  assert.match(past.match(/^<details[^>]*>/)[0], /\sopen\s/);
});

test('전부 과거이거나 과거가 없는 경우에도 총 건수와 빈 상태를 올바르게 표시한다', () => {
  const ui = uiAt();
  const onlyPast = render(ui, classes.filter(row => row.id.startsWith('past')));
  assert.match(onlyPast, /총 2건/);
  assert.match(onlyPast, /오늘 이후 확정된 공개수업이 없습니다/);
  assert.match(onlyPast, /지난 일정 \(2건\)/);
  const noPast = render(ui, classes.filter(row => !row.id.startsWith('past')));
  assert.match(noPast, /총 5건/);
  assert.doesNotMatch(noPast, /data-section-id="past-confirmed-classes"/);
  const empty = render(ui, []);
  assert.match(empty, /총 0건/);
  assert.match(empty, /확정된 2학기 공개수업이 없습니다/);
});
