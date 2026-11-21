const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('../lib/auth');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    return response.status(405).json({ ok: false, message: 'POST 요청만 사용할 수 있습니다.' });
  }

  const authHeader = String(request.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!verifyAdminToken(token)) {
    return response.status(401).json({ ok: false, message: '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.' });
  }

  try {
    const classId = clean(request.body && request.body.classId);
    if (!classId) throw new Error('공개수업을 확인할 수 없습니다.');

    const supabase = supabaseClient();
    const classResult = await supabase
      .from('open_classes')
      .select('id,teacher_id,class_date,weekday,period,status,semester,capacity')
      .eq('id', classId)
      .maybeSingle();
    if (classResult.error) throw classResult.error;
    const target = classResult.data;
    if (!target || target.status !== '확정' || Number(target.semester) !== 2) {
      throw new Error('확정된 2학기 공개수업을 찾을 수 없습니다.');
    }

    const [presenterResult, teachersResult, observationsResult, classesResult, weeklyResult, timetablesResult, blockedResult] = await Promise.all([
      supabase.from('teachers').select('id,name,subject_group').eq('id', target.teacher_id).maybeSingle(),
      supabase.from('teachers').select('id,name,subject_group,active,role').eq('active', true),
      supabase.from('observations').select('id,class_id,observer_id,status').eq('status', '확정'),
      supabase.from('open_classes').select('id,teacher_id,class_date,period,status').eq('class_date', target.class_date),
      supabase.from('weekly_timetables').select('teacher_id,lesson_date,period').eq('lesson_date', target.class_date),
      supabase.from('timetables').select('teacher_id,weekday,period,active').eq('active', true),
      supabase.from('blocked_dates').select('teacher_id,blocked_date,period,active').eq('active', true).eq('blocked_date', target.class_date)
    ]);
    [presenterResult, teachersResult, observationsResult, classesResult, weeklyResult, timetablesResult, blockedResult]
      .forEach(result => { if (result.error) throw result.error; });

    const presenter = presenterResult.data;
    if (!presenter) throw new Error('공개수업 교사 정보를 찾을 수 없습니다.');

    const observations = observationsResult.data || [];
    const classes = classesResult.data || [];
    const weeklyRows = weeklyResult.data || [];
    const timetableRows = timetablesResult.data || [];
    const blockedRows = blockedResult.data || [];
    const appliedIds = new Set(observations.filter(row => row.class_id === target.id).map(row => row.observer_id));
    const subjectGroupKeys = eligibleObserverSubjectKeys(presenter.subject_group);

    const candidates = (teachersResult.data || [])
      .filter(teacher => teacher.id !== target.teacher_id && teacher.role !== '관리자')
      .filter(teacher => {
        const subjectKey = normalizeSubjectKey(teacher.subject_group);
        return subjectKey && subjectKey !== normalizeSubjectKey('교과 미분류') && !subjectGroupKeys.has(subjectKey);
      })
      .filter(teacher => !appliedIds.has(teacher.id))
      .filter(teacher => !hasTimetableConflict(teacher.id, target, weeklyRows, timetableRows))
      .filter(teacher => !blockedRows.some(row => (!row.teacher_id || row.teacher_id === teacher.id) && (row.period === null || Number(row.period) === Number(target.period))))
      .filter(teacher => !classes.some(row => row.id !== target.id && row.teacher_id === teacher.id && ['승인대기', '확정'].includes(row.status) && Number(row.period) === Number(target.period)))
      .filter(teacher => !observations.some(row => {
        if (row.observer_id !== teacher.id || row.class_id === target.id) return false;
        const otherClass = classes.find(item => item.id === row.class_id);
        return otherClass && Number(otherClass.period) === Number(target.period);
      }))
      .map(teacher => ({
        id: teacher.id,
        name: clean(teacher.name),
        subject: clean(teacher.subject_group) || '교과 미분류',
        relationship: '타교과'
      }))
      .sort((left, right) => left.subject.localeCompare(right.subject, 'ko') || left.name.localeCompare(right.name, 'ko'));

    return response.status(200).json({ ok: true, data: { classId: target.id, candidates } });
  } catch (error) {
    return response.status(400).json({ ok: false, message: friendlyError(error) });
  }
};

function supabaseClient() {
  const url = clean(process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('서버 연결 설정을 확인해 주세요.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function hasTimetableConflict(teacherId, target, weeklyRows, timetableRows) {
  const exactDateRows = weeklyRows.filter(row => row.teacher_id === teacherId);
  if (exactDateRows.length) {
    return exactDateRows.some(row => Number(row.period) === Number(target.period));
  }
  return timetableRows.some(row => row.teacher_id === teacherId && row.weekday === target.weekday && Number(row.period) === Number(target.period));
}

function eligibleObserverSubjectKeys(value) {
  const key = normalizeSubjectKey(value);
  const groups = [
    ['역사', '사회'],
    ['미술', '음악'],
    ['일어', '일본어', '영어', '한문']
  ].map(group => new Set(group.map(normalizeSubjectKey)));
  return groups.find(group => group.has(key)) || new Set(key ? [key] : []);
}

function normalizeSubjectKey(value) {
  return clean(value).toLocaleLowerCase('ko-KR').replace(/[\s·ㆍ_-]+/g, '');
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function friendlyError(error) {
  const message = clean(error && error.message);
  if (!message) return '참관 가능 교사를 확인하지 못했습니다.';
  if (/JWT|token|인증/i.test(message)) return '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (/relation|column|permission|database|fetch failed/i.test(message)) return '서버에서 참관 가능 교사를 확인하지 못했습니다.';
  return message;
}
