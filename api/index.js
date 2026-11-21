const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('../lib/auth');

const APP_VERSION = '3.3.16';
const STORAGE_BUCKET = 'open-class-documents';
const TEMPLATE_SETTING_PREFIX = 'operation_template_';
const TEMPLATE_TYPES = Object.freeze(['지도안', '협의록', '참관록']);
const TEMPLATE_STORAGE_DIRS = Object.freeze({ 지도안: 'lesson-plan', 협의록: 'conference', 참관록: 'observation' });
const FIRST_SEMESTER_CSV_DOCUMENT_NOTE = '1학기 CSV 제출 확인';
const DEFAULT_CAPACITY = 4;
// 학교별 설정: 아래 날짜들은 app_settings 값이 없을 때만 쓰는 기본값입니다.
// 공개수업 마지막 날짜는 app_settings의 open_class_final_date 로 바꿀 수 있습니다.
const OPEN_CLASS_FINAL_DATE = '2026-11-30';
const DEFAULT_SEMESTER_START_DATE = '2026-09-01';
const DEFAULT_OPEN_APPLICATION_START = '2026-08-26';
const DEFAULT_OPEN_APPLICATION_DEADLINE = '2026-08-27';
const DEFAULT_OBSERVATION_APPLICATION_START = '2026-08-27';
const DEFAULT_OBSERVATION_APPLICATION_DEADLINE = '2026-08-31';
// 컴시간 학교코드는 Vercel 환경변수 COMCIGAN_SCHOOL_CODE 로 설정합니다.
const DEFAULT_COMCIGAN_SCHOOL_CODE = '';
const DEFAULT_COMCIGAN_SYNC_MINUTES = 15;
const COMCIGAN_API_BASE = 'http://comci.net:4082/36179_T';
// 운영 중 특정 교사를 2학기 공개수업 대상으로 일괄 보정할 때만 이름을 넣습니다. 기본값은 비어 있습니다.
const CONFIRMED_SECOND_SEMESTER_TARGETS = Object.freeze([]);
const TARGET_CORRECTION_KEY = '2026_second_semester_targets_confirmed_v1';
let targetCorrectionChecked = false;
const ALLOWED_ACTIONS = new Set([
  'getLoginOptions', 'bootstrap', 'applyOpenClass', 'applyObservations', 'cancelObservation',
  'confirmAttendance', 'submitDocument', 'requestChange', 'approveOpenClass', 'approveOpenClassesBulk', 'rejectOpenClass', 'deleteOpenClass', 'deleteObservation',
  'processChange', 'confirmPaper', 'recordPaperDocument', 'importFirstSemesterCsv', 'buildMessage', 'updateOperationPhase', 'updateOperationDeadlines',
  'syncComcigan', 'updateAnnualStatusOverride', 'markNotificationRead', 'uploadTemplate', 'deleteTemplate',
  'adminUpdateOpenClass', 'adminUpdateClassCapacity', 'savePublicMessengerMessage', 'deletePublicMessengerMessage', 'movePublicMessengerMessage', 'updateRoomLocations', 'updateReminderFixedRecipients'
]);
const PHASE = { PREPARE: '준비', OPEN: '공개수업신청', OBSERVE: '참관신청', CLASS: '수업진행', ALL: '전체' };
// 학사일정 기본값: 공휴일만 넣어 두었습니다.
// 학교별 시험·단축수업·방학 일정은 app_settings의 academic_calendar_blocks(JSON 배열)와 winter_break(JSON)로 추가합니다.
// 예: [{"date":"2026-10-14","reason":"정기시험"},{"date":"2026-10-28","periods":[6,7],"reason":"5교시 후 하교"}]
const ACADEMIC_CALENDAR_BLOCKS = Object.freeze([
  { date: '2026-08-17', reason: '대체휴일' },
  { date: '2026-09-24', reason: '추석연휴' },
  { date: '2026-09-25', reason: '추석' },
  { date: '2026-10-05', reason: '대체휴일' },
  { date: '2026-10-09', reason: '한글날' },
  { date: '2026-12-25', reason: '성탄절' },
  { date: '2027-01-01', reason: '신정' }
]);
const WINTER_BREAK = Object.freeze({ start: '', end: '', reason: '겨울방학' });

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (isMaintenanceMode()) return response.status(503).json({ ok: false, maintenance: true, message: maintenanceMessage() });
  if (request.method !== 'POST') return response.status(405).json({ ok: false, message: 'POST 요청만 사용할 수 있습니다.' });

  try {
    const action = clean(request.body && request.body.action);
    const payload = request.body && request.body.payload || {};
    if (!ALLOWED_ACTIONS.has(action)) return response.status(400).json({ ok: false, message: '허용되지 않은 작업입니다.' });
    const supabase = supabaseClient();
    await applyConfirmedTargetCorrection(supabase);

    if (action === 'getLoginOptions') {
      const data = await getLoginOptions(supabase);
      return response.status(200).json({ ok: true, data, version: APP_VERSION });
    }

    let actorRequest;
    const actorType = clean(request.body && request.body.actorType);
    if (actorType === 'admin') {
      const authHeader = String(request.headers.authorization || '');
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!verifyAdminToken(token)) return response.status(401).json({ ok: false, message: '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.' });
      actorRequest = { type: 'admin' };
    } else if (actorType === 'teacher') {
      const teacherId = clean(request.body && request.body.teacherId);
      if (!teacherId) return response.status(401).json({ ok: false, message: '선생님을 다시 선택해 주세요.' });
      actorRequest = { type: 'teacher', teacherId };
    } else {
      return response.status(401).json({ ok: false, message: '처음 화면에서 사용자를 선택해 주세요.' });
    }

    let state = actorRequest.type === 'teacher'
      ? await loadTeacherState(supabase, actorRequest.teacherId)
      : await loadState(supabase);
    const actor = actorFromRequest(state, actorRequest);
    if (action === 'bootstrap') {
      return response.status(200).json({ ok: true, data: await buildBootstrap(supabase, state, actor), version: APP_VERSION });
    }

    const result = await dispatchAction(supabase, state, actor, action, payload);
    if (result && result.messageText !== undefined) {
      return response.status(200).json({ ok: true, messageText: result.messageText, version: APP_VERSION });
    }
    state = actorRequest.type === 'teacher'
      ? await loadTeacherState(supabase, actorRequest.teacherId)
      : await loadState(supabase);
    return response.status(200).json({
      ok: true,
      message: result && result.message ? result.message : '처리되었습니다.',
      details: result && result.details ? result.details : null,
      data: await buildBootstrap(supabase, state, actorFromRequest(state, actorRequest)),
      version: APP_VERSION
    });
  } catch (error) {
    const message = friendlyError(error);
    const status = /로그인|권한|본인의|관리자만/.test(message) ? 403 : 400;
    return response.status(status).json({ ok: false, message, version: APP_VERSION });
  }
};

function supabaseClient() {
  const url = clean(process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('Vercel의 SUPABASE_URL과 SUPABASE_SECRET_KEY를 먼저 설정해 주세요.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function applyConfirmedTargetCorrection(supabase) {
  if (targetCorrectionChecked) return;
  if (!CONFIRMED_SECOND_SEMESTER_TARGETS.length) { targetCorrectionChecked = true; return; }
  const settingResult = await supabase.from('app_settings').select('setting_value').eq('setting_key', TARGET_CORRECTION_KEY).maybeSingle();
  if (settingResult.error) throw settingResult.error;
  if (clean(settingResult.data && settingResult.data.setting_value) !== '완료') {
    const teacherResult = await supabase.from('teachers').update({
      second_semester_target: true,
      exclusion_reason: ''
    }).in('name', CONFIRMED_SECOND_SEMESTER_TARGETS).eq('active', true);
    if (teacherResult.error) throw teacherResult.error;
    const saved = await supabase.from('app_settings').upsert({
      setting_key: TARGET_CORRECTION_KEY,
      setting_value: '완료',
      description: '2학기 공개수업 대상 일괄 보정',
      updated_at: new Date().toISOString()
    }, { onConflict: 'setting_key' });
    if (saved.error) throw saved.error;
  }
  targetCorrectionChecked = true;
}

async function loadState(supabase) {
  const tables = ['teachers', 'timetables', 'weekly_timetables', 'blocked_dates', 'open_classes', 'observations', 'documents', 'change_requests', 'app_settings', 'notifications'];
  // Keep last week and every future week; historical reports do not use weekly rows.
  const weeklyStart = addDays(currentAndNextWeekRange().start, -7);
  const results = await Promise.all(tables.map(table => fetchAllRows(supabase, table,
    query => table === 'weekly_timetables' ? query.gte('lesson_date', weeklyStart) : query)));
  const state = Object.fromEntries(tables.map((table, index) => [table, results[index]]));
  state.blocked_dates = mergeAcademicCalendarBlocks(state.blocked_dates, state.app_settings);
  return state;
}

async function loadTeacherState(supabase, teacherId) {
  const queries = [
    supabase.from('teachers').select('*').order('name'),
    supabase.from('timetables').select('*').eq('teacher_id', teacherId).eq('active', true).order('weekday').order('period'),
    supabase.from('weekly_timetables').select('*').eq('teacher_id', teacherId).order('lesson_date').order('period'),
    supabase.from('blocked_dates').select('*').eq('active', true).or(`teacher_id.is.null,teacher_id.eq.${teacherId}`).order('blocked_date'),
    supabase.from('open_classes').select('*').order('class_date').order('period'),
    supabase.from('observations').select('*').order('applied_at'),
    supabase.from('documents').select('*').eq('submitter_id', teacherId).order('submitted_at'),
    supabase.from('change_requests').select('*').eq('requester_id', teacherId).order('requested_at'),
    supabase.from('app_settings').select('*').order('setting_key'),
    supabase.from('notifications').select('*').eq('teacher_id', teacherId).order('created_at', { ascending: false })
  ];
  const tables = ['teachers', 'timetables', 'weekly_timetables', 'blocked_dates', 'open_classes', 'observations', 'documents', 'change_requests', 'app_settings', 'notifications'];
  const results = await Promise.all(queries);
  results.forEach((result, index) => {
    if (result.error) throw new Error(`${tables[index]} 데이터를 불러오지 못했습니다: ${result.error.message}`);
  });
  const state = Object.fromEntries(tables.map((table, index) => [table, results[index].data || []]));
  state.blocked_dates = mergeAcademicCalendarBlocks(state.blocked_dates, state.app_settings);
  return state;
}

async function fetchAllRows(supabase, table, filter = query => query) {
  const pageSize = 1000;
  const orderColumn = table === 'app_settings' ? 'setting_key' : 'id';
  const fail = error => new Error(`${table} 데이터를 불러오지 못했습니다: ${error.message}`);
  const counted = await filter(supabase.from(table).select('*', { count: 'exact', head: true }));
  if (counted.error) throw fail(counted.error);
  if (!Number.isSafeInteger(counted.count) || counted.count < 0) throw fail({ message: '전체 건수를 확인하지 못했습니다.' });
  const pages = await Promise.all(Array.from({ length: Math.ceil(counted.count / pageSize) }, (_, index) => {
    const from = index * pageSize;
    return filter(supabase.from(table).select('*'))
      .order(orderColumn, { ascending: true }).range(from, from + pageSize - 1);
  }));
  return pages.flatMap(result => {
    if (result.error) throw fail(result.error);
    return result.data || [];
  });
}

function actorFromRequest(state, request) {
  if (request.type === 'admin') {
    const row = state.teachers.find(item => item.active && item.role === '관리자');
    return row ? actorFromTeacher(row, true) : { id: null, name: '관리자', role: '관리자', subject: '', isAdmin: true, isTarget: false, exclusionReason: '' };
  }
  const row = state.teachers.find(item => item.id === request.teacherId && item.active && item.role !== '관리자');
  if (!row) throw new Error('선생님 정보를 찾을 수 없습니다. 처음 화면에서 다시 선택해 주세요.');
  return actorFromTeacher(row, false);
}

function actorFromTeacher(row, isAdmin) {
  return {
    id: row.id,
    name: clean(row.name),
    role: isAdmin ? '관리자' : clean(row.role || '일반교사'),
    subject: clean(row.subject_group),
    isAdmin: Boolean(isAdmin),
    isTarget: Boolean(row.second_semester_target),
    exclusionReason: clean(row.exclusion_reason)
  };
}

async function getLoginOptions(supabase) {
  const week = currentAndNextWeekRange();
  const [teacherResult, settingResult, classResult, observationResult] = await Promise.all([
    supabase.from('teachers').select('id,name,subject_group,second_semester_target,exclusion_reason').eq('active', true).neq('role', '관리자').order('subject_group').order('name'),
    supabase.from('app_settings').select('*'),
    supabase.from('open_classes').select('id,teacher_id,semester,class_date,weekday,period,subject,class_name,room,topic,status').order('class_date').order('period'),
    supabase.from('observations').select('class_id,observer_id,semester,status,attendance')
  ]);
  if (teacherResult.error) throw teacherResult.error;
  if (settingResult.error) throw settingResult.error;
  if (classResult.error) throw classResult.error;
  if (observationResult.error) throw observationResult.error;
  const settings = settingsMap(settingResult.data || []);
  const teachers = teacherResult.data || [];
  const classes = classResult.data || [];
  const observations = observationResult.data || [];
  const teacherById = new Map(teachers.map(item => [item.id, item]));
  const progress = buildPublicTeacherProgress(teachers, classes, observations, settingResult.data || []);
  const applicationOverview = buildPublicApplicationOverview(teachers, classes, observations, settingResult.data || []);
  const scheduleClasses = classes.filter(item => Number(item.semester) === 2 && item.status === '확정' && item.class_date >= week.start && item.class_date <= week.end);
  const calendarClasses = classes.filter(item => Number(item.semester) === 2 && item.status === '확정' && item.class_date >= semesterStartDate(settingResult.data || []) && item.class_date <= openClassFinalDate(settingResult.data || []));
  const toPublicScheduleClass = item => ({
    id: item.id,
    date: item.class_date,
    weekday: item.weekday || weekday(item.class_date),
    period: item.period,
    subject: clean(item.subject),
    className: clean(item.class_name),
    room: clean(item.room),
    topic: clean(item.topic),
    teacherName: maskName(teacherById.get(item.teacher_id)?.name),
    observers: observations
      .filter(row => row.class_id === item.id && row.status === '확정')
      .map(row => {
        const teacher = teacherById.get(row.observer_id);
        return teacher ? { name: maskName(teacher.name), subject: clean(teacher.subject_group) || '교과 미분류' } : null;
      })
      .filter(Boolean)
  });
  return {
    appName: settings.app_name || '2학기 수업공개·참관 관리',
    schoolYear: settings.school_year || String(new Date().getFullYear()),
    openClassFinalDate: openClassFinalDate(settingResult.data || []),
    semesterStartDate: semesterStartDate(settingResult.data || []),
    operationPhase: publicConfig(settingResult.data || []).operationPhase,
    week,
    deadlines: {
      open: {
        start: validDateSetting(settings.open_application_start, DEFAULT_OPEN_APPLICATION_START),
        end: validDateSetting(settings.open_application_deadline, DEFAULT_OPEN_APPLICATION_DEADLINE)
      },
      observation: {
        start: validDateSetting(settings.observation_application_start, DEFAULT_OBSERVATION_APPLICATION_START),
        end: validDateSetting(settings.observation_application_deadline, DEFAULT_OBSERVATION_APPLICATION_DEADLINE)
      }
    },
    remainingOpenTeachers: progress.remainingOpenTeachers,
    remainingObservationTeachers: progress.remainingObservationTeachers,
    completedTeachers: progress.completedTeachers,
    applicationOverview,
    semesterClasses: scheduleClasses.map(toPublicScheduleClass),
    calendarClasses: calendarClasses.map(toPublicScheduleClass),
    messengerMessages: publicMessengerMessages(settings.public_messenger_messages),
    roomLocations: roomLocationMap(settings.room_locations),
    teachers: teachers.map(item => ({
      id: item.id,
      displayName: maskName(item.name),
      subjectGroup: clean(item.subject_group) || '교과 미분류'
    }))
  };
}

async function dispatchAction(supabase, state, actor, action, payload) {
  switch (action) {
    case 'applyOpenClass': return applyOpenClass(supabase, state, actor, payload);
    case 'applyObservations': return applyObservations(supabase, actor, payload);
    case 'cancelObservation': return cancelObservation(supabase, state, actor, payload);
    case 'confirmAttendance': return confirmAttendance(supabase, state, actor, payload);
    case 'submitDocument': return submitDocument(supabase, state, actor, payload);
    case 'requestChange': return requestChange(supabase, state, actor, payload);
    case 'approveOpenClass': requireAdmin(actor); return processOpenClass(supabase, state, actor, payload, true);
    case 'approveOpenClassesBulk': requireAdmin(actor); return approveOpenClassesBulk(supabase, state, actor, payload);
    case 'rejectOpenClass': requireAdmin(actor); return processOpenClass(supabase, state, actor, payload, false);
    case 'deleteOpenClass': requireAdmin(actor); return deleteOpenClass(supabase, state, actor, payload);
    case 'deleteObservation': requireAdmin(actor); return deleteObservation(supabase, state, actor, payload);
    case 'processChange': requireAdmin(actor); return processChange(supabase, state, actor, payload);
    case 'confirmPaper': requireAdmin(actor); return confirmPaper(supabase, state, actor, payload);
    case 'recordPaperDocument': requireAdmin(actor); return recordPaperDocument(supabase, state, actor, payload);
    case 'importFirstSemesterCsv': requireAdmin(actor); return importFirstSemesterCsv(supabase, state, actor, payload);
    case 'buildMessage': requireAdmin(actor); return { messageText: buildMessage(state, payload) };
    case 'updateOperationPhase': requireAdmin(actor); return updateOperationPhase(supabase, actor, payload);
    case 'updateOperationDeadlines': requireAdmin(actor); return updateOperationDeadlines(supabase, actor, payload);
    case 'syncComcigan': requireAdmin(actor); return syncComcigan(supabase, actor, { force: true });
    case 'updateAnnualStatusOverride': requireAdmin(actor); return updateAnnualStatusOverride(supabase, state, actor, payload);
    case 'markNotificationRead': return markNotificationRead(supabase, state, actor, payload);
    case 'uploadTemplate': requireAdmin(actor); return uploadTemplate(supabase, state, actor, payload);
    case 'deleteTemplate': requireAdmin(actor); return deleteTemplate(supabase, state, actor, payload);
    case 'adminUpdateOpenClass': requireAdmin(actor); return adminUpdateOpenClass(supabase, state, actor, payload);
    case 'adminUpdateClassCapacity': requireAdmin(actor); return adminUpdateClassCapacity(supabase, state, actor, payload);
    case 'savePublicMessengerMessage': requireAdmin(actor); return savePublicMessengerMessage(supabase, state, actor, payload);
    case 'deletePublicMessengerMessage': requireAdmin(actor); return deletePublicMessengerMessage(supabase, state, actor, payload);
    case 'movePublicMessengerMessage': requireAdmin(actor); return movePublicMessengerMessage(supabase, state, actor, payload);
    case 'updateRoomLocations': requireAdmin(actor); return updateRoomLocations(supabase, actor, payload);
    case 'updateReminderFixedRecipients': requireAdmin(actor); return updateReminderFixedRecipients(supabase, actor, payload);
    default: throw new Error('지원하지 않는 작업입니다.');
  }
}

async function buildBootstrap(supabase, state, actor) {
  await reconcileScheduleConflicts(supabase, state, actor);
  const notificationQuery = supabase.from('notifications').select('*').is('resolved_at', null).order('created_at', { ascending: false });
  const notificationResult = actor.isAdmin ? await notificationQuery : await notificationQuery.eq('teacher_id', actor.id);
  if (notificationResult.error) throw notificationResult.error;
  state.notifications = notificationResult.data || [];
  const config = publicConfig(state.app_settings);
  const myTimetable = actor.isAdmin ? [] : state.timetables
    .filter(row => row.teacher_id === actor.id && row.active && row.open_class_eligible !== false)
    .map(mapTimetable)
    .sort(compareTimetable);
  const classes = state.open_classes.map(row => mapClass(row, state)).sort(compareClasses);
  const classById = new Map(classes.map(item => [item.id, item]));
  const myOpenClasses = classes
    .filter(item => item.teacherId === actor.id)
    .map(item => ({
      ...item,
      observerContacts: item.semester === 1 ? observerContactsForClass(state, item.id) : []
    }));
  const myObservations = state.observations.filter(row => row.observer_id === actor.id).map(row => mapObservation(row, classById.get(row.class_id), state)).sort(compareClasses);
  const actorSubjectKeys = new Set([
    ...state.timetables.filter(row => row.teacher_id === actor.id && row.active).map(row => normalizeSubjectKey(row.subject)),
    ...state.weekly_timetables.filter(row => row.teacher_id === actor.id).map(row => normalizeSubjectKey(row.subject))
  ].filter(Boolean));
  const availableClasses = classes
    .filter(cls => cls.semester === 2 && canObserveClass(actor, cls, state, classes).ok)
    .sort((left, right) => observationSubjectPriority(left, actor, actorSubjectKeys) - observationSubjectPriority(right, actor, actorSubjectKeys) || compareClasses(left, right));
  const scheduleConflictClasses = classes
    .filter(cls => {
      if (cls.semester !== 2) return false;
      const eligibility = canObserveClass(actor, cls, state, classes);
      return eligibility.code === 'timetable' && canObserveClass(actor, cls, state, classes, true).ok;
    })
    .sort((left, right) => observationSubjectPriority(left, actor, actorSubjectKeys) - observationSubjectPriority(right, actor, actorSubjectKeys) || compareClasses(left, right));
  const attendanceClasses = myOpenClasses.filter(cls => cls.semester === 2 && cls.status === '확정').map(cls => ({
    classInfo: cls,
    observations: state.observations.filter(row => row.class_id === cls.id && row.status === '확정').map(row => mapObservation(row, cls, state))
  }));
  const rawMyDocuments = state.documents.filter(row => row.submitter_id === actor.id);
  const myDocuments = await documentsWithSignedUrls(supabase, rawMyDocuments.map(row => mapDocument(row, state)));
  const documentTasks = buildDocumentTasks(actor, classes, state, myDocuments);
  const templateLibrary = await templatesWithSignedUrls(supabase, templateFiles(state.app_settings));
  const myChanges = state.change_requests.filter(row => row.requester_id === actor.id).map(row => mapChange(row, state)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const blockedDates = state.blocked_dates
    .filter(row => row.active && (!row.teacher_id || row.teacher_id === actor.id))
    .map(row => ({ date: row.blocked_date, period: row.period === null ? null : Number(row.period), reason: clean(row.reason) || '신청 불가' }))
    .sort((left, right) => left.date.localeCompare(right.date) || Number(left.period || 0) - Number(right.period || 0));

  const activeMyObservations = myObservations.filter(item => item.status === '확정');
  const completedMyObservations = activeMyObservations.filter(item => item.attendance === '참석');
  const firstOpen = myOpenClasses.filter(item => item.semester === 1);
  const secondOpen = myOpenClasses.filter(item => item.semester === 2);
  const firstObs = activeMyObservations.filter(item => item.semester === 1);
  const secondObs = activeMyObservations.filter(item => item.semester === 2);
  const firstCompletedObs = completedMyObservations.filter(item => item.semester === 1);
  const secondCompletedObs = completedMyObservations.filter(item => item.semester === 2);
  const annualOverride = annualStatusOverrides(state.app_settings)[actor.id] || {};
  const firstOpenCompleted = overriddenBoolean(annualOverride, 'firstOpenCompleted', firstOpen.some(isCompletedClass));
  const secondOpenCompleted = overriddenBoolean(annualOverride, 'secondOpenCompleted', secondOpen.some(isCompletedClass));
  const currentOpen = secondOpen.find(item => ['승인대기', '확정'].includes(item.status)) || secondOpen[secondOpen.length - 1];
  const firstObservationCount = overriddenCount(annualOverride, 'firstObservationCompleted', firstCompletedObs.length);
  const secondObservationCount = overriddenCount(annualOverride, 'secondObservationCompleted', secondCompletedObs.length);
  const annualObservationCount = firstObservationCount + secondObservationCount;
  const observationApplicationStatus = secondSemesterObservationApplicationStatus(
    firstObservationCount,
    secondObservationCount,
    secondObs.filter(item => item.attendance !== '불참').length,
    !isObservationExempt(actor)
  );

  const data = {
    actor, config,
    myTimetable,
    weeklyTimetable: actor.isAdmin ? [] : state.weekly_timetables.map(mapWeeklyTimetable).sort((a, b) => a.date.localeCompare(b.date) || Number(a.period) - Number(b.period)),
    blockedDates,
    dashboard: {
      activeObservationCount: activeMyObservations.length,
      completedObservationCount: annualObservationCount,
      openClassStatus: firstOpenCompleted || secondOpenCompleted ? '공개수업 완료' : (currentOpen ? currentOpen.status : '미신청'),
      pendingDocumentCount: documentTasks.filter(task => !task.status).length,
      documentRequiredCount: documentTasks.length,
      documentSubmittedCount: documentTasks.filter(task => Boolean(task.status)).length,
      paperPendingCount: documentTasks.filter(task => task.status === '수기제출예정').length,
      firstSemester: { openCompleted: firstOpenCompleted, openStatus: firstOpenCompleted ? '완료' : '미완료', observationApplied: firstObs.length, observationCompleted: firstObservationCount },
      secondSemester: { openCompleted: secondOpenCompleted, openStatus: secondOpenCompleted ? '완료' : (currentOpen ? currentOpen.status : '미신청'), observationApplied: secondObs.length, observationCompleted: secondObservationCount },
      observationApplicationStatus,
      annual: { openCompleted: firstOpenCompleted || secondOpenCompleted, observationCompleted: annualObservationCount, observationRequirementMet: annualObservationCount >= 2, allRequirementsMet: (firstOpenCompleted || secondOpenCompleted) && annualObservationCount >= 2 }
    },
    myOpenClasses, availableClasses, scheduleConflictClasses, myObservations, attendanceClasses, documentTasks, myDocuments, myChanges, templateLibrary,
    messengerMessages: publicMessengerMessages(settingsMap(state.app_settings).public_messenger_messages),
    roomLocations: roomLocationMap(settingsMap(state.app_settings).room_locations),
    notifications: actor.isAdmin ? [] : state.notifications.map(mapNotification)
  };
  if (actor.isAdmin) {
    const admin = buildAdminData(state, classes);
    const allDocuments = state.documents
      .map(row => ({ ...mapDocument(row, state), classInfo: classById.get(row.class_id) || null }))
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
    admin.allDocuments = await documentsWithSignedUrls(supabase, allDocuments);
    admin.todo = buildAdminTodo(state, admin);
    data.admin = admin;
  }
  return actor.isAdmin ? data : teacherResponse(data);
}

function observerContactsForClass(state, classId) {
  return state.observations
    .filter(row => row.class_id === classId && row.status === '확정')
    .map(row => {
      const teacher = state.teachers.find(item => item.id === row.observer_id);
      return teacher ? { name: clean(teacher.name), subject: clean(teacher.subject_group) || '교과 미분류' } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.subject.localeCompare(right.subject, 'ko') || left.name.localeCompare(right.name, 'ko'));
}

function teacherResponse(data) {
  return maskTeacherResponse(data);
}

async function applyOpenClass(supabase, state, actor, payload) {
  requirePhase(state, [PHASE.OPEN, PHASE.OBSERVE], '공개수업 신청');
  if (!actor.isTarget) throw new Error('2학기 수업공개 대상자로 지정된 교사만 신청할 수 있습니다.');
  const confirmed = state.open_classes.find(row => row.teacher_id === actor.id && row.semester === 2 && row.status === '확정');
  if (confirmed) throw new Error('관리자 승인이 완료된 공개수업은 이 화면에서 수정할 수 없습니다.');
  const pending = state.open_classes.find(row => row.teacher_id === actor.id && row.semester === 2 && row.status === '승인대기');
  const manual = payload.manual === true;
  const date = requireDate(payload.date, '공개수업 날짜');
  if (date < todayKey()) throw new Error('지난 날짜로는 신청할 수 없습니다.');
  if (date > openClassFinalDate(state)) throw new Error(`공개수업 일정은 ${finalDateLabel(openClassFinalDate(state))}까지 등록할 수 있습니다.`);

  let lesson;
  if (manual) {
    const period = Number(payload.period);
    if (!Number.isInteger(period) || period < 1 || period > 12) throw new Error('수업 교시를 확인해 주세요.');
    lesson = {
      weekday: weekday(date),
      period,
      subject: required(payload.subject, '수업 과목'),
      class_name: required(payload.className, '수업 학급'),
      room: required(payload.room, '수업 장소')
    };
  } else {
    const timetableId = clean(payload.timetableId);
    const weeklyTimetable = state.weekly_timetables.find(row => row.id === timetableId && row.teacher_id === actor.id);
    const timetable = weeklyTimetable || state.timetables.find(row => row.id === timetableId && row.teacher_id === actor.id && row.active && row.open_class_eligible !== false);
    if (!timetable) throw new Error('선택한 시간표를 찾을 수 없습니다.');
    if (weeklyTimetable && weeklyTimetable.lesson_date !== date) throw new Error('선택한 주간 시간표의 날짜와 신청 날짜가 일치하지 않습니다.');
    if (weekday(date) !== timetable.weekday) throw new Error('선택한 날짜의 요일과 시간표 요일이 일치하지 않습니다.');
    lesson = timetable;
  }

  const room = resolveTimetableRoom(payload.room || lesson.room, lesson.class_name);
  if (!room) throw new Error('수업 장소를 입력해 주세요.');
  const blocked = findBlockedConflict(state, actor.id, date, lesson.period);
  if (blocked) throw new Error(`${date} ${lesson.period}교시는 ${clean(blocked.reason) || '학사일정'} 때문에 신청할 수 없습니다.`);
  if (hasRoomCollision(state.open_classes, date, lesson.period, room, pending ? pending.id : null)) throw new Error('같은 시간에 동일한 장소로 신청 또는 확정된 공개수업이 있습니다.');
  const settings = settingsMap(state.app_settings);
  const now = new Date().toISOString();
  const row = {
    teacher_id: actor.id, class_date: date, weekday: lesson.weekday, period: lesson.period,
    subject: clean(lesson.subject) || actor.subject, class_name: clean(lesson.class_name), room,
    topic: clean(payload.topic), capacity: Number(settings.capacity) || DEFAULT_CAPACITY, status: '승인대기', semester: 2,
    source: manual ? '직접입력' : '앱', submitted_at: pending && pending.submitted_at ? pending.submitted_at : now
  };
  const result = pending
    ? await supabase.from('open_classes').update(row).eq('id', pending.id).eq('status', '승인대기').select('id').single()
    : await supabase.from('open_classes').insert(row).select('id').single();
  if (result.error) throw result.error;
  await audit(supabase, actor, pending ? '공개수업 신청 수정' : '공개수업 신청', '공개수업', result.data.id, { date, period: lesson.period, manual });
  return { message: pending ? '승인대기 중인 신청 내용이 수정되었습니다.' : '공개수업 신청이 접수되었습니다. 관리자 승인 후 확정됩니다.' };
}

async function applyObservations(supabase, actor, payload) {
  const classIds = unique(payload.classIds || []);
  if (!classIds.length) throw new Error('참관할 수업을 선택해 주세요.');
  const allowScheduleConflictIds = unique(payload.allowScheduleConflictIds || []).filter(id => classIds.includes(id));
  const result = await supabase.rpc('apply_observations_with_override_atomic', {
    p_teacher_id: actor.id,
    p_class_ids: classIds,
    p_allow_timetable_conflict_ids: allowScheduleConflictIds
  });
  if (result.error) throw result.error;
  const ids = (result.data || []).map(item => item.observation_id);
  await audit(supabase, actor, '참관 신청', '참관신청', ids.join(','), { classIds, allowScheduleConflictIds });
  return { message: `${ids.length}건의 참관 신청이 확정되었습니다.` };
}

async function cancelObservation(supabase, state, actor, payload) {
  requirePhase(state, [PHASE.OBSERVE], '참관 신청 취소');
  const id = clean(payload.observationId);
  const observation = state.observations.find(row => row.id === id);
  if (!observation) throw new Error('참관 신청을 찾을 수 없습니다.');
  if (observation.observer_id !== actor.id) throw new Error('본인의 참관 신청만 취소할 수 있습니다.');
  if (observation.status !== '확정') throw new Error('이미 취소된 신청입니다.');
  if (observation.attendance === '참석') throw new Error('참석 확인이 완료된 참관은 취소할 수 없습니다.');
  const cls = state.open_classes.find(row => row.id === observation.class_id);
  if (!cls || cls.class_date < todayKey()) throw new Error('이미 지난 공개수업은 취소할 수 없습니다.');
  const result = await supabase.from('observations').update({ status: '취소', canceled_at: new Date().toISOString(), note: '교사 본인 취소' }).eq('id', id);
  if (result.error) throw result.error;
  await audit(supabase, actor, '참관 취소', '참관신청', id, { classId: observation.class_id });
  return { message: '참관 신청이 취소되었습니다.' };
}

async function confirmAttendance(supabase, state, actor, payload) {
  const classId = clean(payload.classId);
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (!records.length) throw new Error('참관 여부를 한 명 이상 선택해 주세요.');
  const cls = state.open_classes.find(row => row.id === classId);
  if (!cls) throw new Error('공개수업을 찾을 수 없습니다.');
  if (cls.teacher_id !== actor.id) throw new Error('자신이 공개한 수업의 참관 여부만 확인할 수 있습니다.');
  if (cls.status !== '확정' || cls.class_date > todayKey()) throw new Error('확정된 수업일 이후에만 확인할 수 있습니다.');
  const normalized = records.map(record => ({ id: clean(record.observationId), attendance: clean(record.attendance) }));
  normalized.forEach(record => {
    if (!['참석', '불참'].includes(record.attendance)) throw new Error('참관 여부는 참석 또는 불참으로 선택해 주세요.');
    if (!state.observations.some(row => row.id === record.id && row.class_id === classId && row.status === '확정')) throw new Error('유효하지 않은 참관 신청이 포함되어 있습니다.');
  });
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(normalized.map(record => supabase.from('observations').update({ attendance: record.attendance, attendance_checked_by: actor.id, attendance_checked_at: checkedAt }).eq('id', record.id).eq('class_id', classId)));
  const failed = results.find(result => result.error);
  if (failed) throw failed.error;
  await audit(supabase, actor, '참관 여부 확인', '공개수업', classId, { count: normalized.length });
  return { message: `${normalized.length}명의 실제 참관 여부가 저장되었습니다.` };
}

async function submitDocument(supabase, state, actor, payload) {
  const classId = clean(payload.classId);
  const type = clean(payload.type);
  const method = clean(payload.method);
  if (!['지도안', '참관록', '협의록'].includes(type)) throw new Error('자료 유형이 올바르지 않습니다.');
  if (!['온라인', '수기'].includes(method)) throw new Error('제출 방식을 선택해 주세요.');
  const cls = state.open_classes.find(row => row.id === classId);
  if (!cls) throw new Error('연결된 공개수업을 찾을 수 없습니다.');
  assertDocumentPermission(state, actor, type, cls);
  const existing = state.documents.find(row => row.class_id === classId && row.document_type === type && row.submitter_id === actor.id);
  let fileName = '';
  let filePath = '';
  let status = '수기제출예정';
  let originalFileName = '';
  if (method === '온라인') {
    const file = payload.file || {};
    originalFileName = sanitizeFileName(file.name);
    if (!originalFileName || !file.base64) throw new Error('제출할 파일을 선택해 주세요.');
    assertAllowedFile(originalFileName);
    const bytes = Buffer.from(String(file.base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const maxMb = Number(settingsMap(state.app_settings).max_file_mb) || 3;
    if (bytes.length > maxMb * 1024 * 1024) throw new Error(`파일은 ${maxMb}MB 이하만 제출할 수 있습니다.`);
    fileName = standardDocumentFileName(state, cls, actor.name, type, originalFileName);
    filePath = `${settingsMap(state.app_settings).school_year || new Date().getFullYear()}/${classId}/${actor.id}/${Date.now()}-${crypto.randomUUID()}.${fileExtension(originalFileName)}`;
    const upload = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, bytes, { contentType: clean(file.mimeType) || 'application/octet-stream', upsert: false });
    if (upload.error) throw upload.error;
    status = '온라인제출';
  }
  const values = {
    class_id: classId, document_type: type, submitter_id: actor.id, submission_method: method,
    file_name: fileName, file_path: filePath, status, submitted_at: new Date().toISOString(), confirmed_by: null, confirmed_at: null,
    note: documentSubmissionNote(payload.note, originalFileName)
  };
  const saved = await supabase.from('documents').upsert(values, { onConflict: 'class_id,document_type,submitter_id' }).select('id').single();
  if (saved.error) {
    if (filePath) await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    throw saved.error;
  }
  if (existing && existing.file_path && existing.file_path !== filePath) await supabase.storage.from(STORAGE_BUCKET).remove([existing.file_path]);
  await audit(supabase, actor, '자료 제출', '제출자료', saved.data.id, { type, method, fileName, originalFileName });
  return { message: method === '온라인' ? `${type} 파일이 제출되었습니다.` : `${type}을 수기로 제출할 예정으로 등록했습니다.` };
}

async function uploadTemplate(supabase, state, actor, payload) {
  const type = clean(payload.type);
  if (!TEMPLATE_TYPES.includes(type)) throw new Error('양식 유형이 올바르지 않습니다.');
  const file = payload.file || {};
  const originalFileName = sanitizeFileName(file.name);
  if (!originalFileName || !file.base64) throw new Error('등록할 양식 파일을 선택해 주세요.');
  assertAllowedFile(originalFileName);
  const bytes = Buffer.from(String(file.base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
  const maxMb = Number(settingsMap(state.app_settings).max_file_mb) || 3;
  if (bytes.length > maxMb * 1024 * 1024) throw new Error(`양식 파일은 ${maxMb}MB 이하만 등록할 수 있습니다.`);

  const previous = templateFiles(state.app_settings).find(item => item.type === type);
  const extension = fileExtension(originalFileName);
  const fileName = originalFileName;
  const storageDirectory = TEMPLATE_STORAGE_DIRS[type];
  const filePath = `templates/${storageDirectory}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const uploaded = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, bytes, {
    contentType: clean(file.mimeType) || 'application/octet-stream',
    upsert: false
  });
  if (uploaded.error) throw uploaded.error;

  const metadata = {
    type,
    fileName,
    originalFileName,
    filePath,
    uploadedAt: new Date().toISOString(),
    uploadedBy: actor.name
  };
  const saved = await supabase.from('app_settings').upsert({
    setting_key: `${TEMPLATE_SETTING_PREFIX}${type}`,
    setting_value: JSON.stringify(metadata),
    description: `${documentFileTypeLabel(type)} 공용 양식`,
    updated_at: metadata.uploadedAt
  }, { onConflict: 'setting_key' });
  if (saved.error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    throw saved.error;
  }
  if (previous?.filePath && previous.filePath !== filePath) await supabase.storage.from(STORAGE_BUCKET).remove([previous.filePath]);
  const replaced = Boolean(previous);
  await audit(supabase, actor, replaced ? '공용 양식 교체' : '공용 양식 등록', '공용양식', type, { fileName, originalFileName, filePath });
  return { message: replaced ? `${documentFileTypeLabel(type)} 양식을 ${originalFileName}(으)로 교체했습니다.` : `${documentFileTypeLabel(type)} 양식 ${originalFileName}을(를) 등록했습니다.` };
}

async function deleteTemplate(supabase, state, actor, payload) {
  const type = clean(payload.type);
  if (!TEMPLATE_TYPES.includes(type)) throw new Error('양식 유형이 올바르지 않습니다.');
  const previous = templateFiles(state.app_settings).find(item => item.type === type);
  if (!previous) throw new Error('삭제할 공용 양식이 없습니다.');
  const removedSetting = await supabase.from('app_settings').delete().eq('setting_key', `${TEMPLATE_SETTING_PREFIX}${type}`);
  if (removedSetting.error) throw removedSetting.error;
  let storageCleanupFailed = false;
  if (previous.filePath) {
    const removedFile = await supabase.storage.from(STORAGE_BUCKET).remove([previous.filePath]);
    storageCleanupFailed = Boolean(removedFile.error);
  }
  await audit(supabase, actor, '공용 양식 삭제', '공용양식', type, { fileName: previous.fileName, storageCleanupFailed });
  return { message: `${documentFileTypeLabel(type)} 양식을 삭제했습니다.` };
}

function trimPublicMessengerMessage(item, index) {
  return {
    id: clean(item.id) || `message-${index + 1}`,
    title: clean(item.title).slice(0, 120) || `메신저 ${index + 1}`,
    sentAt: clean(item.sentAt).slice(0, 40),
    body: clean(item.body).slice(0, 12000)
  };
}

async function persistPublicMessengerMessages(supabase, actor, messages, auditAction, details) {
  const cleaned = (messages || []).map(trimPublicMessengerMessage).filter(item => item.body).slice(0, 60);
  const result = await supabase.from('app_settings').upsert({
    setting_key: 'public_messenger_messages',
    setting_value: JSON.stringify(cleaned),
    description: '로그인 화면에 공개하는 관리자 등록 메신저',
    updated_at: new Date().toISOString()
  }, { onConflict: 'setting_key' });
  if (result.error) throw result.error;
  await audit(supabase, actor, auditAction, '공개메신저', '', details || {});
  return cleaned;
}

async function savePublicMessengerMessage(supabase, state, actor, payload) {
  const title = required(payload.title, '메신저 제목').slice(0, 120);
  const body = required(payload.body, '메신저 내용').slice(0, 12000);
  const sentAt = clean(payload.sentAt).slice(0, 40);
  const messages = publicMessengerMessages(settingsMap(state.app_settings).public_messenger_messages);
  if (messages.length >= 60) throw new Error('공개 메신저는 최대 60건까지 등록할 수 있습니다.');
  const id = crypto.randomUUID();
  messages.push({ id, title, sentAt, body });
  await persistPublicMessengerMessages(supabase, actor, messages, '공개 메신저 등록', { id, title });
  return { message: '공개 메신저를 등록했습니다.' };
}

async function deletePublicMessengerMessage(supabase, state, actor, payload) {
  const id = required(payload.messageId, '메신저');
  const messages = publicMessengerMessages(settingsMap(state.app_settings).public_messenger_messages);
  const target = messages.find(item => item.id === id);
  if (!target) throw new Error('삭제할 공개 메신저를 찾을 수 없습니다.');
  await persistPublicMessengerMessages(supabase, actor, messages.filter(item => item.id !== id), '공개 메신저 삭제', { id, title: target.title });
  return { message: '공개 메신저를 삭제했습니다.' };
}

async function movePublicMessengerMessage(supabase, state, actor, payload) {
  const id = required(payload.messageId, '메신저');
  const direction = Number(payload.direction);
  if (![-1, 1].includes(direction)) throw new Error('이동 방향을 확인해 주세요.');
  const messages = publicMessengerMessages(settingsMap(state.app_settings).public_messenger_messages);
  const index = messages.findIndex(item => item.id === id);
  if (index < 0) throw new Error('이동할 공개 메신저를 찾을 수 없습니다.');
  const nextIndex = Math.max(0, Math.min(messages.length - 1, index + direction));
  if (nextIndex === index) return { message: '이미 목록의 끝입니다.' };
  [messages[index], messages[nextIndex]] = [messages[nextIndex], messages[index]];
  await persistPublicMessengerMessages(supabase, actor, messages, '공개 메신저 순서 변경', { id, from: index, to: nextIndex });
  return { message: '공개 메신저 순서를 변경했습니다.' };
}

async function updateRoomLocations(supabase, actor, payload) {
  const source = payload && payload.locations;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('교실 위치 목록 형식을 확인해 주세요.');
  const entries = Object.entries(source)
    .map(([room, location]) => [clean(room).slice(0, 80), clean(location).slice(0, 60)])
    .filter(([room, location]) => room && location);
  if (entries.length > 200) throw new Error('교실 위치는 최대 200개까지 등록할 수 있습니다.');
  const locations = Object.fromEntries(entries);
  const result = await supabase.from('app_settings').upsert({
    setting_key: 'room_locations',
    setting_value: JSON.stringify(locations),
    description: '참관 교사용 교실·특별실 층 및 본관·별관 위치',
    updated_at: new Date().toISOString()
  }, { onConflict: 'setting_key' });
  if (result.error) throw result.error;
  await audit(supabase, actor, '교실 위치 정보 수정', '운영설정', 'room_locations', { count: entries.length });
  return { message: `교실 위치 정보 ${entries.length}개를 저장했습니다.` };
}

async function adminUpdateClassCapacity(supabase, state, actor, payload) {
  const classId = required(payload.classId, '공개수업');
  const cls = state.open_classes.find(row => row.id === classId && row.semester === 2 && row.status === '확정');
  if (!cls) throw new Error('정원을 변경할 확정 공개수업을 찾을 수 없습니다.');
  const capacity = Number(payload.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
    throw new Error('참관 정원은 1명부터 20명 사이로 설정해 주세요.');
  }
  const countResult = await supabase.from('observations').select('id', { count: 'exact', head: true })
    .eq('class_id', classId).eq('status', '확정');
  if (countResult.error) throw countResult.error;
  const observerCount = Number(countResult.count || 0);
  if (capacity < observerCount) {
    throw new Error(`현재 참관 신청자가 ${observerCount}명이므로 정원을 그보다 낮출 수 없습니다.`);
  }
  const previousCapacity = Number(cls.capacity) || DEFAULT_CAPACITY;
  if (capacity === previousCapacity) return { message: '참관 정원이 이미 같은 값으로 설정되어 있습니다.' };
  const result = await supabase.from('open_classes').update({
    capacity,
    processed_by: actor.id || null,
    processed_at: new Date().toISOString()
  }).eq('id', classId).eq('status', '확정').select('id').single();
  if (result.error) throw result.error;
  await audit(supabase, actor, '공개수업 참관 정원 변경', '공개수업', classId, {
    teacherId: cls.teacher_id, before: previousCapacity, after: capacity, observerCount
  });
  return { message: `${teacherName(state, cls.teacher_id)} 선생님 수업의 참관 정원을 ${capacity}명으로 변경했습니다.` };
}

async function adminUpdateOpenClass(supabase, state, actor, payload) {
  const classId = required(payload.classId, '공개수업');
  const cls = state.open_classes.find(row => row.id === classId && row.semester === 2 && row.status === '확정');
  if (!cls) throw new Error('변경할 확정 공개수업을 찾을 수 없습니다.');
  const date = requireDate(payload.date, '변경 날짜');
  if (date < todayKey()) throw new Error('지난 날짜로는 변경할 수 없습니다.');
  if (date > openClassFinalDate(state)) throw new Error(`2학기 공개수업 일정은 ${finalDateLabel(openClassFinalDate(state))}까지만 등록할 수 있습니다.`);
  const period = Number(payload.period);
  if (!Number.isInteger(period) || period < 1 || period > 8) throw new Error('교시는 1교시부터 8교시 사이로 선택해 주세요.');
  const subject = required(payload.subject, '과목').slice(0, 80);
  const className = required(payload.className, '학급').slice(0, 80);
  const room = required(payload.room, '장소').slice(0, 120);
  const topic = clean(payload.topic).slice(0, 500);
  const blocked = findBlockedConflict(state, cls.teacher_id, date, period);
  if (blocked) throw new Error(`${formatKoreanDate(date)} ${period}교시는 ${clean(blocked.reason) || '학사일정'} 때문에 변경할 수 없습니다.`);
  if (hasRoomCollision(state.open_classes, date, period, room, classId)) throw new Error('같은 시간과 장소에 이미 다른 공개수업이 있습니다.');
  const result = await supabase.rpc('admin_update_open_class_atomic', {
    p_class_id: classId,
    p_admin_id: actor.id || null,
    p_date: date,
    p_period: period,
    p_subject: subject,
    p_class_name: className,
    p_room: room,
    p_topic: topic,
    p_note: clean(payload.note) || '관리자 직접 일정 변경'
  });
  if (result.error) throw result.error;
  const observerCount = Number(result.data && result.data.observer_count) || 0;
  await audit(supabase, actor, '확정 공개수업 관리자 직접 변경', '공개수업', classId, {
    before: { date: cls.class_date, period: cls.period, subject: cls.subject, className: cls.class_name, room: cls.room },
    after: { date, period, subject, className, room }
  });
  return { message: `${teacherName(state, cls.teacher_id)} 선생님의 공개수업 일정을 변경했습니다.${observerCount ? ` 참관인 ${observerCount}명의 신청은 유지되며 변경 알림이 표시됩니다.` : ''}` };
}

async function requestChange(supabase, state, actor, payload) {
  const classId = clean(payload.classId);
  const cls = state.open_classes.find(row => row.id === classId);
  if (!cls || cls.teacher_id !== actor.id || cls.status !== '확정' || cls.semester !== 2) throw new Error('본인의 확정된 2학기 공개수업만 변경할 수 있습니다.');
  if (state.change_requests.some(row => row.class_id === classId && row.status === '승인대기')) throw new Error('이미 처리 대기 중인 변경 신청이 있습니다.');

  const manual = payload.manual === true;
  const date = requireDate(payload.date, '희망 날짜');
  if (date < todayKey()) throw new Error('지난 날짜로는 일정을 변경할 수 없습니다.');
  if (date > openClassFinalDate(state)) throw new Error(`공개수업 일정은 ${finalDateLabel(openClassFinalDate(state))}까지 변경할 수 있습니다.`);

  let lesson;
  let requestedTimetableId = null;
  if (manual) {
    const period = Number(payload.period);
    if (!Number.isInteger(period) || period < 1 || period > 8) throw new Error('희망 교시를 확인해 주세요.');
    lesson = {
      weekday: weekday(date),
      period,
      subject: required(payload.subject, '희망 과목'),
      class_name: required(payload.className, '희망 학급'),
      room: required(payload.room, '희망 장소')
    };
  } else {
    const timetableId = clean(payload.timetableId);
    const weeklyTimetable = state.weekly_timetables.find(row => row.id === timetableId && row.teacher_id === actor.id);
    const timetable = weeklyTimetable || state.timetables.find(row => row.id === timetableId && row.teacher_id === actor.id && row.active && row.open_class_eligible !== false);
    if (!timetable) throw new Error('희망 시간표를 찾을 수 없습니다.');
    if (weeklyTimetable && weeklyTimetable.lesson_date !== date) throw new Error('선택한 주간 시간표의 날짜와 희망 날짜가 일치하지 않습니다.');
    if (weekday(date) !== timetable.weekday) throw new Error('희망 날짜와 시간표 요일을 확인해 주세요.');
    lesson = timetable;
    requestedTimetableId = weeklyTimetable ? null : timetable.id;
  }

  const room = resolveTimetableRoom(payload.room || lesson.room, lesson.class_name);
  if (!room) throw new Error('희망 장소를 입력해 주세요.');
  if (hasBlockedConflict(state, actor.id, date, lesson.period)) throw new Error('희망 일정은 신청 불가 일정과 겹칩니다.');
  if (hasRoomCollision(state.open_classes, date, lesson.period, room, classId)) throw new Error('같은 시간에 동일한 장소를 사용하는 공개수업이 있습니다.');
  const row = {
    class_id: classId, requester_id: actor.id, original_date: cls.class_date, original_period: cls.period,
    original_class_name: cls.class_name, original_room: cls.room, requested_date: date, requested_weekday: lesson.weekday,
    requested_period: lesson.period, requested_class_name: lesson.class_name, requested_room: room,
    requested_subject: clean(lesson.subject) || actor.subject, requested_timetable_id: requestedTimetableId, reason: required(payload.reason, '변경 사유'),
    requested_at: new Date().toISOString()
  };
  const result = await supabase.from('change_requests').insert(row).select('id').single();
  if (result.error) throw result.error;
  await audit(supabase, actor, '일정 변경 신청', '변경신청', result.data.id, { classId, manual, date, period: lesson.period });
  return { message: '일정 변경 신청이 접수되었습니다.' };
}

async function processOpenClass(supabase, state, actor, payload, approve) {
  const id = clean(payload.classId);
  const cls = state.open_classes.find(row => row.id === id);
  if (!cls || cls.status !== '승인대기') throw new Error('승인 대기 중인 공개수업을 찾을 수 없습니다.');
  if (approve) {
    if (cls.class_date < todayKey()) throw new Error('지난 공개수업 일정은 승인할 수 없습니다.');
    if (cls.class_date > openClassFinalDate(state)) throw new Error(`공개수업 일정은 ${finalDateLabel(openClassFinalDate(state))}까지 승인할 수 있습니다.`);
    const timetable = state.weekly_timetables.find(row => row.teacher_id === cls.teacher_id && row.lesson_date === cls.class_date && Number(row.period) === Number(cls.period) && sameClassIdentity(row.class_name, cls.class_name))
      || state.timetables.find(row => row.teacher_id === cls.teacher_id && row.active && row.open_class_eligible !== false && row.weekday === cls.weekday && Number(row.period) === Number(cls.period) && sameClassIdentity(row.class_name, cls.class_name));
    const sourceResult = await supabase.from('open_classes').select('source').eq('id', id).maybeSingle();
    if (sourceResult.error) throw sourceResult.error;
    const storedSource = clean(sourceResult.data && sourceResult.data.source);
    const isManual = storedSource === '직접입력' || clean(cls.source) === '직접입력';
    console.info('[open-class-approval] validation', { classId: id, storedSource, stateSource: clean(cls.source), isManual, hasTimetable: Boolean(timetable) });
    if (!timetable && !isManual) throw new Error('신청 후 시간표가 바뀌었습니다. 교사가 새 시간표로 신청을 수정해야 합니다.');
    const blocked = findBlockedConflict(state, cls.teacher_id, cls.class_date, cls.period);
    if (blocked) throw new Error(`${formatKoreanDate(cls.class_date)} ${cls.period}교시는 ${clean(blocked.reason) || '학사일정'} 때문에 승인할 수 없습니다.`);
    if (hasRoomCollision(state.open_classes.filter(row => row.status === '확정'), cls.class_date, cls.period, cls.room, cls.id)) throw new Error('같은 시간과 장소에 이미 확정된 공개수업이 있습니다.');
    const result = await supabase.rpc('approve_open_class_atomic', { p_class_id: id, p_admin_id: actor.id || null, p_note: clean(payload.note) });
    if (result.error) throw result.error;
  } else {
    const result = await supabase.from('open_classes').update({ status: '반려', processed_by: actor.id, processed_at: new Date().toISOString(), admin_note: clean(payload.note) }).eq('id', id).eq('status', '승인대기');
    if (result.error) throw result.error;
  }
  await audit(supabase, actor, approve ? '공개수업 승인' : '공개수업 반려', '공개수업', id, { note: clean(payload.note) });
  return { message: approve ? '공개수업 일정이 확정되었습니다.' : '공개수업 신청을 반려했습니다.' };
}

async function approveOpenClassesBulk(supabase, state, actor, payload) {
  const classIds = unique((Array.isArray(payload.classIds) ? payload.classIds : []).map(clean).filter(Boolean));
  if (!classIds.length) throw new Error('일괄 승인할 공개수업을 선택해 주세요.');
  if (classIds.length > 100) throw new Error('한 번에 최대 100건까지 승인할 수 있습니다.');

  const pendingIds = new Set(state.open_classes.filter(row => row.status === '승인대기' && Number(row.semester) === 2).map(row => row.id));
  if (classIds.some(id => !pendingIds.has(id))) throw new Error('승인 대기 중인 2학기 공개수업만 일괄 승인할 수 있습니다.');

  const approved = [];
  const failed = [];
  for (const classId of classIds) {
    try {
      await processOpenClass(supabase, state, actor, { classId, note: clean(payload.note) }, true);
      approved.push(classId);
      const row = state.open_classes.find(item => item.id === classId);
      if (row) row.status = '확정';
    } catch (error) {
      failed.push({ classId, message: clean(error && error.message) || '승인 처리에 실패했습니다.' });
    }
  }

  if (!approved.length) throw new Error(failed[0] ? failed[0].message : '승인된 공개수업이 없습니다.');
  return {
    message: failed.length
      ? `${approved.length}건을 승인했고, ${failed.length}건은 일정 충돌 등으로 승인되지 않았습니다.`
      : `${approved.length}건의 공개수업을 모두 승인했습니다.`,
    details: {
      approvedCount: approved.length,
      failedCount: failed.length,
      failures: failed
    }
  };
}

async function deleteOpenClass(supabase, state, actor, payload) {
  const id = required(payload.classId, '공개수업');
  const cls = state.open_classes.find(row => row.id === id);
  if (!cls) throw new Error('삭제할 공개수업을 찾을 수 없습니다.');
  if (Number(cls.semester) !== 2) throw new Error('1학기 실적은 이 화면에서 삭제할 수 없습니다.');
  const observations = state.observations.filter(row => row.class_id === id);
  const observationIds = observations.map(row => row.id);
  const documents = state.documents.filter(row => row.class_id === id);
  const filePaths = unique(documents.map(row => row.file_path));
  const snapshot = {
    teacherName: teacherName(state, cls.teacher_id),
    date: cls.class_date,
    period: cls.period,
    className: cls.class_name,
    room: cls.room,
    status: cls.status,
    observationCount: observations.length,
    documentCount: documents.length
  };

  const deletes = [supabase.from('notifications').delete().eq('class_id', id)];
  if (observationIds.length) deletes.push(supabase.from('notifications').delete().in('observation_id', observationIds));
  deletes.push(
    supabase.from('change_requests').delete().eq('class_id', id),
    supabase.from('documents').delete().eq('class_id', id),
    supabase.from('observations').delete().eq('class_id', id)
  );
  for (const operation of deletes) {
    const result = await operation;
    if (result.error) throw result.error;
  }
  const removed = await supabase.from('open_classes').delete().eq('id', id).eq('semester', 2).select('id').maybeSingle();
  if (removed.error) throw removed.error;
  if (!removed.data) throw new Error('공개수업이 삭제되지 않았습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');

  let storageCleanupFailed = false;
  if (filePaths.length) {
    const storageResult = await supabase.storage.from(STORAGE_BUCKET).remove(filePaths);
    storageCleanupFailed = Boolean(storageResult.error);
  }
  await audit(supabase, actor, '2학기 공개수업 삭제', '공개수업', id, { ...snapshot, storageCleanupFailed });
  return { message: `${snapshot.teacherName} 선생님의 2학기 공개수업과 연결된 참관·변경·제출·알림 데이터를 삭제했습니다.` };
}

async function deleteObservation(supabase, state, actor, payload) {
  const id = required(payload.observationId, '참관 신청');
  const observation = state.observations.find(row => row.id === id);
  if (!observation) throw new Error('삭제할 참관 신청을 찾을 수 없습니다.');
  const cls = state.open_classes.find(row => row.id === observation.class_id);
  if (!cls || Number(cls.semester) !== 2) throw new Error('1학기 참관 실적은 이 화면에서 삭제할 수 없습니다.');
  const snapshot = {
    observerName: teacherName(state, observation.observer_id),
    teacherName: teacherName(state, cls.teacher_id),
    classId: cls.id,
    date: cls.class_date,
    period: cls.period,
    attendance: observation.attendance,
    status: observation.status
  };
  const notificationResult = await supabase.from('notifications').delete().eq('observation_id', id);
  if (notificationResult.error) throw notificationResult.error;
  const removed = await supabase.from('observations').delete().eq('id', id).eq('semester', 2).select('id').maybeSingle();
  if (removed.error) throw removed.error;
  if (!removed.data) throw new Error('참관 신청이 삭제되지 않았습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
  await audit(supabase, actor, '2학기 참관 신청 삭제', '참관신청', id, snapshot);
  return { message: `${snapshot.observerName} 선생님의 참관 신청을 삭제했습니다.` };
}

async function processChange(supabase, state, actor, payload) {
  const id = clean(payload.changeId);
  const approve = Boolean(payload.approve);
  const change = state.change_requests.find(row => row.id === id && row.status === '승인대기');
  if (!change) throw new Error('승인 대기 중인 변경 신청을 찾을 수 없습니다.');
  const cls = state.open_classes.find(row => row.id === change.class_id);
  if (!cls) throw new Error('연결된 공개수업을 찾을 수 없습니다.');
  const now = new Date().toISOString();
  let affectedNames = [];
  if (approve) {
    if (cls.class_date < todayKey() || change.requested_date < todayKey()) throw new Error('이미 지난 수업 또는 지난 날짜로는 일정을 변경할 수 없습니다.');
    if (change.requested_date > openClassFinalDate(state)) throw new Error(`공개수업 일정은 ${finalDateLabel(openClassFinalDate(state))}까지 변경할 수 있습니다.`);
    if (state.observations.some(row => row.class_id === cls.id && ['참석', '불참'].includes(row.attendance))) throw new Error('참관 여부 확인이 시작된 수업은 일정을 변경할 수 없습니다.');
    const timetable = change.requested_timetable_id
      ? state.timetables.find(row => row.id === change.requested_timetable_id && row.teacher_id === change.requester_id && row.active && row.open_class_eligible !== false && row.weekday === change.requested_weekday && Number(row.period) === Number(change.requested_period) && sameClassIdentity(row.class_name, change.requested_class_name))
      : null;
    if (change.requested_timetable_id && !timetable) throw new Error('변경 신청 후 시간표가 바뀌었습니다. 교사가 새 시간표로 다시 신청해야 합니다.');
    const blocked = findBlockedConflict(state, change.requester_id, change.requested_date, change.requested_period);
    if (blocked) throw new Error(`${formatKoreanDate(change.requested_date)} ${change.requested_period}교시는 ${clean(blocked.reason) || '학사일정'} 때문에 변경할 수 없습니다.`);
    if (hasRoomCollision(state.open_classes.filter(row => row.status === '확정'), change.requested_date, change.requested_period, change.requested_room, cls.id)) throw new Error('희망 일정의 장소가 다른 공개수업과 겹칩니다.');
    const approved = await supabase.rpc('approve_change_atomic', { p_change_id: id, p_admin_id: actor.id || null, p_note: clean(payload.note) });
    if (approved.error) throw approved.error;
    affectedNames = Array.isArray(approved.data && approved.data.affected_names) ? approved.data.affected_names : [];
  } else {
    const result = await supabase.from('change_requests').update({ status: '반려', processed_by: actor.id, processed_at: now, admin_note: clean(payload.note), affected_observers: '' }).eq('id', id).eq('status', '승인대기');
    if (result.error) throw result.error;
  }
  await audit(supabase, actor, approve ? '일정 변경 승인' : '일정 변경 반려', '변경신청', id, { affectedNames });
  return { message: approve ? `일정 변경을 승인했습니다.${affectedNames.length ? ` 충돌한 참관 신청 ${affectedNames.length}건은 취소되었고 해당 교사에게 알림이 표시됩니다.` : ' 참관인에게 변경 알림이 표시됩니다.'}` : '일정 변경 신청을 반려했습니다.' };
}

async function markNotificationRead(supabase, state, actor, payload) {
  if (actor.isAdmin) throw new Error('교사용 알림만 확인 처리할 수 있습니다.');
  const id = required(payload.notificationId, '알림');
  const notification = state.notifications.find(row => row.id === id && row.teacher_id === actor.id && !row.resolved_at);
  if (!notification) throw new Error('확인할 알림을 찾을 수 없습니다.');
  const result = await supabase.from('notifications').update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('teacher_id', actor.id);
  if (result.error) throw result.error;
  return { message: '알림을 확인했습니다.' };
}

async function confirmPaper(supabase, state, actor, payload) {
  const id = clean(payload.documentId);
  const doc = state.documents.find(row => row.id === id);
  if (!doc || doc.status !== '수기제출예정') throw new Error('수기 제출 예정 상태인 자료만 확인할 수 있습니다.');
  const result = await supabase.from('documents').update({ status: '수기제출확인', confirmed_by: actor.id, confirmed_at: new Date().toISOString(), note: clean(payload.note) || doc.note }).eq('id', id);
  if (result.error) throw result.error;
  await audit(supabase, actor, '수기 제출 확인', '제출자료', id, { type: doc.document_type });
  return { message: '수기 제출을 확인했습니다.' };
}

async function recordPaperDocument(supabase, state, actor, payload) {
  const classId = required(payload.classId, '공개수업');
  const type = required(payload.type, '자료 유형');
  if (!TEMPLATE_TYPES.includes(type)) throw new Error('자료 유형이 올바르지 않습니다.');
  const cls = state.open_classes.find(row => row.id === classId && row.status === '확정');
  if (!cls) throw new Error('확정된 공개수업을 찾을 수 없습니다.');
  const existing = state.documents.find(row => row.class_id === classId && row.document_type === type && row.submitter_id === cls.teacher_id);
  if (existing && existing.status !== '수기제출예정') throw new Error('이미 제출 처리된 자료입니다.');
  const now = new Date().toISOString();
  const values = adminPaperDocumentRecord(cls, type, actor, now);
  const saved = await supabase.from('documents').upsert(values, { onConflict: 'class_id,document_type,submitter_id' }).select('id').single();
  if (saved.error) throw saved.error;
  await audit(supabase, actor, '관리자 수기 자료 접수', '제출자료', saved.data.id, { classId, type, teacherId: cls.teacher_id });
  return { message: `${type}을 수기 접수 완료로 기록했습니다.` };
}

function adminPaperDocumentRecord(cls, type, actor, now) {
  return {
    class_id: cls.id,
    document_type: type,
    submitter_id: cls.teacher_id,
    submission_method: '수기',
    file_name: '',
    file_path: '',
    status: '수기제출확인',
    submitted_at: now,
    confirmed_by: actor.id || null,
    confirmed_at: now,
    note: '관리자 직접 수기 접수'
  };
}

async function updateOperationPhase(supabase, actor, payload) {
  const phase = clean(payload.phase);
  if (!Object.values(PHASE).includes(phase)) throw new Error('운영 단계를 다시 선택해 주세요.');
  const result = await supabase.from('app_settings').upsert({ setting_key: 'operation_phase', setting_value: phase, description: '준비/공개수업신청/참관신청/수업진행/전체', updated_at: new Date().toISOString() });
  if (result.error) throw result.error;
  await audit(supabase, actor, '운영 단계 변경', '설정', 'operation_phase', { phase });
  return { message: `운영 단계가 ‘${phaseLabel(phase)}’으로 변경되었습니다.` };
}

function reminderFixedRecipients(value) {
  return [...new Set(String(value || '').split(',').map(name => name.trim()).filter(Boolean))];
}

async function updateReminderFixedRecipients(supabase, actor, payload) {
  if (typeof payload.recipients !== 'string' || payload.recipients.length > 1000) {
    throw new Error('고정 수신자는 쉼표로 구분한 이름을 1,000자 이내로 입력해 주세요.');
  }
  const recipients = reminderFixedRecipients(payload.recipients);
  const result = await supabase.from('app_settings').upsert({
    setting_key: 'reminder_fixed_recipients', setting_value: recipients.join(', '),
    description: '수업 리마인드 고정 수신자 (교장·교감·연구부장)', updated_at: new Date().toISOString()
  }, { onConflict: 'setting_key' });
  if (result.error) throw result.error;
  await audit(supabase, actor, '리마인드 고정 수신자 변경', '설정', 'reminder_fixed_recipients', { recipients });
  return { message: `리마인드 고정 수신자 ${recipients.length}명을 저장했습니다.` };
}

async function updateOperationDeadlines(supabase, actor, payload) {
  const openStart = required(payload.openStart, '공개수업 신청 시작일');
  const openDeadline = required(payload.openDeadline, '공개수업 신청 마감일');
  const observationStart = required(payload.observationStart, '참관 신청 시작일');
  const observationDeadline = required(payload.observationDeadline, '참관 신청 마감일');
  if (![openStart, openDeadline, observationStart, observationDeadline].every(isDateText)) throw new Error('신청 기간을 날짜 형식으로 입력해 주세요.');
  if (openDeadline < openStart) throw new Error('공개수업 신청 마감일은 시작일보다 빠를 수 없습니다.');
  if (observationDeadline < observationStart) throw new Error('참관 신청 마감일은 시작일보다 빠를 수 없습니다.');
  if (observationStart <= openStart) throw new Error('참관 신청 시작일은 공개수업 신청 시작일보다 뒤여야 합니다.');
  const updatedAt = new Date().toISOString();
  const result = await supabase.from('app_settings').upsert([
    { setting_key: 'open_application_start', setting_value: openStart, description: '공개수업 신청 안내 시작일', updated_at: updatedAt },
    { setting_key: 'open_application_deadline', setting_value: openDeadline, description: '공개수업 신청 안내 마감일', updated_at: updatedAt },
    { setting_key: 'observation_application_start', setting_value: observationStart, description: '참관 신청 안내 시작일', updated_at: updatedAt },
    { setting_key: 'observation_application_deadline', setting_value: observationDeadline, description: '참관 신청 안내 마감일', updated_at: updatedAt }
  ], { onConflict: 'setting_key' });
  if (result.error) throw result.error;
  await audit(supabase, actor, '신청 기간 변경', '설정', 'application_deadlines', { openStart, openDeadline, observationStart, observationDeadline });
  return { message: `공개수업 신청은 ${openStart}~${openDeadline}, 참관 신청은 ${observationStart}~${observationDeadline}로 안내합니다.` };
}

async function updateAnnualStatusOverride(supabase, state, actor, payload) {
  const teacherId = required(payload.teacherId, '교사');
  const teacher = state.teachers.find(row => row.id === teacherId && row.active && row.role !== '관리자');
  if (!teacher) throw new Error('수정할 교사를 찾을 수 없습니다.');
  const overrides = annualStatusOverrides(state.app_settings);
  if (payload.reset) {
    delete overrides[teacherId];
  } else {
    overrides[teacherId] = {
      firstOpenCompleted: requiredBoolean(payload.firstOpenCompleted, '1학기 공개수업 완료 여부'),
      secondOpenCompleted: requiredBoolean(payload.secondOpenCompleted, '2학기 공개수업 완료 여부'),
      firstObservationCompleted: boundedCount(payload.firstObservationCompleted),
      secondObservationCompleted: boundedCount(payload.secondObservationCompleted),
      updatedAt: new Date().toISOString(),
      updatedBy: actor.name
    };
  }
  const result = await supabase.from('app_settings').upsert({
    setting_key: 'annual_status_overrides',
    setting_value: JSON.stringify(overrides),
    description: '관리자가 수정한 교사별 연간 공개수업·참관 실적',
    updated_at: new Date().toISOString()
  }, { onConflict: 'setting_key' });
  if (result.error) throw result.error;
  await audit(supabase, actor, payload.reset ? '연간 이행 현황 실제 데이터 복원' : '연간 이행 현황 수정', '교사', teacherId, payload.reset ? {} : overrides[teacherId]);
  return { message: payload.reset ? `${teacher.name} 선생님의 실적을 실제 데이터 기준으로 되돌렸습니다.` : `${teacher.name} 선생님의 연간 이행 현황을 수정했습니다.` };
}

async function maybeAutoSyncComcigan(supabase) {
  if (['0', 'false', 'no', 'off'].includes(clean(process.env.COMCIGAN_AUTO_SYNC).toLowerCase())) return { skipped: true, reason: 'disabled' };
  if (!clean(process.env.COMCIGAN_SCHOOL_CODE) && !DEFAULT_COMCIGAN_SCHOOL_CODE) return { skipped: true, reason: 'no-school-code' };
  const intervalMinutes = Math.min(1440, Math.max(5, Number(process.env.COMCIGAN_SYNC_MINUTES) || DEFAULT_COMCIGAN_SYNC_MINUTES));
  const settingsResult = await supabase.from('app_settings').select('setting_key,setting_value').in('setting_key', [
    'comcigan_last_attempt_at', 'comcigan_last_synced_at', 'timetable_manual_lock'
  ]);
  if (settingsResult.error) {
    throw new Error('컴시간 동기화 시각을 확인하지 못했습니다.');
  }
  const settings = settingsMap(settingsResult.data || []);
  if (clean(settings.timetable_manual_lock).toLowerCase() === 'true') return { skipped: true, reason: 'manual-lock' };
  const last = new Date(settings.comcigan_last_attempt_at || settings.comcigan_last_synced_at || 0).getTime();
  if (Number.isFinite(last) && Date.now() - last < intervalMinutes * 60 * 1000) return { skipped: true, reason: 'recent-attempt' };
  return syncComcigan(supabase, { id: null, name: '컴시간 자동 동기화' }, { force: false });
}

module.exports.runScheduledComciganSync = () => maybeAutoSyncComcigan(supabaseClient());

async function syncComcigan(supabase, actor, options = {}) {
  const lockResult = await supabase.from('app_settings').select('setting_value').eq('setting_key', 'timetable_manual_lock').maybeSingle();
  if (lockResult.error) throw lockResult.error;
  if (clean(lockResult.data?.setting_value).toLowerCase() === 'true') {
    throw new Error('현재 확정 PDF 시간표가 고정되어 있습니다. 컴시간 동기화를 실행하지 않았습니다.');
  }
  const attemptedAt = new Date().toISOString();
  await saveComciganSettings(supabase, {
    comcigan_last_attempt_at: attemptedAt,
    comcigan_sync_status: '동기화 중',
    comcigan_sync_error: ''
  });
  try {
    const [currentSourceResult, nextSourceResult] = await Promise.allSettled([fetchComciganData(1), fetchComciganData(2)]);
    if (currentSourceResult.status !== 'fulfilled') throw currentSourceResult.reason;
    const source = currentSourceResult.value;
    const weeklySources = [source];
    if (nextSourceResult.status === 'fulfilled') weeklySources.push(nextSourceResult.value);
    else console.error('컴시간 다음 주 자료 확인 실패:', friendlyError(nextSourceResult.reason));
    const sourceUpdatedAt = clean(source['자료244'] || source['최종변경일'] || source['수정일']);
    const settingResult = await supabase.from('app_settings').select('setting_key,setting_value').in('setting_key', ['comcigan_source_updated_at', 'comcigan_sync_summary']);
    if (settingResult.error) throw settingResult.error;
    const currentSettings = settingsMap(settingResult.data || []);
    const parsed = parseComciganBaseTimetables(source);
    if (!parsed.rows.length) throw new Error('컴시간에서 기본 시간표를 찾지 못했습니다.');
    const [teachers, timetables] = await Promise.all([
      fetchAllRows(supabase, 'teachers'),
      fetchAllRows(supabase, 'timetables')
    ]);
    const matched = matchComciganTeachers(parsed, teachers, timetables);
    if (!matched.matches.length) throw new Error('컴시간의 마스킹된 교사명과 등록 교사명을 연결하지 못했습니다.');

    if (!options.force && sourceUpdatedAt && sourceUpdatedAt === currentSettings.comcigan_source_updated_at) {
      let previousSummary = {};
      try { previousSummary = JSON.parse(currentSettings.comcigan_sync_summary || '{}'); } catch (_error) { previousSummary = {}; }
      const weeklyResult = await refreshComciganWeeklySnapshots(supabase, weeklySources, matched.matches, sourceUpdatedAt);
      const summary = { ...previousSummary, changed: false, schoolCode: comciganSchoolCode(), weeklyRows: weeklyResult.rows, weeklyModifiedRows: weeklyResult.modifiedRows, weeklyStarts: weeklyResult.weekStarts };
      await saveComciganSettings(supabase, {
        comcigan_last_synced_at: attemptedAt,
        comcigan_sync_status: '최신 상태',
        comcigan_sync_summary: JSON.stringify(summary),
        comcigan_sync_error: ''
      });
      return { message: '기본시간표는 최신 상태이며 이번 주와 다음 주 변경 시간표를 새로 확인했습니다.', details: summary };
    }
    const writeResult = await writeComciganTimetables(supabase, parsed.rows, matched.matches, timetables);
    const weeklyResult = await refreshComciganWeeklySnapshots(supabase, weeklySources, matched.matches, sourceUpdatedAt);
    const summary = {
      changed: true,
      matchedTeachers: matched.matches.length,
      timetableRows: writeResult.activeRows,
      insertedRows: writeResult.insertedRows,
      updatedRows: writeResult.updatedRows,
      deactivatedRows: writeResult.deactivatedRows,
      unresolvedNames: matched.unresolvedNames,
      schoolCode: comciganSchoolCode(),
      weeklyRows: weeklyResult.rows,
      weeklyModifiedRows: weeklyResult.modifiedRows,
      weeklyStarts: weeklyResult.weekStarts
    };
    await saveComciganSettings(supabase, {
      comcigan_last_synced_at: attemptedAt,
      comcigan_source_updated_at: sourceUpdatedAt,
      comcigan_sync_status: '정상',
      comcigan_sync_summary: JSON.stringify(summary),
      comcigan_sync_error: ''
    });
    await audit(supabase, actor, actor.id ? '컴시간 수동 동기화' : '컴시간 자동 동기화', '시간표', '', summary);
    return {
      message: `컴시간 시간표를 반영했습니다. 교사 ${summary.matchedTeachers}명, 수업 ${summary.timetableRows}건입니다.${summary.unresolvedNames.length ? ` 연결하지 못한 이름 ${summary.unresolvedNames.length}건은 기존 시간표를 유지했습니다.` : ''}`,
      details: summary
    };
  } catch (error) {
    const message = friendlyError(error);
    await saveComciganSettings(supabase, { comcigan_sync_status: '오류', comcigan_sync_error: message });
    throw new Error(`컴시간 시간표를 불러오지 못했습니다: ${message}`);
  }
}

function comciganSchoolCode() {
  const code = clean(process.env.COMCIGAN_SCHOOL_CODE) || DEFAULT_COMCIGAN_SCHOOL_CODE;
  if (!code) throw new Error('COMCIGAN_SCHOOL_CODE 환경변수를 설정해 주세요.');
  return code;
}

async function fetchComciganData(weekNumber = 1) {
  const requestedWeek = [1, 2].includes(Number(weekNumber)) ? Number(weekNumber) : 1;
  const token = Buffer.from(`73629_${comciganSchoolCode()}_0_${requestedWeek}`, 'utf8').toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetch(`${COMCIGAN_API_BASE}?${token}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'SchoolOpenClassTimetableSync/2.2' }
    });
    if (!result.ok) throw new Error(`컴시간 서버 응답 오류(${result.status})`);
    const text = (await result.text()).replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('컴시간 응답에서 JSON 내용을 찾지 못했습니다.');
    const data = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    if (!data || !Array.isArray(data['자료446'])) throw new Error('컴시간 응답 형식이 예상과 다릅니다.');
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('컴시간 서버 응답 시간이 초과되었습니다.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseComciganBaseTimetables(data) {
  const teacherNames = Array.isArray(data['자료446']) ? data['자료446'] : [];
  const subjectNames = Array.isArray(data['자료492']) ? data['자료492'] : [];
  const classTimetables = Array.isArray(data['자료481']) ? data['자료481'] : [];
  const split = Number(data['분리']) || 1000;
  const rows = [];
  const seen = new Set();
  for (let grade = 1; grade < classTimetables.length; grade += 1) {
    const gradeRows = classTimetables[grade];
    if (!Array.isArray(gradeRows)) continue;
    for (let classNumber = 1; classNumber < gradeRows.length; classNumber += 1) {
      const classRows = gradeRows[classNumber];
      if (!Array.isArray(classRows)) continue;
      for (let day = 1; day <= 5; day += 1) {
        const periodRows = classRows[day];
        if (!Array.isArray(periodRows)) continue;
        for (let period = 1; period < periodRows.length; period += 1) {
          const encoded = comciganNumber(periodRows[period]);
          if (!encoded) continue;
          const teacherIndex = split === 100 ? Math.floor(encoded / split) : encoded % split;
          const subjectIndex = split === 100 ? encoded % split : Math.floor(encoded / split);
          const maskedName = clean(teacherNames[teacherIndex]);
          if (!teacherIndex || !maskedName) continue;
          const className = `${grade}-${classNumber}`;
          const key = `${teacherIndex}|${day}|${period}|${className}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            externalTeacherIndex: teacherIndex,
            maskedName,
            weekday: ['','월','화','수','목','금'][day],
            period,
            className,
            room: className,
            subject: clean(subjectNames[subjectIndex]) || '교과 미분류'
          });
        }
      }
    }
  }
  return { rows, teacherNames, subjectNames, sourceUpdatedAt: clean(data['자료244']) };
}

function comciganNumber(value) {
  const match = clean(value).match(/-?\d+/);
  return match ? Math.abs(Number(match[0])) : 0;
}

function matchComciganTeachers(parsed, teachers, timetables) {
  const activeTeachers = teachers.filter(row => row.active && row.role !== '관리자');
  const rowsByExternal = groupBy(parsed.rows, row => row.externalTeacherIndex);
  const existingByTeacher = groupBy(timetables.filter(row => row.active), row => row.teacher_id);
  const usedTeacherIds = new Set();
  const matches = [];
  const unresolvedNames = [];
  [...rowsByExternal.entries()].forEach(([externalTeacherIndex, rows]) => {
    const maskedName = clean(rows[0] && rows[0].maskedName);
    let candidates = activeTeachers.filter(teacher => !usedTeacherIds.has(teacher.id) && maskName(teacher.name) === maskedName);
    if (!candidates.length) {
      unresolvedNames.push(maskedName || `교사 ${externalTeacherIndex}`);
      return;
    }
    if (candidates.length > 1) {
      const subjects = new Set(rows.map(row => clean(row.subject)).filter(Boolean));
      const subjectMatches = candidates.filter(teacher => subjects.has(clean(teacher.subject_group)));
      if (subjectMatches.length === 1) candidates = subjectMatches;
    }
    if (candidates.length > 1) {
      const sourceSlots = new Set(rows.map(row => `${row.weekday}|${row.period}|${classIdentity(row.className)}`));
      const scored = candidates.map(teacher => ({
        teacher,
        score: (existingByTeacher.get(teacher.id) || []).reduce((count, row) => count + (sourceSlots.has(`${row.weekday}|${row.period}|${classIdentity(row.class_name)}`) ? 1 : 0), 0)
      })).sort((left, right) => right.score - left.score);
      if (scored[0].score > 0 && (!scored[1] || scored[0].score > scored[1].score)) candidates = [scored[0].teacher];
    }
    if (candidates.length !== 1) {
      unresolvedNames.push(maskedName);
      return;
    }
    usedTeacherIds.add(candidates[0].id);
    matches.push({ externalTeacherIndex: Number(externalTeacherIndex), teacher: candidates[0] });
  });
  return { matches, unresolvedNames: unique(unresolvedNames) };
}

function parseComciganWeeklyTimetables(data) {
  const current = Array.isArray(data['자료147']) ? data['자료147'] : [];
  const original = Array.isArray(data['자료481']) ? data['자료481'] : [];
  const teacherNames = Array.isArray(data['자료446']) ? data['자료446'] : [];
  const subjectNames = Array.isArray(data['자료492']) ? data['자료492'] : [];
  const split = Number(data['분리']) || 1000;
  const providedStart = clean(data['시작일']);
  const weekStart = isDateText(providedStart) ? mondayKey(providedStart) : mondayKey(todayKey());
  const rows = [];
  const seen = new Set();

  for (let grade = 1; grade < current.length; grade += 1) {
    const gradeRows = current[grade];
    if (!Array.isArray(gradeRows)) continue;
    for (let classNumber = 1; classNumber < gradeRows.length; classNumber += 1) {
      const classRows = gradeRows[classNumber];
      if (!Array.isArray(classRows)) continue;
      for (let day = 1; day <= 5; day += 1) {
        const periods = classRows[day];
        if (!Array.isArray(periods)) continue;
        for (let period = 1; period < periods.length; period += 1) {
          const encoded = comciganNumber(periods[period]);
          if (!encoded) continue;
          const teacherIndex = split === 100 ? Math.floor(encoded / split) : encoded % split;
          const subjectIndex = split === 100 ? encoded % split : Math.floor(encoded / split);
          const maskedName = clean(teacherNames[teacherIndex]);
          if (!teacherIndex || !maskedName) continue;
          const className = `${grade}-${classNumber}`;
          const key = `${teacherIndex}|${day}|${period}|${className}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const originalEncoded = comciganNumber(original?.[grade]?.[classNumber]?.[day]?.[period]);
          const originalTeacherIndex = split === 100 ? Math.floor(originalEncoded / split) : originalEncoded % split;
          const originalSubjectIndex = split === 100 ? originalEncoded % split : Math.floor(originalEncoded / split);
          rows.push({
            externalTeacherIndex: teacherIndex,
            maskedName,
            weekday: ['','월','화','수','목','금'][day],
            lessonDate: addDateDays(weekStart, day - 1),
            period,
            className,
            room: className,
            subject: clean(subjectNames[subjectIndex]) || '교과 미분류',
            isModified: encoded !== originalEncoded,
            originalClassName: originalEncoded && originalTeacherIndex === teacherIndex ? className : '',
            originalSubject: originalEncoded && originalTeacherIndex === teacherIndex ? (clean(subjectNames[originalSubjectIndex]) || '') : ''
          });
        }
      }
    }
  }
  return { weekStart, rows };
}

async function refreshComciganWeeklySnapshots(supabase, sources, matches, sourceUpdatedAt) {
  const parsedByWeek = new Map();
  (sources || []).forEach(source => {
    const parsed = parseComciganWeeklyTimetables(source);
    if (parsed.rows.length) parsedByWeek.set(parsed.weekStart, parsed);
  });
  let rows = 0;
  let modifiedRows = 0;
  for (const parsed of parsedByWeek.values()) {
    const result = await writeComciganWeeklyTimetables(supabase, parsed.rows, matches, parsed.weekStart, sourceUpdatedAt);
    rows += result.rows;
    modifiedRows += result.modifiedRows;
  }
  return { rows, modifiedRows, weekStarts: [...parsedByWeek.keys()].sort() };
}

async function writeComciganWeeklyTimetables(supabase, sourceRows, matches, weekStart, sourceUpdatedAt) {
  const teacherByExternal = new Map(matches.map(item => [item.externalTeacherIndex, item.teacher]));
  const rows = sourceRows.map(source => {
    const teacher = teacherByExternal.get(source.externalTeacherIndex);
    if (!teacher) return null;
    return {
      week_start: weekStart,
      lesson_date: source.lessonDate,
      teacher_id: teacher.id,
      weekday: source.weekday,
      period: source.period,
      class_name: source.className,
      room: source.room,
      subject: source.subject || clean(teacher.subject_group),
      is_modified: Boolean(source.isModified),
      original_class_name: source.originalClassName,
      original_subject: source.originalSubject,
      source_updated_at: clean(sourceUpdatedAt),
      synced_at: new Date().toISOString()
    };
  }).filter(Boolean);
  const removed = await supabase.from('weekly_timetables').delete().eq('week_start', weekStart);
  if (removed.error) throw removed.error;
  for (const part of chunks(rows, 400)) {
    const inserted = await supabase.from('weekly_timetables').insert(part);
    if (inserted.error) throw inserted.error;
  }
  return { rows: rows.length, modifiedRows: rows.filter(row => row.is_modified).length };
}

async function writeComciganTimetables(supabase, sourceRows, matches, existingTimetables) {
  const teacherByExternal = new Map(matches.map(item => [item.externalTeacherIndex, item.teacher]));
  const matchedTeacherIds = new Set(matches.map(item => item.teacher.id));
  const existingByTeacher = groupBy(existingTimetables.filter(row => matchedTeacherIds.has(row.teacher_id)), row => row.teacher_id);
  const usedIds = new Set();
  const updateRows = [];
  const insertRows = [];

  sourceRows.forEach(source => {
    const teacher = teacherByExternal.get(source.externalTeacherIndex);
    if (!teacher) return;
    const existing = existingByTeacher.get(teacher.id) || [];
    const exact = existing.find(row => !usedIds.has(row.id) && row.weekday === source.weekday && Number(row.period) === source.period && sameClassIdentity(row.class_name, source.className));
    const sameSlot = exact || existing.find(row => !usedIds.has(row.id) && row.weekday === source.weekday && Number(row.period) === source.period);
    const values = {
      teacher_id: teacher.id,
      weekday: source.weekday,
      period: source.period,
      class_name: source.className,
      room: exact && clean(exact.room) ? clean(exact.room) : source.room,
      subject: source.subject || clean(teacher.subject_group),
      open_class_eligible: sameSlot ? sameSlot.open_class_eligible !== false : true,
      active: true
    };
    if (sameSlot) {
      usedIds.add(sameSlot.id);
      updateRows.push({ id: sameSlot.id, ...values });
    } else insertRows.push(values);
  });

  for (const rows of chunks(updateRows, 400)) {
    const result = await supabase.from('timetables').upsert(rows, { onConflict: 'id' });
    if (result.error) throw result.error;
  }
  for (const rows of chunks(insertRows, 400)) {
    const result = await supabase.from('timetables').insert(rows);
    if (result.error) throw result.error;
  }
  const deactivateIds = existingTimetables
    .filter(row => matchedTeacherIds.has(row.teacher_id) && row.active && !usedIds.has(row.id))
    .map(row => row.id);
  for (const ids of chunks(deactivateIds, 400)) {
    const result = await supabase.from('timetables').update({ active: false }).in('id', ids);
    if (result.error) throw result.error;
  }
  return { activeRows: updateRows.length + insertRows.length, updatedRows: updateRows.length, insertedRows: insertRows.length, deactivatedRows: deactivateIds.length };
}

async function saveComciganSettings(supabase, values) {
  const descriptions = {
    comcigan_last_attempt_at: '컴시간 마지막 연결 시도 시각',
    comcigan_last_synced_at: '컴시간 마지막 성공 시각',
    comcigan_source_updated_at: '컴시간 원본 마지막 수정 정보',
    comcigan_sync_status: '컴시간 동기화 상태',
    comcigan_sync_summary: '컴시간 최근 동기화 요약',
    comcigan_sync_error: '컴시간 최근 동기화 오류',
    timetable_manual_lock: '확정 PDF 시간표 자동 덮어쓰기 방지'
  };
  const updatedAt = new Date().toISOString();
  const rows = Object.entries(values).map(([setting_key, setting_value]) => ({
    setting_key,
    setting_value: clean(setting_value),
    description: descriptions[setting_key] || '컴시간 시간표 동기화',
    updated_at: updatedAt
  }));
  const result = await supabase.from('app_settings').upsert(rows, { onConflict: 'setting_key' });
  if (result.error) throw result.error;
}

function comciganSyncStatus(rows) {
  const settings = settingsMap(rows);
  let summary = {};
  try { summary = JSON.parse(settings.comcigan_sync_summary || '{}'); } catch (_error) { summary = {}; }
  const environmentEnabled = !['0', 'false', 'no', 'off'].includes(clean(process.env.COMCIGAN_AUTO_SYNC).toLowerCase());
  const locked = clean(settings.timetable_manual_lock).toLowerCase() === 'true';
  return {
    enabled: environmentEnabled && !locked,
    locked,
    intervalMinutes: Math.min(1440, Math.max(5, Number(process.env.COMCIGAN_SYNC_MINUTES) || DEFAULT_COMCIGAN_SYNC_MINUTES)),
    status: settings.comcigan_sync_status || '동기화 전',
    lastSyncedAt: settings.comcigan_last_synced_at || '',
    sourceUpdatedAt: settings.comcigan_source_updated_at || '',
    error: settings.comcigan_sync_error || '',
    matchedTeachers: Number(summary.matchedTeachers) || 0,
    timetableRows: Number(summary.timetableRows) || 0,
    unresolvedNames: Array.isArray(summary.unresolvedNames) ? summary.unresolvedNames : []
  };
}

function groupBy(rows, keySelector) {
  const map = new Map();
  (rows || []).forEach(row => {
    const key = keySelector(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function chunks(rows, size) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function buildMessage(state, payload) {
  if (['openApplication', 'observationApplication', 'observationShortage'].includes(payload.type)) return buildStageMessage(state, payload.type);
  const classes = state.open_classes.map(row => mapClass(row, state));
  const cls = classes.find(item => item.id === clean(payload.classId));
  if (!cls) throw new Error('공개수업을 찾을 수 없습니다.');
  const observers = state.observations.filter(row => row.class_id === cls.id && row.status === '확정').map(row => teacherName(state, row.observer_id));
  const when = `${formatKoreanDate(cls.date)} ${cls.period}교시`;
  const base = `일시: ${when}\n대상: ${cls.className}\n장소: ${cls.room}`;
  if (payload.type === 'presenterPrep') return buildPresenterPrepMessage(state, cls, base, observers.length, payload);
  if (payload.type === 'presenter') return `[2학기 수업공개 일정 안내]\n${cls.teacherName} 선생님의 수업공개 일정이 확정되었습니다.\n${base}\n수업 준비를 부탁드립니다.`;
  if (payload.type === 'observers') return `[수업공개 참관 안내]\n${cls.teacherName} 선생님의 공개수업 참관 일정을 안내드립니다.\n${base}\n참관 예정: ${observers.length ? observers.join(', ') + ' 선생님' : '신청자 없음'}`;
  if (payload.type === 'attendance') return `[참관 여부 확인 요청]\n${cls.teacherName} 선생님께서 공개하신 ${when} 수업의 참관 여부를 시스템에서 확인해 주시기 바랍니다.`;
  if (payload.type === 'change') return `[수업공개 일정 변경 안내]\n${cls.teacherName} 선생님의 공개수업 일정이 변경되었습니다.\n${base}\n참관 예정 선생님께서는 변경된 일정을 확인해 주시기 바랍니다.`;
  if (payload.type === 'reminder') return buildClassReminderMessage(cls, observers);
  if (payload.type === 'documentReminder') return buildDocumentReminderMessage(state, cls);
  throw new Error('안내 문구 유형이 올바르지 않습니다.');
}

function buildPresenterPrepMessage(state, cls, base, observerCount, payload) {
  const submitted = new Set((state.documents || [])
    .filter(row => row.class_id === cls.id && row.submitter_id === cls.teacherId && ['온라인제출', '수기제출확인'].includes(row.status))
    .map(row => clean(row.document_type)));
  const deadline = clean(payload.lessonPlanDeadline) || '수업 하루 전까지';
  const lessonPlan = submitted.has('지도안') ? '제출 완료' : `${deadline} 제출해 주세요.`;
  const observation = `${submitted.has('참관록') ? '제출 완료 · ' : ''}참관록 양식을 참관인에게 배부해 주세요.`;
  const conference = submitted.has('협의록') ? '제출 완료' : '수업 후 수업나눔 협의록을 제출해 주세요.';
  return `[공개 교사 준비 안내]\n\n${cls.teacherName} 선생님, 공개수업 준비를 부탁드립니다.\n\n${base}\n참관 예정 인원: ${observerCount}명\n\n준비할 자료\n1. 수업 지도안: ${lessonPlan}\n2. 참관록: ${observation}\n3. 수업나눔 협의록: ${conference}\n\n양식 내려받기: 웹앱 > 공개수업 운영 > 공용 양식 자료실\n제출 위치: 웹앱 > 공개수업 운영 > 자료 제출${appUrlFor(state) ? `\n\n${appUrlFor(state)}` : ''}\n\n감사합니다.`;
}

function buildDocumentReminderMessage(state, cls) {
  const submitted = new Set(state.documents
    .filter(row => row.class_id === cls.id && row.submitter_id === cls.teacherId)
    .map(row => clean(row.document_type)));
  const missing = TEMPLATE_TYPES.filter(type => !submitted.has(type));
  if (!missing.length) throw new Error('선택한 선생님은 지도안, 협의록, 참관록을 모두 제출했습니다.');
  const missingLabel = missing.join(', ');
  return `[공개수업 제출자료 안내]\n\n${cls.teacherName} 선생님은 현재 ${missingLabel} 미제출 상태입니다.\n\n- 공개수업 일정: ${formatKoreanDate(cls.date)} ${cls.period}교시\n- 제출 위치: 웹앱 > 공개수업 운영 > 자료 제출\n- 종이로 제출하실 경우 해당 자료의 ‘수기 제출 예정’ 버튼을 눌러 주세요.\n\n이미 제출하신 경우에는 이 메시지를 무시해 주세요. 감사합니다.${appUrlFor(state) ? `\n\n${appUrlFor(state)}` : ''}`;
}

function buildStageMessage(state, type) {
  const settings = settingsMap(state.app_settings);
  const openStart = validDateSetting(settings.open_application_start, DEFAULT_OPEN_APPLICATION_START);
  const openEnd = validDateSetting(settings.open_application_deadline, DEFAULT_OPEN_APPLICATION_DEADLINE);
  const observationStart = validDateSetting(settings.observation_application_start, DEFAULT_OBSERVATION_APPLICATION_START);
  const observationEnd = validDateSetting(settings.observation_application_deadline, DEFAULT_OBSERVATION_APPLICATION_DEADLINE);
  const appUrl = appUrlFor(state);
  const schoolYearText = settings.school_year || String(new Date().getFullYear());
  if (type === 'openApplication') return `[${schoolYearText}학년도 2학기 공개수업 신청 안내]\n\n1학기에 공개수업을 완료하지 않은 선생님께서는 웹앱에서 본인의 시간표를 선택하여 2학기 공개수업 일정을 신청해 주시기 바랍니다.\n\n- 신청 기간: ${messageDateRange(openStart, openEnd)}\n- 관리자 확정 전에는 자유롭게 수정할 수 있습니다.\n\n${appUrl}\n\n기한 내 신청 부탁드립니다. 감사합니다.`;
  if (type === 'observationApplication') return `[${schoolYearText}학년도 2학기 참관 신청 안내]\n\n확정된 공개수업 일정을 확인하고 참관 신청을 해주시기 바랍니다. 참관은 1·2학기를 합하여 연간 2회 이상이며, 한 공개수업의 정원은 최대 4명입니다.\n\n- 신청 기간: ${messageDateRange(observationStart, observationEnd)}\n- 본인의 수업과 겹치는 일정은 자동으로 제외됩니다.\n- 한 공개수업에 가급적 2명 이상의 참관인이 참여할 수 있도록 협조 부탁드립니다.\n\n${appUrl}\n\n감사합니다.`;
  return `[2학기 공개수업 참관 인원 협조 요청]\n\n현재 일부 공개수업의 참관 신청 인원이 2명 미만입니다. 아직 연간 참관 2회를 완료하지 않은 선생님께서는 참관인이 부족한 수업을 우선하여 신청해 주시면 감사하겠습니다.\n\n- 참관 신청 마감: ${messageDateRange(observationStart, observationEnd)}\n- 한 공개수업의 정원: 최대 4명\n\n${appUrl}\n\n감사합니다.`;
}

function messageDateRange(start, end) {
  const label = value => {
    const [, month, day] = String(value || '').split('-').map(Number);
    return `${month}월 ${day}일`;
  };
  return start === end ? label(start) : `${label(start)}~${label(end)}`;
}

function buildClassReminderMessage(cls, observers, referenceDate = todayKey()) {
  const [, month, day] = String(cls.date || '').split('-').map(Number);
  const selectedDate = `${month}.${day}.`;
  const dateLabel = cls.date === referenceDate ? `오늘(${selectedDate})` : `${selectedDate}(${weekday(cls.date)})`;
  const classLabel = clean(cls.className) || '대상 학급 미입력';
  const roomLine = clean(cls.room) ? `\n - 장소: ${clean(cls.room)}` : '';
  const observerLine = observers.length ? `\n - 참관 예정: ${observers.join(', ')} 선생님` : '\n - 참관 예정자가 아직 없습니다.';
  const roomTarget = clean(cls.room) ? `${clean(cls.room)}에` : '공개수업 교실에';
  const preparation = `[준비 사항]\n - 수업공개 하시는 선생님: 참관 선생님들이 지도안을 직접 조회할 수 없으니, 수업 지도안과 참관록을 참관 인원(${observers.length}명)에 여유분 1부를 더해 ${observers.length + 1}부씩 인쇄하여 수업 시작 전 ${roomTarget} 비치해 주시면 감사하겠습니다.\n - 참관 선생님: 간단한 필기구를 지참하여 참관 후 참관록을 수업공개 선생님께 제출 부탁드립니다. 지도안을 미리 보고 싶으시면 수업공개 선생님께 문의 바랍니다.`;
  return `<수업공개> 관련입니다.\n\n - 메시지 받으시는 선생님들은 ${dateLabel} 수업공개·참관이 있는 분들입니다.\n\n - (${classLabel}) ${cls.period}교시 ${cls.teacherName} 선생님 수업공개에 참관 부탁드립니다.${roomLine}${observerLine}\n\n${preparation}\n\n감사합니다.`;
}

async function importFirstSemesterCsv(supabase, state, actor, payload) {
  const csvText = String(payload.csvText || '').replace(/^\uFEFF/, '');
  if (!csvText.trim()) throw new Error('CSV 파일 내용이 없습니다.');
  const rows = parseCsv(csvText);
  if (rows.length < 2 || clean(rows[0][0]) !== '성명') throw new Error('첫 번째 열이 성명인 지정된 CSV 파일을 선택해 주세요.');
  const header = rows[0].map(clean);
  const observerStart = header.indexOf('참관 희망 교사');
  const documentStart = header.indexOf('지도안');
  if (observerStart < 0 || documentStart <= observerStart) throw new Error('참관 희망 교사와 지도안 열을 확인할 수 없습니다.');
  const sourceRows = rows.slice(1).filter(row => row.some(cell => clean(cell)));
  const presenterMeta = new Map();
  const allNames = new Set();
  sourceRows.forEach(row => {
    const name = clean(row[0]);
    if (name) {
      presenterMeta.set(name, { target: clean(row[1]).toUpperCase() === 'TRUE', hasSchedule: Boolean(clean(row[2]) && clean(row[3])) });
      allNames.add(name);
    }
    row.slice(observerStart, documentStart).map(clean).filter(Boolean).forEach(nameText => allNames.add(nameText));
  });
  const existingByName = new Map(state.teachers.filter(row => row.role !== '관리자').map(row => [clean(row.name), row]));
  let updated = 0;
  let added = 0;
  const teacherRecords = [...allNames].map(name => {
    const existing = existingByName.get(name);
    const meta = presenterMeta.get(name);
    if (existing) updated += 1; else added += 1;
    return {
      id: existing ? existing.id : crypto.randomUUID(), name,
      email: existing ? existing.email : null,
      subject_group: existing ? existing.subject_group : '교과 미분류',
      role: existing ? existing.role : '일반교사',
      second_semester_target: meta ? meta.target : (existing ? existing.second_semester_target : false),
      exclusion_reason: meta ? (meta.hasSchedule ? '1학기 공개 완료' : (meta.target ? '' : '대상 여부 확인 필요')) : (existing ? existing.exclusion_reason : 'CSV 참관자·2학기 대상 확인 필요'),
      active: existing ? existing.active : true,
      created_at: existing ? existing.created_at : new Date().toISOString()
    };
  });
  const teacherUpsert = await supabase.from('teachers').upsert(teacherRecords, { onConflict: 'id' });
  if (teacherUpsert.error) throw teacherUpsert.error;
  const freshTeachersResult = await supabase.from('teachers').select('*');
  if (freshTeachersResult.error) throw freshTeachersResult.error;
  const teacherByName = new Map((freshTeachersResult.data || []).map(row => [clean(row.name), row]));
  const schoolYear = Number(settingsMap(state.app_settings).school_year) || new Date().getFullYear();
  const importedAt = new Date().toISOString();
  const existingClasses = state.open_classes.filter(row => row.source === '1학기 CSV');
  const classByKey = new Map(existingClasses.map(row => [row.source_key, row]));
  const desiredClassKeys = new Set();
  const importedClasses = [];
  for (const source of sourceRows) {
    const teacherNameText = clean(source[0]);
    const month = Number(clean(source[2]));
    const day = Number(clean(source[3]));
    const period = Number(clean(source[5]));
    if (!teacherNameText || !month || !day || !period) continue;
    const teacher = teacherByName.get(teacherNameText);
    if (!teacher) continue;
    const date = `${schoolYear}-${pad(month)}-${pad(day)}`;
    if (!isDateText(date)) continue;
    const sourceKey = `CSV1|${teacherNameText}|${date}|${period}`;
    desiredClassKeys.add(sourceKey);
    const observerNames = unique(source.slice(observerStart, documentStart).map(clean).filter(Boolean));
    const documentTypes = checkedCsvDocumentTypes(header, source);
    const existing = classByKey.get(sourceKey);
    importedClasses.push({
      id: existing ? existing.id : crypto.randomUUID(), teacher_id: teacher.id, class_date: date,
      weekday: normalizeWeekday(source[4]) || weekday(date), period, subject: teacher.subject_group || '',
      class_name: clean(source[6]) || '학급 미입력', room: clean(source[7]) || '장소 미입력', topic: '',
      capacity: Math.max(DEFAULT_CAPACITY, observerNames.length), status: '확정',
      submitted_at: existing ? existing.submitted_at : `${date}T03:00:00.000Z`, processed_by: actor.id,
      processed_at: importedAt, admin_note: '1학기 CSV 실적', semester: 1, source: '1학기 CSV', source_key: sourceKey,
      observerNames, documentTypes
    });
  }
  if (importedClasses.length) {
    const rowsToSave = importedClasses.map(({ observerNames, documentTypes, ...row }) => row);
    const classUpsert = await supabase.from('open_classes').upsert(rowsToSave, { onConflict: 'id' });
    if (classUpsert.error) throw classUpsert.error;
  }
  const obsoleteClassIds = existingClasses.filter(row => !desiredClassKeys.has(row.source_key)).map(row => row.id);
  if (obsoleteClassIds.length) await supabase.from('open_classes').update({ status: '취소' }).in('id', obsoleteClassIds);
  const existingObservations = state.observations.filter(row => row.source === '1학기 CSV');
  const observationByKey = new Map(existingObservations.map(row => [row.source_key, row]));
  const desiredObservationKeys = new Set();
  const observationRows = [];
  const completedByTeacher = new Map();
  importedClasses.forEach(cls => cls.observerNames.forEach(observerName => {
    const observer = teacherByName.get(observerName);
    if (!observer) return;
    const sourceKey = `CSV1OBS|${cls.id}|${observerName}`;
    desiredObservationKeys.add(sourceKey);
    const existing = observationByKey.get(sourceKey);
    observationRows.push({
      id: existing ? existing.id : crypto.randomUUID(), class_id: cls.id, observer_id: observer.id,
      applied_at: existing ? existing.applied_at : `${cls.class_date}T03:00:00.000Z`, status: '확정', canceled_at: null,
      attendance: '참석', attendance_checked_by: actor.id, attendance_checked_at: importedAt,
      note: '1학기 CSV 실적', semester: 1, source: '1학기 CSV', source_key: sourceKey
    });
    completedByTeacher.set(observerName, (completedByTeacher.get(observerName) || 0) + 1);
  }));
  if (observationRows.length) {
    const observationUpsert = await supabase.from('observations').upsert(observationRows, { onConflict: 'id' });
    if (observationUpsert.error) throw observationUpsert.error;
  }
  const obsoleteObservationIds = existingObservations.filter(row => !desiredObservationKeys.has(row.source_key)).map(row => row.id);
  if (obsoleteObservationIds.length) await supabase.from('observations').update({ status: '취소', attendance: '불참', canceled_at: importedAt }).in('id', obsoleteObservationIds);
  const importedClassIds = new Set(importedClasses.map(row => row.id));
  const existingDocumentByKey = new Map(state.documents.map(row => [`${row.class_id}|${row.document_type}|${row.submitter_id}`, row]));
  const desiredDocumentKeys = new Set();
  const documentRows = [];
  let preservedDocuments = 0;
  importedClasses.forEach(cls => cls.documentTypes.forEach(type => {
    const key = `${cls.id}|${type}|${cls.teacher_id}`;
    desiredDocumentKeys.add(key);
    const existing = existingDocumentByKey.get(key);
    if (existing && clean(existing.note) !== FIRST_SEMESTER_CSV_DOCUMENT_NOTE) {
      preservedDocuments += 1;
      return;
    }
    documentRows.push({
      class_id: cls.id,
      document_type: type,
      submitter_id: cls.teacher_id,
      submission_method: '수기',
      file_name: '',
      file_path: '',
      status: '수기제출확인',
      submitted_at: existing ? existing.submitted_at : `${cls.class_date}T03:00:00.000Z`,
      confirmed_by: actor.id || null,
      confirmed_at: importedAt,
      note: FIRST_SEMESTER_CSV_DOCUMENT_NOTE
    });
  }));
  if (documentRows.length) {
    const documentUpsert = await supabase.from('documents').upsert(documentRows, { onConflict: 'class_id,document_type,submitter_id' });
    if (documentUpsert.error) throw documentUpsert.error;
  }
  const obsoleteDocumentIds = state.documents
    .filter(row => importedClassIds.has(row.class_id) && clean(row.note) === FIRST_SEMESTER_CSV_DOCUMENT_NOTE)
    .filter(row => !desiredDocumentKeys.has(`${row.class_id}|${row.document_type}|${row.submitter_id}`))
    .map(row => row.id);
  if (obsoleteDocumentIds.length) {
    const removed = await supabase.from('documents').delete().in('id', obsoleteDocumentIds);
    if (removed.error) throw removed.error;
  }
  const completedTwo = [...completedByTeacher.values()].filter(count => count >= 2).length;
  await audit(supabase, actor, '1학기 CSV 가져오기', '1학기 실적', '', { updated, added, classes: importedClasses.length, observations: observationRows.length, documents: desiredDocumentKeys.size });
  return {
    message: `1학기 실적을 반영했습니다. 공개수업 ${importedClasses.length}건, 참관 ${observationRows.length}건, 제출자료 ${desiredDocumentKeys.size}건입니다.`,
    details: { teachersUpdated: updated, teachersAdded: added, publicClasses: importedClasses.length, observations: observationRows.length, observersCompletedTwo: completedTwo, documents: desiredDocumentKeys.size, preservedDocuments }
  };
}

function buildAdminData(state, classes) {
  const activeTeachers = state.teachers.filter(row => row.active && row.role !== '관리자');
  const activeObservations = state.observations.filter(row => row.status === '확정');
  const classById = new Map(classes.map(cls => [cls.id, cls]));
  const overrides = annualStatusOverrides(state.app_settings);
  const counts = new Map();
  const bySemester = new Map();
  activeObservations.filter(row => row.attendance === '참석').forEach(row => {
    counts.set(row.observer_id, (counts.get(row.observer_id) || 0) + 1);
    const semester = row.semester === 1 ? 1 : (classById.get(row.class_id)?.semester || 2);
    if (!bySemester.has(row.observer_id)) bySemester.set(row.observer_id, { 1: 0, 2: 0 });
    bySemester.get(row.observer_id)[semester] += 1;
  });
  const secondApplicationsByTeacher = new Map();
  activeObservations.forEach(row => {
    const semester = row.semester === 1 ? 1 : (classById.get(row.class_id)?.semester || 2);
    if (semester !== 2 || row.attendance === '불참') return;
    secondApplicationsByTeacher.set(row.observer_id, (secondApplicationsByTeacher.get(row.observer_id) || 0) + 1);
  });
  const annualTeacherStatuses = activeTeachers.map(teacher => {
    const teacherClasses = classes.filter(cls => cls.teacherId === teacher.id);
    const override = overrides[teacher.id] || {};
    const firstOpenCompleted = overriddenBoolean(override, 'firstOpenCompleted', teacherClasses.some(cls => cls.semester === 1 && isCompletedClass(cls)));
    const secondClasses = teacherClasses.filter(cls => cls.semester === 2);
    const secondOpenCompleted = overriddenBoolean(override, 'secondOpenCompleted', secondClasses.some(isCompletedClass));
    const confirmedSecond = secondClasses.filter(cls => cls.status === '확정');
    let secondOpenStatus = secondOpenCompleted ? '완료' : confirmedSecond.some(cls => cls.date > todayKey()) ? '예정' : confirmedSecond.length ? '미완료' : secondClasses.some(cls => cls.status === '승인대기') ? '승인대기' : '미신청';
    if (secondOpenStatus === '미신청' && !teacher.second_semester_target) secondOpenStatus = firstOpenCompleted ? '대상 제외' : '대상 아님';
    const firstCount = overriddenCount(override, 'firstObservationCompleted', bySemester.get(teacher.id)?.[1] || 0);
    const secondCount = overriddenCount(override, 'secondObservationCompleted', bySemester.get(teacher.id)?.[2] || 0);
    const annualCount = firstCount + secondCount;
    const secondApplicationStatus = secondSemesterObservationApplicationStatus(firstCount, secondCount, secondApplicationsByTeacher.get(teacher.id) || 0, !isObservationExempt(teacher));
    return {
      id: teacher.id, name: teacher.name, subject: teacher.subject_group, isSecondSemesterTarget: teacher.second_semester_target, secondOpenApplied: secondClasses.some(cls => ['승인대기', '확정'].includes(cls.status)), manualOverride: Boolean(overrides[teacher.id]),
      firstOpenCompleted, secondOpenStatus, secondOpenCompleted, annualOpenCompleted: firstOpenCompleted || secondOpenCompleted,
      firstObservationCompleted: firstCount, secondObservationCompleted: secondCount, annualObservationCompleted: annualCount,
      secondObservationTarget: secondApplicationStatus.target,
      secondObservationRequired: secondApplicationStatus.required,
      secondObservationApplied: secondApplicationStatus.applied,
      secondObservationRemaining: secondApplicationStatus.remaining,
      secondObservationApplicationComplete: secondApplicationStatus.complete,
      observationRequirementMet: annualCount >= 2, allRequirementsMet: (firstOpenCompleted || secondOpenCompleted) && annualCount >= 2
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const attendanceVerification = classes.filter(cls => cls.semester === 2 && cls.status === '확정' && cls.date <= todayKey()).map(cls => {
    const rows = activeObservations.filter(row => row.class_id === cls.id);
    const checked = rows.filter(row => ['참석', '불참'].includes(row.attendance)).length;
    return { classId: cls.id, date: cls.date, period: cls.period, teacherName: cls.teacherName, className: cls.className, total: rows.length, checked, present: rows.filter(row => row.attendance === '참석').length, complete: rows.length > 0 && checked === rows.length };
  }).filter(item => item.total > 0).sort((a, b) => b.date.localeCompare(a.date) || b.period - a.period);
  const secondClasses = classes.filter(cls => cls.semester === 2);
  const documentClasses = classes.filter(cls => cls.status === '확정');
  const approvedById = new Map(documentClasses.map(cls => [cls.id, cls]));
  const submittedDocumentKeys = new Set(state.documents
    .filter(row => approvedById.has(row.class_id) && approvedById.get(row.class_id).teacherId === row.submitter_id && ['지도안', '협의록', '참관록'].includes(row.document_type))
    .map(row => `${row.class_id}|${row.document_type}`));
  const documentRequired = documentClasses.length * 3;
  const documentSubmitted = submittedDocumentKeys.size;
  const eligibleSubjectObservers = Object.fromEntries(
    secondClasses
      .filter(cls => cls.status === '확정')
      .map(cls => {
        const classSubjectGroup = normalizeSubjectKey(cls.subjectGroup);
        const eligibleSubjectGroups = eligibleObserverSubjectKeys(cls.subjectGroup);
        const candidates = activeTeachers
          .filter(teacher => teacher.id !== cls.teacherId && classSubjectGroup && classSubjectGroup !== normalizeSubjectKey('교과 미분류'))
          .filter(teacher => eligibleSubjectGroups.has(normalizeSubjectKey(teacher.subject_group)))
          .filter(teacher => canObserveClass({ id: teacher.id }, cls, state, classes).ok)
          .map(teacher => {
            const subject = clean(teacher.subject_group) || '교과 미분류';
            return {
              id: teacher.id,
              name: clean(teacher.name),
              subject,
              relationship: normalizeSubjectKey(subject) === classSubjectGroup ? '동교과' : '동교과군'
            };
          })
          .sort((left, right) => (left.relationship === '동교과' ? 0 : 1) - (right.relationship === '동교과' ? 0 : 1) || left.name.localeCompare(right.name, 'ko'));
        return [cls.id, candidates];
      })
  );
  return {
    stats: {
      totalTeachers: activeTeachers.length,
      targetTeachers: activeTeachers.filter(row => row.second_semester_target).length,
      firstOpenCompleted: annualTeacherStatuses.filter(item => item.firstOpenCompleted).length,
      secondOpenCompleted: annualTeacherStatuses.filter(item => item.secondOpenCompleted).length,
      annualOpenCompleted: annualTeacherStatuses.filter(item => item.annualOpenCompleted).length,
      allRequirementsCompleted: annualTeacherStatuses.filter(item => item.allRequirementsMet).length,
      openClassApplied: new Set(secondClasses.filter(cls => ['승인대기', '확정'].includes(cls.status)).map(cls => cls.teacherId)).size,
      approvedClasses: secondClasses.filter(cls => cls.status === '확정').length,
      activeObservations: activeObservations.length,
      teachersCompletedTwo: annualTeacherStatuses.filter(item => item.observationRequirementMet).length,
      attendanceUnchecked: attendanceVerification.reduce((sum, item) => sum + item.total - item.checked, 0),
      attendancePendingClasses: attendanceVerification.filter(item => !item.complete).length,
      paperPending: state.documents.filter(row => row.status === '수기제출예정').length,
      documentRequired,
      documentSubmitted,
      documentPending: Math.max(0, documentRequired - documentSubmitted)
    },
    annualTeacherStatuses,
    attendanceVerification,
    observationApplications: activeObservations
      .filter(row => Number(row.semester) === 2 && classById.get(row.class_id)?.semester === 2)
      .map(row => mapObservation(row, classById.get(row.class_id), state))
      .sort(compareClasses),
    pendingClasses: secondClasses.filter(cls => cls.status === '승인대기'),
    approvedClasses: secondClasses.filter(cls => cls.status === '확정'),
    eligibleSubjectObservers,
    documentClasses,
    pendingChanges: state.change_requests.filter(row => row.status === '승인대기').map(row => mapChange(row, state)),
    paperDocuments: state.documents.filter(row => row.status === '수기제출예정').map(row => ({ ...mapDocument(row, state), classInfo: classById.get(row.class_id) || null })),
    attendanceShortages: activeTeachers.map(teacher => ({ name: teacher.name, applied: activeObservations.filter(row => row.observer_id === teacher.id).length, completed: counts.get(teacher.id) || 0 })).filter(item => item.completed < 2),
    reminderFixedRecipients: reminderFixedRecipients(settingsMap(state.app_settings).reminder_fixed_recipients),
    comciganSync: comciganSyncStatus(state.app_settings),
    scheduleConflicts: buildScheduleConflicts(state)
  };
}

function buildAdminTodo(state, admin, referenceDate = todayKey()) {
  const end = addDays(currentAndNextWeekRange(referenceDate).start, 11);
  const automaticTypes = new Set(['공개수업시간표충돌', '참관시간표충돌', '학사일정충돌']);
  const pendingChanges = admin.pendingChanges.map(row => ({ id: row.id, teacherName: row.requesterName, subject: row.requesterSubject }));
  const pendingClasses = admin.pendingClasses.length;
  const conflicts = (state.notifications || []).filter(row => automaticTypes.has(row.notification_type) && !row.resolved_at).length;
  const messageClasses = admin.approvedClasses.filter(row => row.date >= referenceDate && row.date <= end)
    .sort(compareClasses).map(row => ({ id: row.id, date: row.date, period: row.period, teacherName: row.teacherName, observerCount: row.observerCount, isToday: row.date === referenceDate }));
  const submitted = new Set(state.documents.filter(row => ['온라인제출', '수기제출확인'].includes(row.status))
    .map(row => `${row.class_id}|${row.submitter_id}|${row.document_type}`));
  const missingClasses = admin.documentClasses.filter(row => row.date < referenceDate).map(row => ({
    id: row.id, missingTypes: TEMPLATE_TYPES.filter(type => !submitted.has(`${row.id}|${row.teacherId}|${type}`))
  })).filter(row => row.missingTypes.length);
  const missingDocuments = missingClasses.reduce((count, row) => count + row.missingTypes.length, 0);
  return {
    today: referenceDate, messageEnd: end,
    pendingChanges, pendingClasses, conflicts, messageClasses,
    missingDocuments, missingDocumentClasses: missingClasses.length,
    total: pendingChanges.length + pendingClasses + conflicts + missingDocuments
  };
}

function mapClass(row, state) {
  const active = state.observations.filter(obs => obs.class_id === row.id && obs.status === '확정');
  const teacher = state.teachers.find(item => item.id === row.teacher_id);
  return {
    id: row.id, teacherId: row.teacher_id, teacherName: teacher ? teacher.name : '교사 정보 없음',
    subjectGroup: teacher ? clean(teacher.subject_group) || '교과 미분류' : '교과 미분류',
    date: row.class_date, weekday: row.weekday, period: row.period, subject: row.subject,
    className: row.class_name, room: row.room, topic: row.topic, capacity: row.capacity,
    observerCount: active.length, remaining: Math.max(0, row.capacity - active.length), status: row.status,
    appliedAt: formatDateTime(row.submitted_at), adminNote: row.admin_note, semester: row.semester, source: row.source
  };
}

function mapObservation(row, cls, state) {
  const observer = state.teachers.find(item => item.id === row.observer_id);
  return {
    id: row.id, classId: row.class_id, observerId: row.observer_id, observerName: teacherName(state, row.observer_id), appliedAt: formatDateTime(row.applied_at),
    observerSubject: observer ? clean(observer.subject_group) || '교과 미분류' : '교과 미분류',
    status: row.status, attendance: row.attendance || '미확인', attendanceCheckedAt: formatDateTime(row.attendance_checked_at),
    note: row.note, teacherName: cls ? cls.teacherName : '', date: cls ? cls.date : '', weekday: cls ? cls.weekday : '',
    period: cls ? cls.period : '', subject: cls ? cls.subject : '', className: cls ? cls.className : '', room: cls ? cls.room : '',
    semester: row.semester === 1 ? 1 : (cls ? cls.semester : 2)
  };
}

function mapTimetable(row) { return { id: row.id, weekday: row.weekday, period: row.period, className: row.class_name, room: resolveTimetableRoom(row.room, row.class_name), subject: row.subject }; }
function mapWeeklyTimetable(row) { return { id: row.id, weekStart: row.week_start, date: row.lesson_date, weekday: row.weekday, period: row.period, className: row.class_name, room: resolveTimetableRoom(row.room, row.class_name), subject: row.subject, isModified: Boolean(row.is_modified), originalClassName: row.original_class_name || '', originalSubject: row.original_subject || '' }; }
function mapDocument(row, state) {
  const cls = state.open_classes.find(item => item.id === row.class_id) || null;
  const submitterName = teacherName(state, row.submitter_id);
  const sourceFileName = clean(row.file_name) || clean(row.file_path).split('/').pop();
  const fileName = sourceFileName && cls ? standardDocumentFileName(state, cls, submitterName, row.document_type, sourceFileName) : sourceFileName;
  return { id: row.id, classId: row.class_id, type: row.document_type, submitterId: row.submitter_id, submitterName, method: row.submission_method, fileName, filePath: row.file_path, fileUrl: '', status: row.status, submittedAt: formatDateTime(row.submitted_at), confirmedAt: formatDateTime(row.confirmed_at), note: row.note };
}
function mapChange(row, state) {
  const requester = state && state.teachers ? state.teachers.find(item => item.id === row.requester_id) : null;
  return {
    id: row.id, classId: row.class_id, requesterId: row.requester_id,
    requesterName: requester ? requester.name : '교사 정보 없음', requesterSubject: requester ? clean(requester.subject_group) || '교과 미분류' : '교과 미분류',
    originalDate: row.original_date, originalPeriod: row.original_period, originalClass: row.original_class_name, originalRoom: row.original_room,
    requestedDate: row.requested_date, requestedWeekday: row.requested_weekday, requestedPeriod: row.requested_period, requestedClass: row.requested_class_name, requestedRoom: row.requested_room,
    requestedSubject: row.requested_subject, reason: row.reason, status: row.status, requestedAt: formatDateTime(row.requested_at), adminNote: row.admin_note, affectedObservers: row.affected_observers
  };
}
function mapNotification(row) { return { id: row.id, type: row.notification_type, severity: row.severity, title: row.title, message: row.message, classId: row.class_id, observationId: row.observation_id, actionTab: row.action_tab, metadata: row.metadata || {}, read: Boolean(row.read_at), createdAt: formatDateTime(row.created_at) }; }

async function documentsWithSignedUrls(supabase, documents) {
  const paths = unique(documents.map(doc => doc.filePath));
  if (!paths.length) return documents;
  const result = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(paths, 15 * 60);
  if (result.error) return documents;
  const urlByPath = new Map((result.data || []).map((item, index) => [item.path || paths[index], item.signedUrl || '']));
  return documents.map(doc => {
    const signedUrl = doc.filePath ? (urlByPath.get(doc.filePath) || '') : '';
    return { ...doc, fileUrl: signedDownloadUrl(signedUrl, doc.fileName) };
  });
}

function templateFiles(settingRows) {
  const settings = settingsMap(settingRows);
  return TEMPLATE_TYPES.map(type => {
    const raw = settings[`${TEMPLATE_SETTING_PREFIX}${type}`];
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const filePath = clean(parsed.filePath);
      const allowedPrefixes = [`templates/${TEMPLATE_STORAGE_DIRS[type]}/`, `templates/${type}/`];
      if (!filePath || !allowedPrefixes.some(prefix => filePath.startsWith(prefix))) return null;
      return {
        type,
        fileName: sanitizeFileName(parsed.originalFileName) || sanitizeFileName(parsed.fileName) || `${documentFileTypeLabel(type)}_양식`,
        filePath,
        uploadedAt: formatDateTime(parsed.uploadedAt),
        uploadedBy: clean(parsed.uploadedBy),
        fileUrl: ''
      };
    } catch (_error) {
      return null;
    }
  }).filter(Boolean);
}

async function templatesWithSignedUrls(supabase, templates) {
  const signed = await documentsWithSignedUrls(supabase, templates);
  return signed.map(({ filePath: _filePath, ...template }) => template);
}

function buildDocumentTasks(actor, classes, state, myDocuments) {
  const tasks = [];
  classes.filter(cls => [1, 2].includes(Number(cls.semester)) && cls.teacherId === actor.id && cls.status === '확정').forEach(cls => {
    ['지도안', '협의록', '참관록'].forEach(type => tasks.push(documentTask(cls, type, myDocuments.find(doc => doc.classId === cls.id && doc.type === type))));
  });
  return tasks;
}

function documentTask(cls, type, doc) { return { taskKey: `${cls.id}_${type}`, classId: cls.id, type, classInfo: cls, status: doc ? doc.status : '', method: doc ? doc.method : '', fileName: doc ? doc.fileName : '', fileUrl: doc ? doc.fileUrl : '', submittedAt: doc ? doc.submittedAt : '' }; }

function assertDocumentPermission(state, actor, type, cls) {
  if (!['지도안', '협의록', '참관록'].includes(type)) throw new Error('자료 유형이 올바르지 않습니다.');
  if (cls.teacher_id !== actor.id) throw new Error('수업 지도안, 수업나눔 협의록, 참관록은 해당 공개수업 진행 교사만 제출할 수 있습니다.');
}

function canObserveClass(actor, cls, state, classes, allowTimetableConflict = false) {
  if (cls.status !== '확정' || cls.semester !== 2 || cls.date < todayKey() || cls.teacherId === actor.id || cls.observerCount >= cls.capacity) return { ok: false, code: 'unavailable' };
  if (state.observations.some(row => row.class_id === cls.id && row.observer_id === actor.id && row.status === '확정')) return { ok: false, code: 'already-applied' };
  if (!allowTimetableConflict && teacherHasScheduledClassAt(state, actor.id, cls.date, weekday(cls.date), cls.period)) return { ok: false, code: 'timetable' };
  if (findBlockedConflict(state, actor.id, cls.date, cls.period)) return { ok: false, code: 'blocked' };
  if (state.open_classes.some(row => row.id !== cls.id && row.teacher_id === actor.id && ['승인대기', '확정'].includes(row.status) && row.class_date === cls.date && Number(row.period) === Number(cls.period))) return { ok: false, code: 'own-open-class' };
  const observationConflict = state.observations.some(row => {
    if (row.observer_id !== actor.id || row.status !== '확정' || row.class_id === cls.id) return false;
    const otherClass = classes.find(item => item.id === row.class_id);
    return otherClass && otherClass.date === cls.date && Number(otherClass.period) === Number(cls.period);
  });
  if (observationConflict) return { ok: false, code: 'observation' };
  return { ok: true, code: '' };
}

function hasObserverConflictAt(state, classes, teacherId, date, period, currentClassId, excludeObservationId) {
  return Boolean(observerConflictReasonAt(state, classes, teacherId, date, period, currentClassId, excludeObservationId));
}

function observerConflictReasonAt(state, classes, teacherId, date, period, currentClassId, excludeObservationId) {
  const day = weekday(date);
  if (teacherHasScheduledClassAt(state, teacherId, date, day, period)) return '본인 수업 시간표와 겹칩니다.';
  const blocked = findBlockedConflict(state, teacherId, date, period);
  if (blocked) return `${clean(blocked.reason) || '신청 불가 일정'}과 겹칩니다.`;
  if (state.open_classes.some(row => row.id !== currentClassId && row.teacher_id === teacherId && ['승인대기', '확정'].includes(row.status) && row.class_date === date && Number(row.period) === Number(period))) return '본인의 공개수업 일정과 겹칩니다.';
  const observationConflict = state.observations.some(row => {
    if (row.id === excludeObservationId || row.observer_id !== teacherId || row.status !== '확정' || row.class_id === currentClassId) return false;
    const cls = classes.find(item => item.id === row.class_id);
    return cls && cls.date === date && Number(cls.period) === Number(period);
  });
  return observationConflict ? '다른 참관 일정과 겹칩니다.' : '';
}

function teacherHasScheduledClassAt(state, teacherId, date, day, period) {
  const weeklyRows = (state.weekly_timetables || []).filter(row => row.teacher_id === teacherId && row.lesson_date === date);
  if (weeklyRows.length) return weeklyRows.some(row => Number(row.period) === Number(period));
  return state.timetables.some(row => row.active && row.teacher_id === teacherId && row.weekday === day && Number(row.period) === Number(period));
}

function findBlockedConflict(state, teacherId, date, period) { return state.blocked_dates.find(row => row.active && (!row.teacher_id || row.teacher_id === teacherId) && row.blocked_date === date && (row.period === null || Number(row.period) === Number(period))); }
function hasBlockedConflict(state, teacherId, date, period) { return Boolean(findBlockedConflict(state, teacherId, date, period)); }
function hasRoomCollision(rows, date, period, room, excludeId) { return rows.some(row => row.id !== excludeId && ['승인대기', '확정'].includes(row.status) && row.class_date === date && Number(row.period) === Number(period) && clean(row.room).toLowerCase() === clean(room).toLowerCase()); }

function buildScheduleConflicts(state, teacherId = '') {
  const classes = state.open_classes.map(row => mapClass(row, state));
  const rows = [];
  classes.filter(cls => cls.semester === 2 && cls.status === '확정' && cls.date >= todayKey()).forEach(cls => {
    if (!teacherId || cls.teacherId === teacherId) {
      const exactTimetable = state.timetables.some(row => row.teacher_id === cls.teacherId && row.active && row.open_class_eligible !== false && row.weekday === cls.weekday && Number(row.period) === Number(cls.period) && sameClassIdentity(row.class_name, cls.className));
      if (!exactTimetable) rows.push(scheduleConflictRow(state, cls, cls.teacherId, '공개수업시간표충돌', 'danger', '확정 공개수업과 현재 시간표가 다릅니다', '시간표 변경으로 확정된 공개수업의 요일·교시·학급이 더 이상 일치하지 않습니다.', `auto:presenter:${cls.id}:timetable`));
      const blocked = findBlockedConflict(state, cls.teacherId, cls.date, cls.period);
      if (blocked) rows.push(scheduleConflictRow(state, cls, cls.teacherId, '학사일정충돌', 'danger', '확정 공개수업이 신청 불가 일정과 겹칩니다', `${clean(blocked.reason) || '학사일정'}과 겹칩니다. 관리자 확인이 필요합니다.`, `auto:presenter:${cls.id}:blocked`));
    }
    state.observations.filter(row => row.class_id === cls.id && row.status === '확정' && (!teacherId || row.observer_id === teacherId)).forEach(observation => {
      const reason = observerConflictReasonAt(state, classes, observation.observer_id, cls.date, cls.period, cls.id, observation.id);
      if (reason) rows.push(scheduleConflictRow(state, cls, observation.observer_id, '참관시간표충돌', 'danger', '참관 일정 충돌이 발견되었습니다', `${maskName(cls.teacherName)} 선생님의 ${formatKoreanDate(cls.date)} ${cls.period}교시 참관 일정이 현재 시간표와 충돌합니다. ${reason}`, `auto:observer:${observation.id}`, observation.id));
    });
  });
  return rows;
}

function scheduleConflictRow(state, cls, teacherId, type, severity, title, message, dedupeKey, observationId = null) {
  return {
    teacherId, teacherName: teacherName(state, teacherId), teacherSubject: clean(state.teachers.find(row => row.id === teacherId)?.subject_group) || '교과 미분류',
    type, severity, title, message, classId: cls.id, observationId, actionTab: observationId ? 'observe' : 'open', dedupeKey,
    date: cls.date, period: cls.period, className: cls.className, room: cls.room
  };
}

function sameConflictNotification(previous, next) {
  const fields = ['teacher_id', 'notification_type', 'severity', 'title', 'message', 'class_id', 'observation_id', 'action_tab', 'dedupe_key'];
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  return fields.every(key => (previous[key] ?? null) === (next[key] ?? null)) &&
    JSON.stringify(canonical(previous.metadata)) === JSON.stringify(canonical(next.metadata));
}

async function reconcileScheduleConflicts(supabase, state, actor) {
  const teacherId = actor.isAdmin ? '' : actor.id;
  const active = buildScheduleConflicts(state, teacherId);
  const automaticTypes = new Set(['공개수업시간표충돌', '참관시간표충돌', '학사일정충돌']);
  const existing = (state.notifications || []).filter(row => automaticTypes.has(row.notification_type) && (!teacherId || row.teacher_id === teacherId));
  const existingByKey = new Map(existing.map(row => [row.dedupe_key, row]));
  if (active.length) {
    const upserts = active.map(item => {
      const previous = existingByKey.get(item.dedupeKey);
      const row = {
        teacher_id: item.teacherId, notification_type: item.type, severity: item.severity, title: item.title, message: item.message,
        class_id: item.classId, observation_id: item.observationId, action_tab: item.actionTab, dedupe_key: item.dedupeKey,
        metadata: { date: item.date, period: item.period, className: item.className, room: item.room },
        read_at: previous && !previous.resolved_at ? previous.read_at : null,
        resolved_at: null,
        updated_at: new Date().toISOString()
      };
      return row;
    });
    const changed = upserts.filter(row => {
      const previous = existingByKey.get(row.dedupe_key);
      return !previous || previous.resolved_at || !sameConflictNotification(previous, row);
    });
    if (changed.length) {
      const saved = await supabase.from('notifications').upsert(changed, { onConflict: 'dedupe_key' });
      if (saved.error) throw saved.error;
    }
  }
  const activeKeys = new Set(active.map(item => item.dedupeKey));
  const resolvedIds = existing.filter(row => !row.resolved_at && !activeKeys.has(row.dedupe_key)).map(row => row.id);
  if (resolvedIds.length) {
    const resolved = await supabase.from('notifications').update({ resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', resolvedIds);
    if (resolved.error) throw resolved.error;
  }
}

function mergeAcademicCalendarBlocks(rows, settingRows) {
  const merged = [...(rows || [])];
  const keys = new Set(merged.map(blockedDateKey));
  academicCalendarRows(settingRows).forEach(row => {
    const key = blockedDateKey(row);
    if (!keys.has(key)) {
      merged.push(row);
      keys.add(key);
    }
  });
  return merged;
}

function blockedDateKey(row) {
  return `${row.teacher_id || '*'}|${row.blocked_date}|${row.period === null || row.period === undefined ? '*' : Number(row.period)}`;
}

function academicCalendarSettings(settingRows) {
  const settings = settingsMap(settingRows || []);
  let extra = [];
  try {
    const parsed = JSON.parse(clean(settings.academic_calendar_blocks) || '[]');
    if (Array.isArray(parsed)) extra = parsed.filter(item => item && isDateText(clean(item.date))).map(item => ({
      date: clean(item.date),
      periods: Array.isArray(item.periods) ? item.periods.map(Number).filter(Number.isInteger) : undefined,
      reason: clean(item.reason) || '학사일정'
    }));
  } catch (_error) { extra = []; }
  let winter = WINTER_BREAK;
  try {
    const parsed = JSON.parse(clean(settings.winter_break) || 'null');
    if (parsed && isDateText(clean(parsed.start)) && isDateText(clean(parsed.end))) winter = { start: clean(parsed.start), end: clean(parsed.end), reason: clean(parsed.reason) || '겨울방학' };
  } catch (_error) { winter = WINTER_BREAK; }
  return { blocks: [...ACADEMIC_CALENDAR_BLOCKS, ...extra], winter };
}

function academicCalendarRows(settingRows) {
  const rows = [];
  const { blocks, winter } = academicCalendarSettings(settingRows);
  blocks.forEach((block, blockIndex) => {
    const periods = block.periods && block.periods.length ? block.periods : [null];
    periods.forEach(period => rows.push({
      id: `academic-${blockIndex}-${period === null ? 'all' : period}`,
      teacher_id: null,
      blocked_date: block.date,
      period,
      reason: block.reason,
      active: true
    }));
  });
  if (!isDateText(winter.start) || !isDateText(winter.end)) return rows;
  const cursor = new Date(`${winter.start}T12:00:00Z`);
  const last = new Date(`${winter.end}T12:00:00Z`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    rows.push({ id: `academic-winter-${date}`, teacher_id: null, blocked_date: date, period: null, reason: winter.reason, active: true });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function publicConfig(rows) {
  const settings = settingsMap(rows);
  const storedPhase = Object.values(PHASE).includes(settings.operation_phase) ? settings.operation_phase : PHASE.ALL;
  const phase = storedPhase === PHASE.CLASS ? PHASE.PREPARE : storedPhase;
  const all = phase === PHASE.ALL;
  return {
    appName: settings.app_name || '2학기 수업공개·참관 관리', schoolYear: settings.school_year || String(new Date().getFullYear()),
    openClassFinalDate: openClassFinalDate(rows), semesterStartDate: semesterStartDate(rows), appUrl: appUrlFor(rows),
    semester: settings.semester || '2', capacity: Number(settings.capacity) || 4, maxFileMb: Number(settings.max_file_mb) || 3,
    openApplicationDeadline: validDateSetting(settings.open_application_deadline, DEFAULT_OPEN_APPLICATION_DEADLINE),
    openApplicationStart: validDateSetting(settings.open_application_start, DEFAULT_OPEN_APPLICATION_START),
    observationApplicationDeadline: validDateSetting(settings.observation_application_deadline, DEFAULT_OBSERVATION_APPLICATION_DEADLINE),
    observationApplicationStart: validDateSetting(settings.observation_application_start, DEFAULT_OBSERVATION_APPLICATION_START),
    operationPhase: phase, operationPhaseLabel: phaseLabel(phase),
    tabAccess: {
      open: all || phase === PHASE.OPEN || phase === PHASE.OBSERVE,
      observe: all || phase === PHASE.OBSERVE,
      operation: true,
      attendance: true,
      documents: true
    }
  };
}

function buildPublicTeacherProgress(teachers, classRows, observationRows, settingRows) {
  const overrides = annualStatusOverrides(settingRows);
  const classes = (classRows || []).map(row => ({
    id: row.id,
    teacherId: row.teacher_id,
    semester: Number(row.semester) || 2,
    date: row.class_date,
    status: row.status
  }));
  const classById = new Map(classes.map(row => [row.id, row]));
  const observationsByTeacherAndSemester = new Map();
  (observationRows || []).filter(row => row.status === '확정' && row.attendance === '참석').forEach(row => {
    const semester = Number(row.semester) === 1 ? 1 : (classById.get(row.class_id)?.semester || 2);
    const key = `${row.observer_id}:${semester}`;
    observationsByTeacherAndSemester.set(key, (observationsByTeacherAndSemester.get(key) || 0) + 1);
  });
  const statuses = (teachers || []).map(teacher => {
    const teacherClasses = classes.filter(row => row.teacherId === teacher.id);
    const override = overrides[teacher.id] || {};
    const firstOpenCompleted = overriddenBoolean(override, 'firstOpenCompleted', teacherClasses.some(row => row.semester === 1 && isCompletedClass(row)));
    const secondOpenCompleted = overriddenBoolean(override, 'secondOpenCompleted', teacherClasses.some(row => row.semester === 2 && isCompletedClass(row)));
    const firstObservationCompleted = overriddenCount(override, 'firstObservationCompleted', observationsByTeacherAndSemester.get(`${teacher.id}:1`) || 0);
    const secondObservationCompleted = overriddenCount(override, 'secondObservationCompleted', observationsByTeacherAndSemester.get(`${teacher.id}:2`) || 0);
    const annualObservationCompleted = firstObservationCompleted + secondObservationCompleted;
    return {
      displayName: maskName(teacher.name),
      subject: clean(teacher.subject_group) || '교과 미분류',
      openCompleted: firstOpenCompleted || secondOpenCompleted,
      observationTarget: !isObservationExempt(teacher),
      observationRemaining: Math.max(0, 2 - annualObservationCompleted),
      allRequirementsMet: (firstOpenCompleted || secondOpenCompleted) && annualObservationCompleted >= 2
    };
  }).sort((left, right) => left.subject.localeCompare(right.subject, 'ko') || left.displayName.localeCompare(right.displayName, 'ko'));
  return {
    remainingOpenTeachers: statuses.filter(row => !row.openCompleted).map(({ displayName, subject }) => ({ displayName, subject })),
    remainingObservationTeachers: statuses.filter(row => row.observationTarget && row.observationRemaining > 0).map(({ displayName, subject, observationRemaining }) => ({ displayName, subject, remaining: observationRemaining })),
    completedTeachers: statuses.filter(row => row.allRequirementsMet).map(({ displayName, subject }) => ({ displayName, subject }))
  };
}

function requirePhase(state, allowed, label) {
  const phase = publicConfig(state.app_settings).operationPhase;
  if (phase !== PHASE.ALL && !allowed.includes(phase)) throw new Error(`현재는 ${phaseLabel(phase)} 단계입니다. ${label} 기간에 다시 이용해 주세요.`);
}

function phaseLabel(phase) { return ({ 준비: '신청 준비·마감', 공개수업신청: '공개수업 신청', 참관신청: '참관 신청', 수업진행: '신청 준비·마감', 전체: '전체 신청 점검' })[phase] || '전체 신청 점검'; }
function openClassFinalDate(source) {
  const rows = Array.isArray(source) ? source : (source && source.app_settings) || [];
  return validDateSetting(settingsMap(rows).open_class_final_date, OPEN_CLASS_FINAL_DATE);
}
function semesterStartDate(source) {
  const rows = Array.isArray(source) ? source : (source && source.app_settings) || [];
  return validDateSetting(settingsMap(rows).semester_start_date, DEFAULT_SEMESTER_START_DATE);
}
function finalDateLabel(dateText) {
  const text = String(dateText || '');
  return `${Number(text.slice(5, 7))}월 ${Number(text.slice(8, 10))}일`;
}
function appUrlFor(source) {
  const rows = Array.isArray(source) ? source : (source && source.app_settings) || [];
  const fromSetting = clean(settingsMap(rows).app_url);
  if (fromSetting) return fromSetting;
  if (clean(process.env.APP_URL)) return clean(process.env.APP_URL);
  if (clean(process.env.VERCEL_PROJECT_PRODUCTION_URL)) return `https://${clean(process.env.VERCEL_PROJECT_PRODUCTION_URL)}/`;
  return '';
}
function settingsMap(rows) { return Object.fromEntries((rows || []).map(row => [row.setting_key, String(row.setting_value ?? '')])); }
function validDateSetting(value, fallback) { return isDateText(clean(value)) ? clean(value) : fallback; }
function roomLocationMap(value) {
  try {
    const parsed = JSON.parse(clean(value) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([room, location]) => [clean(room).slice(0, 80), clean(location).slice(0, 60)])
      .filter(([room, location]) => room && location)
      .slice(0, 200));
  } catch (_error) {
    return {};
  }
}

function publicMessengerMessages(value) {
  try {
    const parsed = JSON.parse(clean(value) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => ({
      id: clean(item && item.id) || `message-${index + 1}`,
      title: clean(item && item.title) || `메신저 ${index + 1}`,
      sentAt: clean(item && item.sentAt),
      body: clean(item && item.body)
    })).filter(item => item.body);
  } catch (_error) {
    return [];
  }
}
function annualStatusOverrides(rows) {
  try {
    const value = JSON.parse(settingsMap(rows).annual_status_overrides || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_error) {
    return {};
  }
}
function overriddenBoolean(record, key, fallback) { return record && typeof record[key] === 'boolean' ? record[key] : Boolean(fallback); }
function overriddenCount(record, key, fallback) { return record && Number.isInteger(Number(record[key])) ? Math.max(0, Number(record[key])) : Math.max(0, Number(fallback) || 0); }
function isObservationExempt(person) {
  const reason = clean(person && (person.exclusion_reason ?? person.exclusionReason));
  return reason === '순회교사';
}

function secondSemesterObservationApplicationStatus(firstCompleted, secondCompleted, secondApplications, eligible = true) {
  const firstSemesterCompleted = Math.max(0, Number(firstCompleted) || 0);
  const secondSemesterCompleted = Math.max(0, Number(secondCompleted) || 0);
  const activeSecondApplications = Math.max(0, Number(secondApplications) || 0);
  const excludedByTeacherSetting = eligible === false;
  const excludedByFirstSemester = firstSemesterCompleted >= 2;
  const excluded = excludedByTeacherSetting || excludedByFirstSemester;
  const required = excluded ? 0 : Math.max(0, 2 - firstSemesterCompleted);
  const applied = excluded ? 0 : Math.max(secondSemesterCompleted, activeSecondApplications);
  const remaining = excluded ? 0 : Math.max(0, required - applied);
  return {
    target: !excluded,
    excludedByTeacherSetting,
    excludedByFirstSemester,
    firstSemesterCompleted,
    required,
    applied,
    remaining,
    complete: !excluded && remaining === 0
  };
}
function boundedCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('참관 횟수는 0회부터 20회 사이의 정수로 입력해 주세요.');
  return count;
}
function requiredBoolean(value, label) {
  if (value !== true && value !== false) throw new Error(`${label}를 확인해 주세요.`);
  return value;
}
function teacherName(state, id) { return state.teachers.find(row => row.id === id)?.name || '교사 정보 없음'; }
function normalizeSubjectKey(value) {
  return clean(value).toLocaleLowerCase('ko-KR').replace(/[\s·ㆍ_-]+/g, '');
}

function eligibleObserverSubjectKeys(value) {
  const key = normalizeSubjectKey(value);
  const linkedGroups = [
    ['역사', '사회'],
    ['미술', '음악'],
    ['일어', '일본어', '영어', '한문']
  ].map(group => new Set(group.map(normalizeSubjectKey)));
  const linked = linkedGroups.find(group => group.has(key));
  return linked || new Set(key ? [key] : []);
}

function observationSubjectPriority(cls, actor, actorSubjectKeys) {
  const classSubject = normalizeSubjectKey(cls.subject);
  const actorGroup = normalizeSubjectKey(actor.subject);
  const classGroup = normalizeSubjectKey(cls.subjectGroup);
  if (classSubject && actorSubjectKeys.has(classSubject)) return 0;
  if (actorGroup && (classGroup === actorGroup || classSubject === actorGroup)) return 1;
  return 2;
}

function compareClasses(a, b) { return String(a.date).localeCompare(String(b.date)) || Number(a.period) - Number(b.period) || String(a.teacherName).localeCompare(String(b.teacherName), 'ko'); }
function compareTimetable(a, b) { const order = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 }; return (order[a.weekday] || 9) - (order[b.weekday] || 9) || Number(a.period) - Number(b.period); }
function isCompletedClass(cls) { return cls && cls.status === '확정' && cls.date <= todayKey(); }
function requireAdmin(actor) { if (!actor.isAdmin) throw new Error('관리자만 사용할 수 있는 기능입니다.'); }

async function audit(supabase, actor, action, targetType, targetId, detail) {
  const result = await supabase.from('audit_logs').insert({ actor_id: actor.id, actor_name: actor.name, action, target_type: targetType, target_id: String(targetId || ''), detail: detail || {} });
  if (result.error) console.error('audit log failed', result.error.message);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function checkedCsvDocumentTypes(header, row) {
  return ['지도안', '참관록', '협의록'].filter(type => {
    const index = header.indexOf(type);
    return index >= 0 && /^(true|1|y|yes|예|완료|제출|확인)$/i.test(clean(row[index]));
  });
}

function maskTeacherResponse(value, key = '') {
  const personNameKeys = new Set(['name', 'teacherName', 'observerName', 'submitterName', 'requesterName']);
  const personNameArrayKeys = new Set(['affectedObservers', 'observerNames']);
  if (Array.isArray(value)) return value.map(item => personNameArrayKeys.has(key) && typeof item === 'string' ? maskName(item) : maskTeacherResponse(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, maskTeacherResponse(childValue, childKey)]));
  }
  return personNameKeys.has(key) && typeof value === 'string' ? maskName(value) : value;
}

function currentAndNextWeekRange(referenceDate = todayKey()) {
  const date = new Date(`${referenceDate}T12:00:00+09:00`);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return {
    start: addDays(referenceDate, mondayOffset),
    end: addDays(referenceDate, mondayOffset + 13)
  };
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function maskName(value) { const name = clean(value).replace(/\s+/g, ''); return name.length <= 1 ? name : `${name.slice(0, -1)}*`; }
function sanitizeFileName(value) { return clean(value).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 160); }
function assertAllowedFile(name) { if (!/\.(pdf|hwp|hwpx|doc|docx)$/i.test(name)) throw new Error('PDF, HWP, HWPX, DOC, DOCX 파일만 제출할 수 있습니다.'); }
function fileExtension(value) { return clean(value).match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || ''; }
function documentFileTypeLabel(type) { return ({ 지도안: '수업지도안', 협의록: '수업나눔협의록', 참관록: '참관록' })[type] || sanitizeFileName(type) || '제출자료'; }
function standardDocumentFileName(state, cls, teacherNameValue, type, sourceFileName) {
  const year = clean(settingsMap(state.app_settings).school_year) || clean(cls && cls.class_date).slice(0, 4) || String(new Date().getFullYear());
  const semester = Number(cls && cls.semester) === 1 ? 1 : 2;
  const teacher = sanitizeFileName(teacherNameValue).replace(/\s+/g, '') || '교사미상';
  const date = clean(cls && cls.class_date).replaceAll('-', '') || '날짜미정';
  const period = Number(cls && cls.period) > 0 ? `${Number(cls.period)}교시` : '교시미정';
  const extension = fileExtension(sourceFileName);
  return sanitizeFileName(`${year}_${semester}학기_${teacher}_${date}_${period}_${documentFileTypeLabel(type)}${extension ? `.${extension}` : ''}`);
}
function documentSubmissionNote(note, originalFileName) {
  return [clean(note), originalFileName ? `원본 파일명: ${originalFileName}` : ''].filter(Boolean).join('\n');
}
function signedDownloadUrl(url, fileName) {
  if (!url || !fileName) return url || '';
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName)}`;
}
function normalizeWeekday(value) { const text = clean(value).replace(/요일/g, ''); return ['월', '화', '수', '목', '금', '토', '일'].includes(text) ? text : ''; }
function classIdentity(value) {
  const text = clean(value);
  const match = text.match(/^(\d+)\s*학년\s*(\d+)\s*반/) || text.match(/^(\d+)\s*-\s*(\d+)/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : text.replace(/\s/g, '').toLowerCase();
}

function buildPublicApplicationOverview(teachers, classRows, observationRows, settingRows) {
  const overrides = annualStatusOverrides(settingRows);
  const classes = (classRows || []).map(row => ({
    id: row.id,
    teacherId: row.teacher_id,
    semester: Number(row.semester) === 1 ? 1 : 2,
    date: row.class_date,
    status: row.status
  }));
  const classById = new Map(classes.map(row => [row.id, row]));
  const observations = observationRows || [];
  const statuses = (teachers || []).map(teacher => {
    const teacherClasses = classes.filter(row => row.teacherId === teacher.id);
    const secondClasses = teacherClasses.filter(row => row.semester === 2);
    const override = overrides[teacher.id] || {};
    const attended = { 1: 0, 2: 0 };
    let pendingSecondApplications = 0;
    observations.filter(row => row.observer_id === teacher.id && row.status === '확정').forEach(row => {
      const semester = Number(row.semester) === 1 ? 1 : (classById.get(row.class_id)?.semester || 2);
      if (row.attendance === '참석') attended[semester] += 1;
      else if (semester === 2 && row.attendance !== '불참') pendingSecondApplications += 1;
    });
    const firstCount = overriddenCount(override, 'firstObservationCompleted', attended[1]);
    const secondCount = overriddenCount(override, 'secondObservationCompleted', attended[2]);
    const secondApplicationStatus = secondSemesterObservationApplicationStatus(firstCount, secondCount, pendingSecondApplications + attended[2], !isObservationExempt(teacher));
    return {
      displayName: maskName(teacher.name),
      subject: clean(teacher.subject_group) || '교과 미분류',
      annualObservationCompleted: firstCount + secondCount,
      isSecondSemesterTarget: Boolean(teacher.second_semester_target),
      secondOpenApplied: secondClasses.some(row => ['승인대기', '확정'].includes(row.status)),
      secondObservationTarget: secondApplicationStatus.target,
      secondObservationApplicationComplete: secondApplicationStatus.complete,
      secondObservationRequired: secondApplicationStatus.required,
      secondObservationApplied: secondApplicationStatus.applied,
      remainingToApply: secondApplicationStatus.remaining
    };
  }).sort((left, right) => left.subject.localeCompare(right.subject, 'ko') || left.displayName.localeCompare(right.displayName, 'ko'));
  const openTargets = statuses.filter(row => row.isSecondSemesterTarget);
  let previousLeaderCount = null;
  let previousLeaderRank = 0;
  const leaders = [...statuses]
    .filter(row => row.annualObservationCompleted > 0)
    .sort((left, right) => right.annualObservationCompleted - left.annualObservationCompleted || left.displayName.localeCompare(right.displayName, 'ko'))
    .slice(0, 5)
    .map((row, index) => {
      const rank = row.annualObservationCompleted === previousLeaderCount ? previousLeaderRank : index + 1;
      previousLeaderCount = row.annualObservationCompleted;
      previousLeaderRank = rank;
      return {
        rank,
        displayName: row.displayName,
        subject: row.subject,
        count: row.annualObservationCompleted
      };
    });
  return {
    leaders,
    open: {
      applied: openTargets.filter(row => row.secondOpenApplied).map(({ displayName, subject }) => ({ displayName, subject })),
      missing: openTargets.filter(row => !row.secondOpenApplied).map(({ displayName, subject }) => ({ displayName, subject }))
    },
    observation: {
      ready: statuses.filter(row => row.secondObservationTarget && row.secondObservationApplicationComplete).map(({ displayName, subject, secondObservationRequired, secondObservationApplied }) => ({ displayName, subject, required: secondObservationRequired, applied: secondObservationApplied })),
      missing: statuses.filter(row => row.secondObservationTarget && !row.secondObservationApplicationComplete).map(({ displayName, subject, remainingToApply, secondObservationRequired, secondObservationApplied }) => ({ displayName, subject, remaining: remainingToApply, required: secondObservationRequired, applied: secondObservationApplied }))
    }
  };
}
function sameClassIdentity(left, right) {
  const normalized = classIdentity(left);
  return Boolean(normalized && normalized === classIdentity(right));
}
function resolveTimetableRoom(roomValue, classNameValue) {
  const candidate = clean(roomValue) || clean(classNameValue);
  const dashed = candidate.match(/^(\d+)\s*-\s*(\d+)(?:\s*교실)?$/);
  const korean = candidate.match(/^(\d+)\s*학년\s*(\d+)\s*반(?:\s*교실)?$/);
  const match = dashed || korean;
  return match ? `${Number(match[1])}-${Number(match[2])} 교실` : candidate;
}
function requireDate(value, label) { const text = clean(value); if (!isDateText(text)) throw new Error(`${label}을 확인해 주세요.`); return text; }
function isDateText(text) { if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false; const date = new Date(`${text}T12:00:00+09:00`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text; }
function weekday(text) { const date = new Date(`${text}T12:00:00+09:00`); return ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()]; }
function addDateDays(text, days) { const date = new Date(`${text}T12:00:00+09:00`); date.setUTCDate(date.getUTCDate() + Number(days || 0)); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function mondayKey(text) { const date = new Date(`${text}T12:00:00+09:00`); const day = date.getUTCDay(); return addDateDays(text, -(day === 0 ? 6 : day - 1)); }
function todayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function formatKoreanDate(text) { const [, month, day] = String(text).split('-').map(Number); return `${month}월 ${day}일(${weekday(text)})`; }
function formatDateTime(value) { if (!value) return ''; return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)).replace(/\. /g, '-').replace('.', ''); }
function pad(value) { return String(value).padStart(2, '0'); }
function clean(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function required(value, label) { const text = clean(value); if (!text) throw new Error(`${label}을 입력해 주세요.`); return text; }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function friendlyError(error) {
  const message = clean(error && error.message ? error.message : error) || '요청을 처리하지 못했습니다.';
  if (/^Invalid key:/i.test(message)) return '파일 저장 경로에 사용할 수 없는 문자가 있습니다.';
  return message.replace(/^.*?: /, match => match.includes('데이터를') ? match : '');
}
function isMaintenanceMode() { return ['1', 'true', 'yes', 'on'].includes(clean(process.env.MAINTENANCE_MODE).toLowerCase()); }
function maintenanceMessage() { return clean(process.env.MAINTENANCE_MESSAGE) || '2학기 수업공개 신청 기간에 다시 열겠습니다.'; }

module.exports._test = { reminderFixedRecipients, updateReminderFixedRecipients, dispatchAction, buildAdminTodo, loadState, fetchAllRows, buildBootstrap, reconcileScheduleConflicts, sameConflictNotification, teacherHasScheduledClassAt, processOpenClass, adminUpdateOpenClass, processChange, parseCsv, checkedCsvDocumentTypes, maskName, publicConfig, weekday, isDateText, todayKey, currentAndNextWeekRange, buildAdminData, buildPublicTeacherProgress, buildPublicApplicationOverview, buildScheduleConflicts, observerConflictReasonAt, mapObservation, mapTimetable, classIdentity, sameClassIdentity, resolveTimetableRoom, annualStatusOverrides, parseComciganBaseTimetables, parseComciganWeeklyTimetables, matchComciganTeachers, standardDocumentFileName, signedDownloadUrl, documentSubmissionNote, adminPaperDocumentRecord, teacherResponse, observerContactsForClass, buildClassReminderMessage, buildMessage, buildDocumentTasks, templateFiles, approveOpenClassesBulk, normalizeSubjectKey, observationSubjectPriority, secondSemesterObservationApplicationStatus };

