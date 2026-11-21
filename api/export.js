const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('../lib/auth');

const DOCUMENT_TYPES = ['지도안', '협의록', '참관록'];
const CATEGORY_ORDER = ['국어', '사회', '수학', '과학', '생활', '체육', '예술', '외국어', '특수', '기타'];
const REPORT_CONFIG = Object.freeze({
  disclosure: { sheet: '정보공시용 수업공개계획', file: '정보공시용_수업공개계획', add: addDisclosureSheet },
  open_classes: { sheet: '공개수업 신청·일정', file: '공개수업_신청일정', add: addOpenClassesSheet },
  observations: { sheet: '참관 신청·출석', file: '참관_신청출석', add: addObservationsSheet },
  annual: { sheet: '교사별 연간 이행', file: '교사별_연간이행현황', add: addAnnualStatusSheet },
  documents: { sheet: '자료 제출 현황', file: '자료_제출현황', add: addDocumentsSheet },
  changes: { sheet: '일정 변경 요청', file: '일정_변경요청', add: addChangesSheet }
});
const STATUS_FILTERS = new Set(['all', 'complete', 'first_open_complete', 'second_open_applied', 'annual_open_complete', 'observation_complete', 'open_incomplete', 'observation_incomplete']);
const STATUS_SORTS = new Set(['name', 'open_incomplete', 'observation_incomplete', 'first_observation_desc', 'second_observation_desc']);
const COLORS = {
  navy: '173F5F', blue: '2474E5', paleBlue: 'EAF3FF', paleGray: 'F3F6F9',
  border: 'AEBBC8', white: 'FFFFFF', warning: 'FFF2CC', red: 'C62828', green: '1F7A45'
};

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ ok: false, message: 'GET 요청만 사용할 수 있습니다.' });

  try {
    const authHeader = String(request.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!verifyAdminToken(token)) return response.status(401).json({ ok: false, message: '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.' });

    const report = normalizeReport(request.query && request.query.report);
    const filter = normalizeStatusFilter(request.query && request.query.filter);
    const sort = normalizeStatusSort(request.query && request.query.sort);
    const state = await loadExportState(supabaseClient());
    const workbook = buildWorkbook(state, { report, filter, sort });
    const buffer = await workbook.xlsx.writeBuffer();
    const schoolYear = settingsMap(state.app_settings).school_year || new Date().getFullYear();
    const fileName = `${schoolYear}학년도_${REPORT_CONFIG[report].file}_${todayKey().replaceAll('-', '')}.xlsx`;

    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="open-class-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return response.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('admin workbook export failed', error);
    return response.status(500).json({ ok: false, message: `엑셀 파일을 만들지 못했습니다: ${clean(error && error.message) || '알 수 없는 오류'}` });
  }
};

function supabaseClient() {
  const url = clean(process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('Vercel의 Supabase 연결 정보를 확인해 주세요.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function loadExportState(supabase) {
  const tables = ['teachers', 'open_classes', 'observations', 'documents', 'change_requests', 'app_settings'];
  const results = await Promise.all(tables.map(table => fetchAllRows(supabase, table)));
  return Object.fromEntries(tables.map((table, index) => [table, results[index]]));
}

async function fetchAllRows(supabase, table) {
  const rows = [];
  const orderColumn = table === 'app_settings' ? 'setting_key' : 'id';
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from(table).select('*').order(orderColumn).range(from, from + 999);
    if (result.error) throw new Error(`${table} 데이터를 불러오지 못했습니다: ${result.error.message}`);
    const page = result.data || [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function buildWorkbook(state, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settingsMap(state.app_settings).app_name || '수업공개·참관 관리 웹앱';
  workbook.lastModifiedBy = '관리자';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const model = buildExportModel(state);
  const report = options.report || 'all';
  const filteredStatuses = filterAndSortAnnualStatuses(model.annualStatuses, options.filter, options.sort);
  const filteredTeacherIds = new Set(filteredStatuses.map(row => row.id));
  if (report === 'all') {
    addSummarySheet(workbook, model);
    Object.values(REPORT_CONFIG).forEach(config => config.add(workbook, model, filteredStatuses, filteredTeacherIds));
  } else {
    const config = REPORT_CONFIG[normalizeReport(report)];
    config.add(workbook, model, filteredStatuses, filteredTeacherIds);
  }
  return workbook;
}

function buildExportModel(state) {
  const settings = settingsMap(state.app_settings);
  const teachers = state.teachers.filter(row => row.active && row.role !== '관리자');
  const teacherById = new Map(state.teachers.map(row => [row.id, row]));
  const classes = state.open_classes.map(row => ({ ...row, teacher: teacherById.get(row.teacher_id) || null }))
    .sort((left, right) => clean(left.class_date).localeCompare(clean(right.class_date)) || Number(left.period) - Number(right.period));
  const classById = new Map(classes.map(row => [row.id, row]));
  const observations = state.observations.map(row => ({
    ...row,
    observer: teacherById.get(row.observer_id) || null,
    classInfo: classById.get(row.class_id) || null
  })).sort((left, right) => clean(left.classInfo && left.classInfo.class_date).localeCompare(clean(right.classInfo && right.classInfo.class_date)) || Number(left.classInfo && left.classInfo.period) - Number(right.classInfo && right.classInfo.period));
  const annualStatuses = buildAnnualStatuses(teachers, classes, observations, state.app_settings);
  const annualByTeacher = new Map(annualStatuses.map(row => [row.id, row]));
  const documents = state.documents.map(row => ({
    ...row,
    submitter: teacherById.get(row.submitter_id) || null,
    classInfo: classById.get(row.class_id) || null
  }));
  const changes = state.change_requests.map(row => ({
    ...row,
    requester: teacherById.get(row.requester_id) || null,
    classInfo: classById.get(row.class_id) || null
  }));
  return { settings, teachers, teacherById, classes, classById, observations, annualStatuses, annualByTeacher, documents, changes };
}

function buildAnnualStatuses(teachers, classes, observations, settingRows) {
  const overrides = annualStatusOverrides(settingRows);
  const classById = new Map(classes.map(row => [row.id, row]));
  const attended = observations.filter(row => row.status === '확정' && row.attendance === '참석');
  return teachers.map(teacher => {
    const teacherClasses = classes.filter(row => row.teacher_id === teacher.id);
    const firstClasses = teacherClasses.filter(row => Number(row.semester) === 1);
    const secondClasses = teacherClasses.filter(row => Number(row.semester) === 2);
    const override = overrides[teacher.id] || {};
    const firstOpenCompleted = overriddenBoolean(override, 'firstOpenCompleted', firstClasses.some(isCompletedClass));
    const secondOpenCompleted = overriddenBoolean(override, 'secondOpenCompleted', secondClasses.some(isCompletedClass));
    const secondConfirmed = secondClasses.filter(row => row.status === '확정');
    let secondOpenStatus = secondOpenCompleted ? '완료' : secondConfirmed.some(row => row.class_date > todayKey()) ? '예정' : secondConfirmed.length ? '미완료' : secondClasses.some(row => row.status === '승인대기') ? '승인대기' : '미신청';
    if (secondOpenStatus === '미신청' && !teacher.second_semester_target) secondOpenStatus = firstOpenCompleted ? '대상 제외' : '대상 아님';
    const firstObservationActual = attended.filter(row => row.observer_id === teacher.id && observationSemester(row, classById) === 1).length;
    const secondObservationActual = attended.filter(row => row.observer_id === teacher.id && observationSemester(row, classById) === 2).length;
    const firstObservationCompleted = overriddenCount(override, 'firstObservationCompleted', firstObservationActual);
    const secondObservationCompleted = overriddenCount(override, 'secondObservationCompleted', secondObservationActual);
    const annualObservationCompleted = firstObservationCompleted + secondObservationCompleted;
    const annualOpenCompleted = firstOpenCompleted || secondOpenCompleted;
    return {
      id: teacher.id,
      name: clean(teacher.name),
      subject: clean(teacher.subject_group) || '교과 미분류',
      category: subjectCategory(teacher.subject_group),
      isSecondSemesterTarget: Boolean(teacher.second_semester_target),
      firstOpenCompleted,
      secondOpenCompleted,
      secondOpenStatus,
      secondOpenApplied: secondClasses.some(row => ['승인대기', '확정'].includes(row.status)),
      annualOpenCompleted,
      firstObservationCompleted,
      secondObservationCompleted,
      annualObservationCompleted,
      observationRequirementMet: annualObservationCompleted >= 2,
      allRequirementsMet: annualOpenCompleted && annualObservationCompleted >= 2,
      manualOverride: Boolean(overrides[teacher.id])
    };
  }).sort(compareTeachers);
}

function addSummarySheet(workbook, model) {
  const sheet = workbook.addWorksheet('관리자 요약', { views: [{ state: 'frozen', ySplit: 4 }] });
  const year = model.settings.school_year || new Date().getFullYear();
  const approvedClasses = model.classes.filter(row => row.status === '확정');
  const pendingOpen = model.classes.filter(row => Number(row.semester) === 2 && row.status === '승인대기');
  const pendingChanges = model.changes.filter(row => row.status === '승인대기');
  const submittedKeys = new Set(model.documents.filter(row => row.classInfo && Number(row.classInfo.semester) === 2 && row.classInfo.status === '확정' && row.submitter_id === row.classInfo.teacher_id).map(row => `${row.class_id}|${row.document_type}`));
  const documentRequired = approvedClasses.length * DOCUMENT_TYPES.length;

  titleRow(sheet, `${year}학년도 수업공개·참관 관리 현황`, 8);
  sheet.mergeCells('A2:H2');
  sheet.getCell('A2').value = `내려받은 시각: ${formatDateTime(new Date())} · 내부 업무용(교사 실명 포함)`;
  sheet.getCell('A2').font = { name: '맑은 고딕', size: 10, color: { argb: COLORS.red } };
  sheet.addRow([]);
  const metrics = [
    ['활성 교사', model.teachers.length, '연간 공개 완료', model.annualStatuses.filter(row => row.annualOpenCompleted).length],
    ['참관 2회 완료', model.annualStatuses.filter(row => row.observationRequirementMet).length, '전체 요건 완료', model.annualStatuses.filter(row => row.allRequirementsMet).length],
    ['공개수업 승인 대기', pendingOpen.length, '일정 변경 승인 대기', pendingChanges.length],
    ['자료 제출 대상', documentRequired, '자료 미제출', Math.max(0, documentRequired - submittedKeys.size)]
  ];
  metrics.forEach(values => sheet.addRow(values));
  for (let row = 4; row <= 7; row += 1) {
    [1, 3].forEach(column => styleMetricLabel(sheet.getCell(row, column)));
    [2, 4].forEach(column => styleMetricValue(sheet.getCell(row, column)));
  }

  sheet.addRow([]);
  sectionRow(sheet, '공개수업 승인 대기', 8);
  tableHeader(sheet.addRow(['신청 상태', '교사', '교과', '날짜', '요일', '교시', '대상 학급', '장소']));
  pendingOpen.forEach(row => sheet.addRow([row.status, teacherName(model, row.teacher_id), classSubject(row, model), row.class_date, row.weekday || weekday(row.class_date), `${row.period}교시`, row.class_name, row.room]));
  if (!pendingOpen.length) sheet.addRow(['승인 대기 없음']);

  sheet.addRow([]);
  sectionRow(sheet, '일정 변경 승인 대기', 8);
  tableHeader(sheet.addRow(['신청자', '기존 날짜', '기존 교시', '변경 날짜', '변경 교시', '변경 학급', '변경 장소', '사유']));
  pendingChanges.forEach(row => sheet.addRow([teacherName(model, row.requester_id), row.original_date, `${row.original_period}교시`, row.requested_date, `${row.requested_period}교시`, row.requested_class_name, row.requested_room, row.reason]));
  if (!pendingChanges.length) sheet.addRow(['승인 대기 없음']);

  sheet.columns = [{ width: 20 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 18 }, { width: 34 }];
  finishSheet(sheet, 8);
}

function addDisclosureSheet(workbook, model, statuses = model.annualStatuses) {
  const sheet = workbook.addWorksheet('정보공시용 수업공개계획', { views: [{ state: 'frozen', ySplit: 2, xSplit: 3 }] });
  // 관리자 화면의 정렬 선택과 무관하게 1학기 결재 시트의
  // 교과군 → 교과 → 성명 순서를 항상 유지합니다.
  const rows = [...statuses].sort(compareTeachers).map(status => {
    const second = primaryClass(model.classes, status.id, 2);
    const observers = second ? model.observations.filter(row => row.class_id === second.id && row.status === '확정').map(row => teacherName(model, row.observer_id)) : [];
    return { status, second, observers };
  });
  const observerStart = 11;
  const observerCount = 7;
  const lastColumn = 17;

  // 1학기 결재 양식과 동일한 17열·2단 머리글 구조를 유지합니다.
  // 2학기용이므로 학기 표기와 채워지는 데이터만 반대로 적용합니다.
  mergeHeader(sheet, 1, 2, 1, 1, '교과군');
  mergeHeader(sheet, 1, 2, 2, 2, '교과');
  mergeHeader(sheet, 1, 2, 3, 3, '성명');
  mergeHeader(sheet, 1, 2, 4, 4, '1학기 수업공개');
  mergeHeader(sheet, 1, 1, 5, 8, '2학기 수업공개일');
  ['월', '일', '요일', '교시'].forEach((value, index) => headerCell(sheet.getCell(2, 5 + index), value));
  mergeHeader(sheet, 1, 2, 9, 9, '대상학급');
  mergeHeader(sheet, 1, 2, 10, 10, '수업장소');
  mergeHeader(sheet, 1, 1, observerStart, lastColumn, '참관 희망 교사');
  for (let index = 0; index < observerCount; index += 1) headerCell(sheet.getCell(2, observerStart + index), '');
  sheet.getRow(1).height = 25;
  sheet.getRow(2).height = 22;

  const startRow = 3;
  rows.forEach(({ status, second, observers }) => {
    const secondDate = dateParts(second && second.class_date);
    const observerCells = Array.from({ length: observerCount }, (_value, index) => {
      if (index < observerCount - 1) return maskDisclosureName(observers[index] || '');
      return observers.slice(index).map(maskDisclosureName).filter(Boolean).join(', ');
    });
    sheet.addRow([
      status.category, status.subject, maskDisclosureName(status.name), status.firstOpenCompleted ? '☑' : '',
      secondDate.month, secondDate.day, second ? second.weekday || secondDate.weekday : '', second ? `${second.period}교시` : '',
      second ? second.class_name : '', second ? second.room : '', ...observerCells
    ]);
  });
  mergeRepeatedValues(sheet, rows, startRow, 'category', 1);
  mergeRepeatedValues(sheet, rows, startRow, row => `${row.status.category}|${row.status.subject}`, 2);
  const endRow = startRow + rows.length - 1;
  for (let row = startRow; row <= endRow; row += 1) {
    sheet.getRow(row).height = 20;
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.border = border();
      cell.font = { name: '맑은 고딕', size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    sheet.getCell(row, 4).font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: COLORS.navy } };
  }
  [10, 10, 10, 12, 7, 7, 8, 9, 13, 15, 11, 11, 11, 11, 11, 11, 11].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.15, right: 0.15, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 }, printTitlesRow: '1:2' };
  sheet.pageSetup.printArea = `A1:Q${Math.max(2, endRow)}`;
  finishSheet(sheet, lastColumn);
}

function addOpenClassesSheet(workbook, model, _statuses, teacherIds = new Set(model.teachers.map(row => row.id))) {
  // 관리자 화면과 동일하게 날짜 → 교시 → 교사 순서를 고정합니다.
  const sourceRows = model.classes.filter(row => teacherIds.has(row.teacher_id)).sort((left, right) => clean(left.class_date).localeCompare(clean(right.class_date)) || Number(left.period) - Number(right.period) || teacherName(model, left.teacher_id).localeCompare(teacherName(model, right.teacher_id), 'ko'));
  const rows = sourceRows.map(row => {
    const observers = model.observations.filter(item => item.class_id === row.id && item.status === '확정');
    return {
      semester: `${row.semester}학기`, status: row.status, teacher: teacherName(model, row.teacher_id), subject: classSubject(row, model),
      date: row.class_date, weekday: row.weekday || weekday(row.class_date), period: `${row.period}교시`, className: row.class_name,
      room: row.room, topic: row.topic, capacity: row.capacity, observerCount: observers.length,
      observers: observers.map(item => teacherName(model, item.observer_id)).join(', '), submittedAt: formatDateTime(row.submitted_at), adminNote: row.admin_note
    };
  });
  addTableSheet(workbook, '공개수업 신청·일정', '공개수업 신청 및 확정 일정', [
    column('semester', '학기', 9), column('status', '상태', 12), column('teacher', '공개 교사', 12), column('subject', '교과', 13),
    column('date', '수업 날짜', 13), column('weekday', '요일', 8), column('period', '교시', 9), column('className', '대상 학급', 14),
    column('room', '수업 장소', 16), column('topic', '수업 주제', 30), column('capacity', '정원', 8), column('observerCount', '참관 신청', 11),
    column('observers', '참관 신청 교사', 42), column('submittedAt', '신청 시각', 20), column('adminNote', '관리자 메모', 24)
  ], rows);
}

function addObservationsSheet(workbook, model, _statuses, teacherIds = new Set(model.teachers.map(row => row.id))) {
  const rows = model.observations.filter(row => teacherIds.has(row.observer_id) || teacherIds.has(row.classInfo && row.classInfo.teacher_id)).map(row => ({
    semester: `${observationSemester(row, model.classById)}학기`, classStatus: row.classInfo ? row.classInfo.status : '', date: row.classInfo ? row.classInfo.class_date : '',
    weekday: row.classInfo ? row.classInfo.weekday || weekday(row.classInfo.class_date) : '', period: row.classInfo ? `${row.classInfo.period}교시` : '',
    presenter: row.classInfo ? teacherName(model, row.classInfo.teacher_id) : '', subject: row.classInfo ? classSubject(row.classInfo, model) : '',
    className: row.classInfo ? row.classInfo.class_name : '', room: row.classInfo ? row.classInfo.room : '', observer: teacherName(model, row.observer_id),
    observerSubject: row.observer ? clean(row.observer.subject_group) : '', applicationStatus: row.status, attendance: row.attendance,
    appliedAt: formatDateTime(row.applied_at), checkedAt: formatDateTime(row.attendance_checked_at), note: row.note
  }));
  addTableSheet(workbook, '참관 신청·출석', '참관 신청 및 실제 참석 현황', [
    column('semester', '학기', 9), column('classStatus', '공개수업 상태', 13), column('date', '수업 날짜', 13), column('weekday', '요일', 8),
    column('period', '교시', 9), column('presenter', '공개 교사', 12), column('subject', '교과', 13), column('className', '대상 학급', 14),
    column('room', '수업 장소', 16), column('observer', '참관 교사', 12), column('observerSubject', '참관 교사 교과', 15),
    column('applicationStatus', '신청 상태', 13), column('attendance', '실제 참석', 12), column('appliedAt', '신청 시각', 20),
    column('checkedAt', '참석 확인 시각', 20), column('note', '비고', 24)
  ], rows);
}

function addAnnualStatusSheet(workbook, model, statuses = model.annualStatuses) {
  const rows = statuses.map(row => ({
    category: row.category, subject: row.subject, name: row.name, target: row.isSecondSemesterTarget ? '대상' : '비대상',
    firstOpen: row.firstOpenCompleted ? '완료' : '미완료', secondOpen: row.secondOpenStatus,
    annualOpen: row.annualOpenCompleted ? '완료' : '미완료', firstObservation: row.firstObservationCompleted,
    secondObservation: row.secondObservationCompleted, annualObservation: row.annualObservationCompleted,
    observationStatus: row.observationRequirementMet ? '완료' : `${Math.max(0, 2 - row.annualObservationCompleted)}회 부족`,
    allStatus: row.allRequirementsMet ? '전체 완료' : '진행 중', manual: row.manualOverride ? '관리자 수정값' : ''
  }));
  addTableSheet(workbook, '교사별 연간 이행', '교사별 연간 공개수업·참관 이행 현황', [
    column('category', '교과군', 11), column('subject', '교과', 13), column('name', '성명', 12), column('target', '2학기 대상', 12),
    column('firstOpen', '1학기 공개', 13), column('secondOpen', '2학기 공개', 13), column('annualOpen', '연간 공개', 13),
    column('firstObservation', '1학기 참관', 12), column('secondObservation', '2학기 참관', 12), column('annualObservation', '연간 참관', 12),
    column('observationStatus', '참관 요건', 13), column('allStatus', '전체 요건', 13), column('manual', '관리자 수정 여부', 16)
  ], rows);
}

function addDocumentsSheet(workbook, model, _statuses, teacherIds = new Set(model.teachers.map(row => row.id))) {
  const requiredClasses = model.classes.filter(row => row.status === '확정' && teacherIds.has(row.teacher_id));
  const rows = [];
  requiredClasses.forEach(cls => DOCUMENT_TYPES.forEach(type => {
    const matches = model.documents.filter(row => row.class_id === cls.id && row.submitter_id === cls.teacher_id && row.document_type === type)
      .sort((left, right) => clean(right.submitted_at).localeCompare(clean(left.submitted_at)));
    const document = matches[0] || null;
    rows.push({
      semester: `${Number(cls.semester) === 1 ? 1 : 2}학기`, date: cls.class_date, period: `${cls.period}교시`, presenter: teacherName(model, cls.teacher_id), subject: classSubject(cls, model),
      className: cls.class_name, type: documentTypeLabel(type), status: document ? document.status : '미제출', method: document ? document.submission_method : '',
      fileName: document ? reportDocumentFileName(model, cls, document) : '', submittedAt: document ? formatDateTime(document.submitted_at) : '', confirmedAt: document ? formatDateTime(document.confirmed_at) : '', note: document ? document.note : ''
    });
  }));
  addTableSheet(workbook, '자료 제출 현황', '공개수업별 자료 제출 현황', [
    column('semester', '학기', 9), column('date', '수업 날짜', 13), column('period', '교시', 9), column('presenter', '공개 교사', 12), column('subject', '교과', 13),
    column('className', '대상 학급', 14), column('type', '자료 구분', 19), column('status', '제출 상태', 15), column('method', '제출 방식', 12),
    column('fileName', '파일명', 36), column('submittedAt', '등록 시각', 20), column('confirmedAt', '수기 확인 시각', 20), column('note', '비고', 24)
  ], rows, '확정된 1·2학기 공개수업마다 수업 지도안·수업나눔 협의록·참관록 3종을 표시합니다.');
}

function addChangesSheet(workbook, model, _statuses, teacherIds = new Set(model.teachers.map(row => row.id))) {
  const rows = model.changes.filter(row => teacherIds.has(row.requester_id)).sort((left, right) => clean(right.requested_at).localeCompare(clean(left.requested_at))).map(row => ({
    requester: teacherName(model, row.requester_id), status: row.status, originalDate: row.original_date, originalPeriod: `${row.original_period}교시`,
    originalClass: row.original_class_name, originalRoom: row.original_room, requestedDate: row.requested_date,
    requestedWeekday: row.requested_weekday || weekday(row.requested_date), requestedPeriod: `${row.requested_period}교시`,
    requestedClass: row.requested_class_name, requestedRoom: row.requested_room, requestedSubject: row.requested_subject,
    reason: row.reason, requestedAt: formatDateTime(row.requested_at), processedAt: formatDateTime(row.processed_at), adminNote: row.admin_note, affected: row.affected_observers
  }));
  addTableSheet(workbook, '일정 변경 요청', '공개수업 일정 변경 요청 현황', [
    column('requester', '신청자', 12), column('status', '상태', 12), column('originalDate', '기존 날짜', 13), column('originalPeriod', '기존 교시', 11),
    column('originalClass', '기존 학급', 14), column('originalRoom', '기존 장소', 16), column('requestedDate', '변경 날짜', 13),
    column('requestedWeekday', '요일', 8), column('requestedPeriod', '변경 교시', 11), column('requestedClass', '변경 학급', 14),
    column('requestedRoom', '변경 장소', 16), column('requestedSubject', '교과', 13), column('reason', '변경 사유', 30),
    column('requestedAt', '신청 시각', 20), column('processedAt', '처리 시각', 20), column('adminNote', '관리자 메모', 24), column('affected', '영향받은 참관자', 30)
  ], rows);
}

function addTableSheet(workbook, name, title, columns, rows, note = '') {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
  titleRow(sheet, title, columns.length);
  sheet.mergeCells(2, 1, 2, columns.length);
  sheet.getCell(2, 1).value = note || `내려받은 시각: ${formatDateTime(new Date())}`;
  sheet.getCell(2, 1).font = { name: '맑은 고딕', size: 10, color: { argb: '5C6F82' } };
  const header = sheet.getRow(4);
  columns.forEach((item, index) => {
    headerCell(header.getCell(index + 1), item.header);
    sheet.getColumn(index + 1).width = item.width;
  });
  rows.forEach(item => sheet.addRow(columns.map(columnItem => item[columnItem.key] ?? '')));
  if (!rows.length) sheet.addRow(['해당 자료가 없습니다.']);
  styleGrid(sheet, 4, sheet.rowCount, 1, columns.length);
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
  sheet.pageSetup = { orientation: columns.length > 8 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '1:4' };
  finishSheet(sheet, columns.length);
  return sheet;
}

function titleRow(sheet, title, lastColumn) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { name: '맑은 고딕', size: 18, bold: true, color: { argb: COLORS.white } };
  cell.fill = solid(COLORS.navy);
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 34;
}

function sectionRow(sheet, value, lastColumn) {
  const row = sheet.addRow([value]);
  sheet.mergeCells(row.number, 1, row.number, lastColumn);
  row.getCell(1).font = { name: '맑은 고딕', bold: true, size: 12, color: { argb: COLORS.white } };
  row.getCell(1).fill = solid(COLORS.blue);
  row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
}

function tableHeader(row) { row.eachCell(cell => headerCell(cell, cell.value)); }

function mergeHeader(sheet, startRow, endRow, startColumn, endColumn, value) {
  if (startRow !== endRow || startColumn !== endColumn) sheet.mergeCells(startRow, startColumn, endRow, endColumn);
  headerCell(sheet.getCell(startRow, startColumn), value);
}

function headerCell(cell, value) {
  cell.value = value;
  cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: COLORS.white } };
  cell.fill = solid(COLORS.navy);
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = border();
}

function styleMetricLabel(cell) {
  cell.font = { name: '맑은 고딕', bold: true, color: { argb: COLORS.navy } };
  cell.fill = solid(COLORS.paleBlue);
  cell.border = border();
  cell.alignment = { vertical: 'middle' };
}

function styleMetricValue(cell) {
  cell.font = { name: '맑은 고딕', bold: true, size: 14, color: { argb: COLORS.blue } };
  cell.border = border();
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
}

function styleGrid(sheet, startRow, endRow, startColumn, endColumn) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      const cell = sheet.getCell(row, columnIndex);
      cell.border = border();
      if (row > startRow) {
        cell.font = { name: '맑은 고딕', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' ? 'center' : 'left', wrapText: true };
        if (row % 2 === 0) cell.fill = solid('F8FAFC');
      }
    }
  }
}

function finishSheet(sheet, lastColumn) {
  sheet.properties.defaultRowHeight = 20;
  sheet.eachRow(row => row.eachCell({ includeEmpty: true }, cell => {
    if (!cell.font || !cell.font.name) cell.font = { ...(cell.font || {}), name: '맑은 고딕' };
  }));
  sheet.headerFooter.oddFooter = `&L내부 업무용&C${sheet.name}&R&P / &N`;
  if (!sheet.pageSetup.printArea) sheet.pageSetup.printArea = `A1:${columnLetter(lastColumn)}${sheet.rowCount}`;
}

function mergeRepeatedValues(sheet, rows, startRow, selector, columnIndex) {
  const keyOf = typeof selector === 'function' ? selector : row => row.status[selector];
  let groupStart = 0;
  for (let index = 1; index <= rows.length; index += 1) {
    const previousKey = keyOf(rows[index - 1]);
    const currentKey = index < rows.length ? keyOf(rows[index]) : null;
    if (currentKey !== previousKey) {
      const first = startRow + groupStart;
      const last = startRow + index - 1;
      if (last > first) sheet.mergeCells(first, columnIndex, last, columnIndex);
      sheet.getCell(first, columnIndex).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      groupStart = index;
    }
  }
}

function primaryClass(classes, teacherId, semester) {
  const candidates = classes.filter(row => row.teacher_id === teacherId && Number(row.semester) === semester && ['확정', '승인대기'].includes(row.status));
  return candidates.sort((left, right) => statusPriority(left.status) - statusPriority(right.status) || clean(left.class_date).localeCompare(clean(right.class_date)))[0] || null;
}

function statusPriority(status) { return status === '확정' ? 0 : status === '승인대기' ? 1 : 9; }
function classSubject(row, model) { return clean(row.subject) || clean(model.teacherById.get(row.teacher_id)?.subject_group) || '교과 미분류'; }
function teacherName(model, id) { return clean(model.teacherById.get(id)?.name) || '교사 정보 없음'; }
function observationSemester(row, classById) { return Number(row.semester) === 1 ? 1 : Number((classById.get ? classById.get(row.class_id) : row.classInfo)?.semester) || 2; }

function subjectCategory(subjectValue) {
  const subject = clean(subjectValue).replaceAll(' ', '');
  if (/국어|한문/.test(subject)) return '국어';
  if (/도덕|윤리|사회|역사|지리/.test(subject)) return '사회';
  if (/수학/.test(subject)) return '수학';
  if (/과학/.test(subject)) return '과학';
  if (/기술|가정|정보|진로|보건|사서|상담/.test(subject)) return '생활';
  if (/체육/.test(subject)) return '체육';
  if (/음악|미술|예술/.test(subject)) return '예술';
  if (/영어|일본어|중국어|외국어/.test(subject)) return '외국어';
  if (/특수/.test(subject)) return '특수';
  return '기타';
}

function compareTeachers(left, right) {
  return CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category)
    || left.subject.localeCompare(right.subject, 'ko')
    || left.name.localeCompare(right.name, 'ko');
}

function normalizeReport(value) {
  const report = clean(value);
  return REPORT_CONFIG[report] ? report : 'annual';
}

function normalizeStatusFilter(value) {
  const filter = clean(value);
  return STATUS_FILTERS.has(filter) ? filter : 'all';
}

function normalizeStatusSort(value) {
  const sort = clean(value);
  return STATUS_SORTS.has(sort) ? sort : 'name';
}

function filterAndSortAnnualStatuses(statuses, filterValue = 'all', sortValue = 'name') {
  const filter = normalizeStatusFilter(filterValue);
  const sort = normalizeStatusSort(sortValue);
  const filtered = statuses.filter(item => {
    if (filter === 'complete') return item.allRequirementsMet;
    if (filter === 'first_open_complete') return item.firstOpenCompleted;
    if (filter === 'second_open_applied') return item.secondOpenApplied;
    if (filter === 'annual_open_complete') return item.annualOpenCompleted;
    if (filter === 'observation_complete') return item.observationRequirementMet;
    if (filter === 'open_incomplete') return !item.annualOpenCompleted;
    if (filter === 'observation_incomplete') return !item.observationRequirementMet;
    return true;
  });
  return filtered.sort((left, right) => {
    let result = 0;
    if (sort === 'open_incomplete') result = Number(left.annualOpenCompleted) - Number(right.annualOpenCompleted);
    if (sort === 'observation_incomplete') result = Number(left.observationRequirementMet) - Number(right.observationRequirementMet) || left.annualObservationCompleted - right.annualObservationCompleted;
    if (sort === 'first_observation_desc') result = right.firstObservationCompleted - left.firstObservationCompleted;
    if (sort === 'second_observation_desc') result = right.secondObservationCompleted - left.secondObservationCompleted;
    return result || left.name.localeCompare(right.name, 'ko');
  });
}

function isCompletedClass(row) { return row && row.status === '확정' && clean(row.class_date) <= todayKey(); }
function settingsMap(rows) { return Object.fromEntries((rows || []).map(row => [row.setting_key, String(row.setting_value ?? '')])); }
function annualStatusOverrides(rows) {
  try {
    const value = JSON.parse(settingsMap(rows).annual_status_overrides || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_error) { return {}; }
}
function overriddenBoolean(record, key, fallback) { return record && typeof record[key] === 'boolean' ? record[key] : Boolean(fallback); }
function overriddenCount(record, key, fallback) { return record && Number.isInteger(Number(record[key])) ? Math.max(0, Number(record[key])) : Math.max(0, Number(fallback) || 0); }
function documentTypeLabel(type) { return ({ 지도안: '수업 지도안', 협의록: '수업나눔 협의록', 참관록: '참관록' })[type] || type; }
function reportDocumentFileName(model, cls, document) {
  const year = clean(model.settings.school_year) || clean(cls.class_date).slice(0, 4) || String(new Date().getFullYear());
  const date = clean(cls.class_date).replaceAll('-', '') || '날짜미정';
  const teacher = teacherName(model, cls.teacher_id).replace(/\s+/g, '') || '교사미상';
  const type = ({ 지도안: '수업지도안', 협의록: '수업나눔협의록', 참관록: '참관록' })[document.document_type] || clean(document.document_type) || '제출자료';
  const extension = clean(document.file_name || document.file_path).match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || '';
  return `${year}_${Number(cls.semester) === 1 ? 1 : 2}학기_${teacher}_${date}_${Number(cls.period) || '미정'}교시_${type}${extension ? `.${extension}` : ''}`;
}

function dateParts(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return { month: '', day: '', weekday: '' };
  const parts = value.split('-');
  return { month: Number(parts[1]), day: Number(parts[2]), weekday: weekday(value) };
}

function weekday(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? '' : ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()];
}

function todayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function formatDateTime(value) { if (!value) return ''; return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)).replace(/\. /g, '-').replace('.', ''); }
function clean(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function maskDisclosureName(value) { const name = clean(value).replace(/\s+/g, ''); return name.length <= 1 ? name : `${name.slice(0, 1)}${'○'.repeat(name.length - 1)}`; }
function column(key, header, width) { return { key, header, width }; }
function solid(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function border() { return { top: { style: 'thin', color: { argb: COLORS.border } }, left: { style: 'thin', color: { argb: COLORS.border } }, bottom: { style: 'thin', color: { argb: COLORS.border } }, right: { style: 'thin', color: { argb: COLORS.border } } }; }
function columnLetter(number) { let value = ''; for (let current = number; current > 0; current = Math.floor((current - 1) / 26)) value = String.fromCharCode(65 + ((current - 1) % 26)) + value; return value; }

module.exports._test = { buildWorkbook, buildExportModel, filterAndSortAnnualStatuses, subjectCategory, columnLetter };
