let loginOptions = null;
let userSession = readStoredSession();
let state = null;
let activeTab = 'dashboard';
let selectedObservationIds = new Set();
let toastTimer = null;
let adminStatusFilter = 'all';
let adminStatusSort = 'name';
let adminExportReport = 'annual';
let adminConfirmedSort = 'schedule';
let selectedMessageType = '';
let adminTodoOpen = null;
let adminTodoMessage = null;
let selectedDocumentClassId = '';
let documentTypeSubTab = 'lessonPlan';
let completionNoticeShownFor = '';
let openSubTab = 'application';
let openWeekStart = '';
let observationSubTab = 'application';
let operationSubTab = 'attendance';
let editingAnnualTeacherId = '';
let annualEditDraft = null;
let loginMessengerIndex = -1;
let loginCalendarMonth = '';
const notificationModalShownFor = new Set();
const adminSectionOpenState = new Map();

const BOOK_ICON = `<svg class="book-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5c2.8 0 5 .7 8 2.5v11c-3-1.8-5.2-2.5-8-2.5z"/><path d="M20 5.5c-2.8 0-5 .7-8 2.5v11c3-1.8 5.2-2.5 8-2.5z"/></svg>`;

const TAB_META = {
  dashboard: ['⌂', '내 대시보드'],
  open: ['▣', '공개수업 신청'],
  observe: ['◎', '참관 신청'],
  operation: ['✓', '공개수업 운영'],
  admin: ['⚙', '관리자 센터']
};
const ADMIN_DOCUMENT_TYPES = ['지도안', '협의록', '참관록'];
// 학교별 설정: 공개수업 마지막 날짜는 관리자 설정(app_settings의 open_class_final_date)에서 내려받습니다.
// 서버 값이 없을 때만 아래 기본값을 씁니다.
const DEFAULT_OPEN_CLASS_FINAL_DATE = '2026-11-30';
function openClassFinalDate() {
  const value = (typeof state !== 'undefined' && state?.config?.openClassFinalDate) || (typeof loginOptions !== 'undefined' && loginOptions?.openClassFinalDate) || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : DEFAULT_OPEN_CLASS_FINAL_DATE;
}
function finalDateLabel() {
  const text = openClassFinalDate();
  return `${Number(text.slice(5, 7))}월 ${Number(text.slice(8, 10))}일`;
}
function appShareUrl() {
  const value = (typeof state !== 'undefined' && state?.config?.appUrl) || '';
  if (value) return value;
  try { return `${window.location.origin}/`; } catch (_error) { return ''; }
}

document.addEventListener('DOMContentLoaded', startApp);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state?.actor.isAdmin && adminTodoOpen) closeAdminTodo();
});

async function startApp() {
  setLoading(true);
  try {
    const initialDataPromise = (userSession ? api('bootstrap') : api('getLoginOptions'))
      .then(result => ({ result }))
      .catch(error => ({ error }));
    const siteStatus = await getSiteStatus();
    if (siteStatus.maintenance) {
      renderMaintenance(siteStatus.message);
      return;
    }
    const initialData = await initialDataPromise;
    if (initialData.error) throw initialData.error;
    if (userSession) {
      state = initialData.result.data;
      render();
    } else {
      loginOptions = initialData.result.data;
      await renderLogin();
    }
  } catch (error) {
    renderFatal(error.message);
  } finally {
    setLoading(false);
  }
}

async function getSiteStatus() {
  const { response, result } = await fetchJsonWithTimeout('/api/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(result.message || '운영 상태를 확인하지 못했습니다.');
  return result;
}

function serverDelayError() {
  const error = new Error('서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요.');
  error.code = 'SERVER_DELAY';
  return error;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (response.status === 504) throw serverDelayError();
    let result;
    try {
      result = await response.json();
    } catch (_error) {
      throw serverDelayError();
    }
    if (!result || typeof result !== 'object') throw serverDelayError();
    return { response, result };
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError' || error.name === 'TypeError') throw serverDelayError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function retryApp() {
  const toast = document.getElementById('toast');
  if (toast) toast.className = 'toast';
  // Reload read-only data; a timed-out mutation may already have completed on the server.
  return startApp();
}

function renderMaintenance(message) {
  state = null;
  document.getElementById('root').innerHTML = `
    <main class="login-page">
      <section class="login-card maintenance-card">
        <div class="login-mark">${BOOK_ICON}</div>
        <p class="eyebrow">TEMPORARILY CLOSED</p>
        <h1>현재 운영 준비 중입니다</h1>
        <p>${esc(message || '2학기 수업공개 신청 기간에 다시 열겠습니다.')}</p>
        <div class="maintenance-note">기존 신청 자료와 설정은 안전하게 보관됩니다.</div>
      </section>
    </main>`;
}

async function renderLogin(errorMessage = '') {
  state = null;
  if (!loginOptions) {
    const response = await api('getLoginOptions');
    loginOptions = response.data;
  }
  document.getElementById('root').innerHTML = `
    <main class="login-page login-page-overview">
      <div class="login-layout">
      <section class="login-card">
        <div class="login-mark">${BOOK_ICON}</div>
        <h1>${esc(loginOptions.appName || '수업공개·참관 관리')}</h1>
        <p>본인 이름을 선택하면 바로 시작할 수 있습니다.</p>
        <form class="login-form" onsubmit="enterTeacher(event)">
          <label for="loginTeacher">선생님 이름</label>
          <select id="loginTeacher" required>
            <option value="">이름을 선택해 주세요</option>
            ${renderTeacherLoginOptions(loginOptions.teachers)}
          </select>
          <button class="button primary wide" type="submit">교사로 시작하기</button>
        </form>
        <details class="admin-login">
          <summary>관리자 로그인</summary>
          <form class="login-form" onsubmit="enterAdmin(event)">
            <label for="adminPassword">관리자 비밀번호</label>
            <input id="adminPassword" type="password" autocomplete="current-password" required>
            <button class="button wide" type="submit">관리자로 들어가기</button>
          </form>
        </details>
        ${errorMessage ? `<div class="login-error">${esc(errorMessage)}${errorMessage.startsWith('서버 응답이 늦습니다') ? '<button class="button small" type="button" onclick="retryApp()">다시 시도</button>' : ''}</div>` : ''}
        <div class="login-domain">교내 공유용 앱입니다. 반드시 본인 이름을 선택해 주세요.</div>
      </section>
      ${renderLoginSemesterSchedule()}
      ${renderLoginObservationKings()}
      ${renderLoginRemainingTeachers()}
      </div>
    </main>`;
}

function renderLoginObservationKings() {
  const leaders = loginOptions?.applicationOverview?.leaders || [];
  const medals = ['🥇', '🥈', '🥉'];
  return `<section class="login-observation-kings" aria-labelledby="loginObservationKingsTitle">
    <div class="login-observation-kings-head">
      <div><p class="eyebrow">YEARLY OBSERVATION TOP 5</p><h2 id="loginObservationKingsTitle">🏆 ${esc(String(loginOptions?.schoolYear || new Date().getFullYear()))} 올해의 참관왕</h2><p>1·2학기 실제 참관 완료 횟수를 합산한 순위입니다.</p></div>
      <strong>TOP 5</strong>
    </div>
    ${leaders.length ? `<div class="login-observation-king-list">${leaders.map((item, index) => {
      const rank = Math.max(1, Number(item.rank) || index + 1);
      const count = Math.max(0, Number(item.count) || 0);
      const rankLabel = medals[rank - 1] || `${rank}위`;
      return `<article class="login-observation-king rank-${Math.min(rank, 5)}">
        <span class="login-observation-rank" aria-label="${rank}위">${rankLabel}</span>
        <div><strong>${esc(item.displayName)}</strong><small>${esc(item.subject || '교과 미분류')}</small></div>
        <b>${count}<em>회</em></b>
      </article>`;
    }).join('')}</div>` : `<div class="login-observation-kings-empty">아직 참석 확인이 완료된 참관 기록이 없습니다.</div>`}
    <p class="login-observation-kings-note">참석 확인이 완료된 참관만 집계하며, 교직원 공개 화면에서는 이름 마지막 글자를 가려 표시합니다.</p>
  </section>`;
}

function renderLoginSemesterSchedule() {
  const classes = [...(loginOptions.semesterClasses || [])].sort((left, right) => Number(left.date < today()) - Number(right.date < today()) || left.date.localeCompare(right.date) || Number(left.period) - Number(right.period));
  return `<section class="login-weekly">
    <div class="login-weekly-head">
      <div><p class="eyebrow">THIS WEEK · NEXT WEEK</p><h2>이번 주·다음 주 공개수업 일정</h2><p>이번 주 월요일부터 다음 주 일요일까지의 확정 일정입니다.</p></div>
      <div class="login-weekly-actions">
        <span class="weekly-count">${classes.length}건</span>
        <button class="login-schedule-tool-button message" type="button" onclick="showLoginMessengerArchive()">메신저 확인하기</button>
        <button class="login-schedule-tool-button calendar" type="button" onclick="showLoginMonthlyCalendar()">월간 공개수업 일정 확인하기</button>
      </div>
    </div>
    ${classes.length ? `<div class="weekly-event-list semester-event-list">${classes.map(item => `
      <article class="weekly-event ${item.date < today() ? 'past' : ''}">
        <div class="weekly-date"><strong>${esc(shortDate(item.date))}</strong><span>${esc(item.weekday)}요일</span></div>
        <div class="weekly-event-body">
          <h3>${esc(item.teacherName)} 선생님 · ${esc(item.subject || '과목 미입력')}</h3>
          <p><strong>${esc(item.period)}교시 ${esc(periodTime(item.period))}</strong><span>${esc(item.className || '학급 미입력')}</span><span>${esc(displayRoom(item.room))}</span></p>
          <div class="weekly-observers"><strong>참관인</strong>${item.observers.length ? item.observers.map(observer => {
            const name = typeof observer === 'string' ? observer : observer.name;
            const subject = typeof observer === 'string' ? '' : observer.subject;
            return `<span>${esc(name)}${subject ? `(${esc(subject)})` : ''}</span>`;
          }).join('') : '<em>아직 신청 없음</em>'}</div>
        </div>
      </article>`).join('')}</div>` : `<div class="weekly-empty"><strong>이번 주와 다음 주에 확정된 공개수업이 없습니다.</strong><span>월간 일정 버튼을 누르면 11월까지의 전체 확정 일정을 볼 수 있습니다.</span></div>`}
  </section>`;
}

function showLoginMessengerArchive() {
  loginMessengerIndex = -1;
  document.getElementById('loginScheduleToolModal')?.remove();
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="loginScheduleToolModal" class="modal-backdrop login-schedule-tool-backdrop" role="dialog" aria-modal="true" aria-labelledby="loginScheduleToolTitle">
    <section class="login-schedule-tool-modal messenger-modal">
      <button class="login-application-close" type="button" onclick="closeLoginScheduleToolModal()" aria-label="메신저 확인 창 닫기">×</button>
      <div id="loginScheduleToolContent">${renderLoginMessengerArchive()}</div>
    </section>
  </div>`);
  document.querySelector('#loginScheduleToolModal .login-application-close')?.focus();
}

function renderLoginMessengerArchive() {
  const messages = loginOptions?.messengerMessages || [];
  if (!messages.length) {
    return `<header class="login-schedule-tool-head"><p class="eyebrow">MESSENGER ARCHIVE</p><h2 id="loginScheduleToolTitle">메신저 확인하기</h2><p>보낸 안내를 제목별로 모아 보는 공간입니다.</p></header>
      <div class="login-tool-empty"><strong>아직 등록된 메신저가 없습니다.</strong><span>보내주신 메신저 내용을 등록하면 이곳에 제목 목록으로 표시됩니다.</span></div>
      <footer class="login-schedule-tool-footer"><button class="button primary" type="button" onclick="closeLoginScheduleToolModal()">닫기</button></footer>`;
  }
  if (loginMessengerIndex >= messages.length) loginMessengerIndex = -1;
  const selected = loginMessengerIndex >= 0 ? messages[loginMessengerIndex] : null;
  return `<header class="login-schedule-tool-head messenger">
      <div><p class="eyebrow">MESSENGER ARCHIVE</p><h2 id="loginScheduleToolTitle">메신저 확인하기</h2><p>제목을 누르면 상세 내용을 확인할 수 있습니다.</p></div>
      <strong>${messages.length}건</strong>
    </header>
    <div class="login-messenger-browser">
      <nav class="login-messenger-title-list" aria-label="메신저 제목 목록">
        ${messages.map((message, index) => `<button type="button" class="${index === loginMessengerIndex ? 'selected' : ''}" onclick="selectLoginMessenger(${index})" aria-pressed="${index === loginMessengerIndex}">
          <span>${esc(message.title || `메신저 ${index + 1}`)}</span><b aria-hidden="true">›</b>
        </button>`).join('')}
      </nav>
      <section class="login-messenger-detail" aria-live="polite">
        ${selected ? `<header><h3>${esc(selected.title || `메신저 ${loginMessengerIndex + 1}`)}</h3><p>${selected.sentAt ? `${esc(selected.sentAt)} 발송` : '발송일 미등록'}</p></header>
          <article class="login-messenger-paper">${esc(selected.body || '').replace(/\n/g, '<br>')}</article>` : `<div class="login-messenger-detail-empty"><span>✉</span><strong>확인할 메신저 제목을 선택해 주세요.</strong><p>왼쪽 목록에서 제목을 누르면 전체 내용이 여기에 표시됩니다.</p></div>`}
      </section>
    </div>
    <footer class="login-schedule-tool-footer"><button class="button primary" type="button" onclick="closeLoginScheduleToolModal()">닫기</button></footer>`;
}

function selectLoginMessenger(index) {
  const messages = loginOptions?.messengerMessages || [];
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= messages.length) return;
  loginMessengerIndex = nextIndex;
  const content = document.getElementById('loginScheduleToolContent');
  if (content) content.innerHTML = renderLoginMessengerArchive();
  window.setTimeout(() => document.querySelector('.login-messenger-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
}

function loginCalendarMonths() {
  // 학기 시작일(semester_start_date)부터 공개수업 마지막 날짜(open_class_final_date)까지의 달을 보여 줍니다.
  const startText = /^\d{4}-\d{2}-\d{2}$/.test(String(loginOptions?.semesterStartDate || '')) ? loginOptions.semesterStartDate : '2026-09-01';
  const endText = openClassFinalDate();
  const months = [];
  let year = Number(startText.slice(0, 4));
  let month = Number(startText.slice(5, 7));
  const endKey = endText.slice(0, 7);
  while (months.length < 12) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= endKey) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

function showLoginMonthlyCalendar() {
  const months = loginCalendarMonths();
  const currentMonth = today().slice(0, 7);
  loginCalendarMonth = months.includes(currentMonth) ? currentMonth : months[0];
  document.getElementById('loginScheduleToolModal')?.remove();
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="loginScheduleToolModal" class="modal-backdrop login-schedule-tool-backdrop" role="dialog" aria-modal="true" aria-labelledby="loginScheduleToolTitle">
    <section class="login-schedule-tool-modal calendar-modal">
      <button class="login-application-close" type="button" onclick="closeLoginScheduleToolModal()" aria-label="월간 일정 창 닫기">×</button>
      <div id="loginScheduleToolContent">${renderLoginMonthlyCalendar()}</div>
    </section>
  </div>`);
  document.querySelector('#loginScheduleToolModal .login-application-close')?.focus();
}

function moveLoginCalendarMonth(direction) {
  const months = loginCalendarMonths();
  const index = Math.max(0, months.indexOf(loginCalendarMonth));
  loginCalendarMonth = months[Math.max(0, Math.min(months.length - 1, index + Number(direction || 0)))];
  const content = document.getElementById('loginScheduleToolContent');
  if (content) content.innerHTML = renderLoginMonthlyCalendar();
}

function renderLoginMonthlyCalendar() {
  const months = loginCalendarMonths();
  const monthIndex = Math.max(0, months.indexOf(loginCalendarMonth));
  const monthKey = months[monthIndex];
  const [year, month] = monthKey.split('-').map(Number);
  const firstWeekday = new Date(`${monthKey}-01T12:00:00+09:00`).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const classes = [...(loginOptions?.calendarClasses || [])]
    .filter(item => String(item.date || '').startsWith(monthKey))
    .sort((left, right) => left.date.localeCompare(right.date) || Number(left.period) - Number(right.period) || String(left.teacherName).localeCompare(String(right.teacherName), 'ko'));
  const byDate = new Map();
  classes.forEach(item => {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  });
  const cells = Array.from({ length: firstWeekday }, () => '<div class="login-calendar-day outside" aria-hidden="true"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    const events = byDate.get(dateKey) || [];
    cells.push(`<div class="login-calendar-day ${dateKey === today() ? 'today' : ''} ${events.length ? 'has-events' : ''}">
      <div class="login-calendar-date"><strong>${day}</strong>${events.length ? `<span>${events.length}건</span>` : ''}</div>
      <div class="login-calendar-events">${events.map(item => {
        const observerNames = (Array.isArray(item.observers) ? item.observers : [])
          .map(observer => {
            const name = publicMaskedName(typeof observer === 'string' ? observer : observer.name);
            const subject = typeof observer === 'string' ? '' : String(observer.subject || '').trim();
            return name ? `${name}${subject ? `(${subject})` : ''}` : '';
          })
          .filter(Boolean);
        return `<button class="login-calendar-event" type="button" title="${attr(`${item.teacherName} 선생님 ${item.subject || ''} ${item.period}교시 상세 보기`)}" aria-label="${attr(`${item.teacherName} 선생님 ${item.period}교시 수업 상세 보기`)}" onclick="showLoginCalendarClassDetail('${attr(item.id)}')">
          <strong>${esc(item.period)}교시 · ${esc(item.teacherName)}</strong>
          <span>${esc(item.subject || '과목 미입력')} · ${esc(item.className || '학급 미입력')} · ${esc(displayRoom(item.room))}</span>
          <span class="login-calendar-observer-line"><b>참관</b>${observerNames.length ? esc(observerNames.join(', ')) : '<em>신청 없음</em>'}</span>
        </button>`;
      }).join('')}</div>
    </div>`);
  }
  while (cells.length % 7) cells.push('<div class="login-calendar-day outside" aria-hidden="true"></div>');
  return `<header class="login-schedule-tool-head calendar">
      <div><p class="eyebrow">MONTHLY OPEN CLASS</p><h2 id="loginScheduleToolTitle">월간 공개수업 일정</h2><p>참관인은 개인정보 보호를 위해 이름 마지막 글자를 가려 표시합니다.</p></div>
      <div class="login-calendar-head-actions"><strong>${classes.length}건</strong><button class="button login-calendar-print-button" type="button" onclick="printLoginMonthlyCalendar()">🖨 인쇄하기</button></div>
    </header>
    <nav class="login-calendar-nav" aria-label="월 선택">
      <button class="button" type="button" onclick="moveLoginCalendarMonth(-1)" ${monthIndex === 0 ? 'disabled' : ''}>← 이전 달</button>
      <h3>${year}년 ${month}월</h3>
      <button class="button" type="button" onclick="moveLoginCalendarMonth(1)" ${monthIndex === months.length - 1 ? 'disabled' : ''}>다음 달 →</button>
    </nav>
    <div class="login-calendar-print-heading"><strong>${year}학년도 2학기 ${month}월 수업공개 계획</strong><span>교내 수업공개·참관 일정</span></div>
    <div class="login-calendar-scroll">
      <div class="login-calendar-grid weekday">${['일', '월', '화', '수', '목', '금', '토'].map(day => `<strong>${day}</strong>`).join('')}</div>
      <div class="login-calendar-grid days">${cells.join('')}</div>
    </div>
    <footer class="login-schedule-tool-footer split calendar-footer"><span>현재 선택한 ${month}월 계획이 A4 가로 방향으로 인쇄됩니다.</span><div><button class="button login-calendar-print-button" type="button" onclick="printLoginMonthlyCalendar()">🖨 월간 계획 인쇄</button><button class="button primary" type="button" onclick="closeLoginScheduleToolModal()">닫기</button></div></footer>`;
}

function publicMaskedName(value) {
  const name = String(value || '').trim().replace(/\s+/g, '');
  if (!name || name.endsWith('*')) return name;
  return name.length <= 1 ? '*' : `${name.slice(0, -1)}*`;
}

function printLoginMonthlyCalendar() {
  if (!document.getElementById('loginScheduleToolModal')) return;
  window.print();
}

function showLoginCalendarClassDetail(classId) {
  const item = (loginOptions?.calendarClasses || []).find(row => row.id === classId);
  if (!item) return showToast('공개수업 정보를 찾을 수 없습니다.', true);
  const observers = Array.isArray(item.observers) ? item.observers : [];
  document.getElementById('loginClassDetailModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="loginClassDetailModal" class="modal-backdrop login-class-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="loginClassDetailTitle">
    <section class="login-schedule-tool-modal login-class-detail-modal">
      <button class="login-application-close" type="button" onclick="closeLoginCalendarClassDetail()" aria-label="공개수업 상세 창 닫기">×</button>
      <header class="login-schedule-tool-head class-detail">
        <div><p class="eyebrow">OPEN CLASS DETAIL</p><h2 id="loginClassDetailTitle">${esc(item.teacherName)} 선생님 공개수업</h2><p>${esc(item.subject || '과목 미입력')}${item.topic ? ` · ${esc(item.topic)}` : ''}</p></div>
        <strong>${observers.length}/${item.capacity || 4}명</strong>
      </header>
      <div class="login-class-detail-grid">
        <article><span>날짜</span><strong>${esc(fmtDate(item.date))}</strong></article>
        <article><span>교시</span><strong>${esc(item.period)}교시</strong><small>${esc(periodTime(item.period))}</small></article>
        <article><span>수업 학급</span><strong>${esc(item.className || '학급 미입력')}</strong></article>
        <article class="room"><span>교실 위치</span><strong>${esc(displayRoom(item.room))}</strong></article>
      </div>
      <section class="login-class-observers">
        <div class="login-class-observers-head"><div><p class="eyebrow">OBSERVERS</p><h3>참관인</h3></div><span>${observers.length}명 신청</span></div>
        ${observers.length ? `<div class="login-class-observer-list">${observers.map(observer => {
          const name = typeof observer === 'string' ? observer : observer.name;
          const subject = typeof observer === 'string' ? '' : observer.subject;
          return `<span><strong>${esc(name)}</strong>${subject ? `<small>${esc(subject)}</small>` : ''}</span>`;
        }).join('')}</div>` : '<div class="login-class-observer-empty">아직 신청한 참관인이 없습니다.</div>'}
      </section>
      <footer class="login-schedule-tool-footer"><button class="button primary" type="button" onclick="closeLoginCalendarClassDetail()">달력으로 돌아가기</button></footer>
    </section>
  </div>`);
  document.querySelector('#loginClassDetailModal .login-application-close')?.focus();
}

function closeLoginCalendarClassDetail() {
  document.getElementById('loginClassDetailModal')?.remove();
  if (!document.getElementById('loginScheduleToolModal')) document.body.classList.remove('login-notice-open');
}

function closeLoginScheduleToolModal() {
  document.getElementById('loginClassDetailModal')?.remove();
  document.getElementById('loginScheduleToolModal')?.remove();
  document.body.classList.remove('login-notice-open');
}

function loginDeadlineCard(label, windowValue, fallback, progressText = '', interactive = false, statusOverride = null, panelType = 'open') {
  const window = typeof windowValue === 'string' ? { start: '', end: windowValue } : (windowValue || fallback || {});
  const start = window.start || fallback.start || '';
  const end = window.end || fallback.end || '';
  const status = statusOverride || applicationWindowStatus(start, end);
  const tag = interactive ? 'button' : 'div';
  const interaction = interactive ? ' type="button" class="login-deadline-card interactive' : ' class="login-deadline-card';
  const attributes = interactive ? ` aria-expanded="false" aria-controls="loginApplicationStatusPanel" onclick="toggleLoginApplicationStatus('${attr(panelType)}', this)"` : '';
  return `<${tag}${interaction} ${status.closed ? 'closed' : ''} ${status.active ? 'active' : ''}"${attributes}><span>${esc(label)} 기간</span><strong>${esc(formatDateRange(start, end))}</strong>${progressText ? `<small>${esc(progressText)}</small>` : ''}<em>${esc(status.label)}</em>${interactive ? '<b class="login-deadline-toggle-label">신청 현황 보기⌄</b>' : ''}</${tag}>`;
}

function renderLoginApplicationPeriods() {
  const deadlines = loginOptions.deadlines || {};
  const overview = loginOptions.applicationOverview || { open: { applied: [], missing: [] }, observation: { ready: [], missing: [] } };
  const openApplied = overview.open?.applied?.length || 0;
  const openTotal = openApplied + (overview.open?.missing?.length || 0);
  const observationReady = overview.observation?.ready?.length || 0;
  const observationTotal = observationReady + (overview.observation?.missing?.length || 0);
  const observationActive = loginOptions.operationPhase === '참관신청';
  const openStatus = observationActive ? { label: '접수 완료', closed: true, active: false } : null;
  const observationStatus = observationActive ? { label: '접수 중', closed: false, active: true } : null;
  return `<section class="login-deadline-section login-period-board">
    <div class="login-deadline-head"><div><p class="eyebrow">APPLICATION SCHEDULE</p><h2>2학기 신청 일정</h2><p>신청 종류별 접수 기간을 확인해 주세요.</p></div><strong>현재 운영 단계에 따라 신청 상태가 표시됩니다.</strong></div>
    <div class="login-deadlines">
      ${loginDeadlineCard('공개수업 신청', deadlines.open, { start: '2026-08-26', end: '2026-08-27' }, `${openApplied}/${openTotal}명 신청 완료`, true, openStatus, 'open')}
      ${loginDeadlineCard('참관 신청', deadlines.observation, { start: '2026-08-27', end: '2026-08-31' }, `${observationReady}/${observationTotal}명 2학기 신청 완료`, true, observationStatus, 'observation')}
    </div>
    <div id="loginApplicationStatusPanel" class="login-period-status-panel" hidden>
      ${renderLoginOpenApplicationStatusBody(loginOpenApplicationStatusData())}
    </div>
  </section>`;
}

function toggleLoginApplicationStatus(type = 'open', trigger = null) {
  const panel = document.getElementById('loginApplicationStatusPanel');
  const triggers = [...document.querySelectorAll('.login-deadline-card.interactive')];
  if (!panel || !trigger) return;
  const samePanelOpen = !panel.hidden && panel.dataset.type === type;
  triggers.forEach(item => {
    item.setAttribute('aria-expanded', 'false');
    item.classList.remove('expanded');
    const itemLabel = item.querySelector('.login-deadline-toggle-label');
    if (itemLabel) itemLabel.textContent = '신청 현황 보기⌄';
  });
  if (samePanelOpen) {
    panel.hidden = true;
    panel.dataset.type = '';
    return;
  }
  panel.innerHTML = type === 'observation'
    ? renderLoginObservationApplicationStatusBody(loginObservationApplicationStatusData(), true)
    : renderLoginOpenApplicationStatusBody(loginOpenApplicationStatusData(), true);
  panel.dataset.type = type;
  panel.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('expanded');
  const label = trigger.querySelector('.login-deadline-toggle-label');
  if (label) label.textContent = '신청 현황 접기⌃';
}

function applicationWindowStatus(start, end) {
  const current = today();
  if (!start || !end) return { label: '기간 확인 필요', closed: false, active: false };
  if (current < start) return { label: '접수 예정', closed: false, active: false };
  if (current > end) return { label: '접수 마감', closed: true, active: false };
  return { label: '접수 중', closed: false, active: true };
}

function formatDateRange(start, end) {
  if (!start && !end) return '기간 미설정';
  if (!start) return `${fmtDate(end)}까지`;
  if (!end || start === end) return fmtDate(start);
  const [, startMonth, startDay] = start.split('-').map(Number);
  const [, endMonth, endDay] = end.split('-').map(Number);
  return startMonth === endMonth ? `${startMonth}월 ${startDay}일~${endDay}일` : `${startMonth}월 ${startDay}일~${endMonth}월 ${endDay}일`;
}

function renderLoginApplicationOverview() {
  const overview = loginOptions.applicationOverview || { open: { applied: [], missing: [] }, observation: { ready: [], missing: [] } };
  const deadlines = loginOptions.deadlines || {};
  const openWindow = deadlines.open || { start: '2026-08-26', end: '2026-08-27' };
  const observationWindow = deadlines.observation || { start: '2026-08-28', end: '2026-08-31' };
  const openStatus = applicationWindowStatus(openWindow.start, openWindow.end);
  const observationStatus = applicationWindowStatus(observationWindow.start, observationWindow.end);
  const showObservation = !openStatus.active && (observationStatus.active || openStatus.closed);
  const phase = showObservation ? 'observation' : 'open';
  const status = showObservation ? observationStatus : openStatus;
  const window = showObservation ? observationWindow : openWindow;
  const ready = showObservation ? (overview.observation?.ready || []) : (overview.open?.applied || []);
  const missing = showObservation ? (overview.observation?.missing || []) : (overview.open?.missing || []);
  const title = showObservation ? '참관 신청을 완료해 주세요' : '공개수업 신청을 완료해 주세요';
  const readyTitle = showObservation ? '필요 횟수 신청 완료' : '신청 완료';
  const missingTitle = showObservation ? '추가 신청 필요' : '미신청';
  const description = showObservation
    ? '1학기 참관 2회 완료자를 제외하고 2학기에 필요한 신청 횟수를 확인하세요.'
    : '2학기 공개수업 대상 교사는 기간 안에 본인의 수업 일정을 신청해 주세요.';
  return `<section class="login-application-overview ${attr(phase)} ${status.active ? 'active' : ''}">
    <div class="login-application-head"><div><p class="eyebrow">CURRENT APPLICATION</p><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="login-application-period"><span>${esc(formatDateRange(window.start, window.end))}</span><strong>${esc(status.label)}</strong></div></div>
    <div class="login-application-progress"><span style="width:${ready.length + missing.length ? Math.round(ready.length / (ready.length + missing.length) * 100) : 100}%"></span></div>
    <div class="login-application-columns">
      ${renderLoginApplicationList(readyTitle, ready, 'ready', showObservation ? '2학기에 필요한 참관 신청을 마친 교사입니다.' : '공개수업 신청을 마친 교사입니다.')}
      ${renderLoginApplicationList(missingTitle, missing, 'missing', showObservation ? '추가로 신청해야 하는 참관 횟수입니다.' : '아직 공개수업을 신청하지 않은 교사입니다.')}
    </div>
    <p class="login-application-privacy">교직원 확인용 공개 화면이므로 이름은 마지막 글자를 가려 표시합니다.</p>
  </section>`;
}

function loginApplicationNoticeKey() {
  const phase = loginOptions?.operationPhase === '참관신청' ? 'observation' : 'open';
  const fallbackWindow = phase === 'observation'
    ? { start: '2026-08-27', end: '2026-08-31' }
    : { start: '2026-08-26', end: '2026-08-27' };
  const window = loginOptions?.deadlines?.[phase] || fallbackWindow;
  return `login_${phase}_application_notice_${window.start || 'unset'}_${window.end || 'unset'}_v2`;
}

function loginOpenApplicationStatusData() {
  const overview = loginOptions.applicationOverview?.open || { applied: [], missing: [] };
  const applied = overview.applied || [];
  const missing = overview.missing || [];
  const total = applied.length + missing.length;
  const openWindow = loginOptions.deadlines?.open || { start: '2026-08-26', end: '2026-08-27' };
  return {
    applied,
    missing,
    total,
    openWindow,
    status: applicationWindowStatus(openWindow.start, openWindow.end),
    progress: total ? Math.round(applied.length / total * 100) : 100
  };
}

function renderLoginOpenApplicationStatusBody(data, includeGuidance = false) {
  return `${includeGuidance ? '<div class="login-application-guidance"><strong>신청 내용</strong><span>공개수업 일정 1건을 선택해 신청합니다. 관리자 승인 전까지는 신청 화면에서 자유롭게 수정할 수 있습니다.</span></div>' : ''}
    <div class="login-application-progress" aria-label="공개수업 신청률 ${data.progress}%"><span style="width:${data.progress}%"></span></div>
    <div class="login-application-columns">
      ${renderLoginApplicationList('신청 완료', data.applied, 'ready', '공개수업 신청을 마친 교사입니다.')}
      ${renderLoginApplicationList('미신청', data.missing, 'missing', '아직 공개수업을 신청하지 않은 교사입니다.')}
    </div>
    <p class="login-application-privacy">교직원 확인용 화면이므로 이름은 마지막 글자를 가려 표시합니다.</p>`;
}

function loginObservationApplicationStatusData() {
  const overview = loginOptions.applicationOverview?.observation || { ready: [], missing: [] };
  const applied = overview.ready || [];
  const missing = overview.missing || [];
  const total = applied.length + missing.length;
  const observationWindow = loginOptions.deadlines?.observation || { start: '2026-08-27', end: '2026-08-31' };
  return {
    applied,
    missing,
    total,
    observationWindow,
    status: applicationWindowStatus(observationWindow.start, observationWindow.end),
    progress: total ? Math.round(applied.length / total * 100) : 100
  };
}

function renderLoginObservationApplicationStatusBody(data, includeGuidance = false) {
  return `${includeGuidance ? '<div class="login-application-guidance"><strong>2학기 신청 기준</strong><span>1학기에 참관 2회를 완료한 교사는 대상에서 제외합니다. 나머지 교사는 2학기에 필요한 횟수만큼 신청했는지 확인합니다.</span></div>' : ''}
    <div class="login-application-progress" aria-label="2학기 참관 신청률 ${data.progress}%"><span style="width:${data.progress}%"></span></div>
    <div class="login-application-columns">
      ${renderLoginApplicationList('2학기 참관 신청 완료', data.applied, 'ready', '2학기에 필요한 참관 신청 횟수를 모두 채운 교사입니다.')}
      ${renderLoginApplicationList('2학기 참관 신청 미완료', data.missing, 'missing', '2학기 참관 신청이 더 필요한 교사입니다.')}
    </div>
    <p class="login-application-privacy">1학기 참관 2회 완료자는 명단에서 제외하며, 이름은 마지막 글자를 가려 표시합니다.</p>`;
}

function showLoginApplicationNotice() {
  if (!loginOptions || sessionStorage.getItem(loginApplicationNoticeKey()) === 'dismissed' || document.getElementById('loginApplicationNotice')) return;
  const observationMode = loginOptions.operationPhase === '참관신청';
  const data = observationMode ? loginObservationApplicationStatusData() : loginOpenApplicationStatusData();
  const applicationWindow = observationMode ? data.observationWindow : data.openWindow;
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="loginApplicationNotice" class="modal-backdrop login-application-backdrop" role="dialog" aria-modal="true" aria-labelledby="loginApplicationNoticeTitle">
    <section class="login-application-modal ${data.status.active ? 'active' : ''}">
      <button class="login-application-close" type="button" onclick="closeLoginApplicationNotice()" aria-label="신청기간 안내 닫기">×</button>
      <header class="login-application-modal-head">
        <div><p class="eyebrow">2ND SEMESTER APPLICATION</p><h2 id="loginApplicationNoticeTitle">${observationMode ? '참관 신청기간입니다.' : '공개수업 신청기간'}</h2><p>${observationMode ? '참관이 필요한 교사는 기간 안에 공개수업 참관을 신청해 주세요.' : '2학기 공개수업 대상 교사는 기간 안에 본인의 수업 일정을 신청해 주세요.'}</p></div>
        <div class="login-application-period"><span>${esc(formatDateRange(applicationWindow.start, applicationWindow.end))}</span><strong>${esc(data.status.label)}</strong></div>
      </header>
      ${observationMode ? renderLoginObservationApplicationStatusBody(data, true) : renderLoginOpenApplicationStatusBody(data, true)}
      <footer class="login-application-modal-actions"><button class="button primary wide" type="button" onclick="closeLoginApplicationNotice()">확인하고 닫기</button></footer>
    </section>
  </div>`);
  document.querySelector('.login-application-close')?.focus();
}

function closeLoginApplicationNotice() {
  sessionStorage.setItem(loginApplicationNoticeKey(), 'dismissed');
  document.getElementById('loginApplicationNotice')?.remove();
  document.body.classList.remove('login-notice-open');
  document.getElementById('loginTeacher')?.focus();
}

function renderLoginApplicationList(title, teachers, tone, description) {
  const teacherItems = teachers.length
    ? teachers.map(item => {
      const progress = Number(item.required) > 0 ? `<em>${Number(item.applied) || 0}/${Number(item.required)}회 신청</em>` : (item.remaining ? `<em>${Number(item.remaining)}회 더</em>` : item.completed ? '<em>연간 완료</em>' : '');
      return `<span class="login-application-teacher"><strong>${esc(item.subject || '교과 미분류')} · ${esc(item.displayName)}</strong>${progress}</span>`;
    }).join('')
    : '<p class="login-application-empty">해당 교사가 없습니다.</p>';
  return `<article class="login-application-list ${attr(tone)}"><header><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div><strong>${teachers.length}명</strong></header><div>${teacherItems}</div></article>`;
}

function renderLoginRemainingTeachers() {
  const openTeachers = loginOptions.remainingOpenTeachers || [];
  const observationTeachers = loginOptions.remainingObservationTeachers || [];
  const completedTeachers = loginOptions.completedTeachers || [];
  const teacherProgress = mergeLoginTeacherProgress(openTeachers, observationTeachers, completedTeachers);
  const inProgressTeachers = teacherProgress.filter(item => item.openRemaining || item.observationRemaining > 0);
  const annualCompletedTeachers = teacherProgress.filter(item => item.completed && !item.openRemaining && item.observationRemaining === 0);
  const totalTeachers = (loginOptions.teachers || []).length;
  return `<details class="login-progress-board login-progress-details">
    <summary class="login-progress-toggle"><div><p class="eyebrow">ANNUAL REQUIREMENTS</p><h2>연간 이행 현황</h2><p>전체 연간 현황이 필요한 경우에만 펼쳐서 확인하세요.</p></div><div class="login-progress-toggle-meta"><span>이행 중 <strong>${inProgressTeachers.length}명</strong></span><span>연간 완료 <strong>${annualCompletedTeachers.length}명</strong></span><b class="login-progress-open-label">펼쳐보기⌄</b><b class="login-progress-close-label">접기⌃</b></div></summary>
    <div class="login-progress-content">
      <div class="login-progress-summary">
        ${progressSummaryCard('전체 교사', totalTeachers, 'navy')}
        ${progressSummaryCard('이행 중', inProgressTeachers.length, 'amber')}
        ${progressSummaryCard('연간 완료', annualCompletedTeachers.length, 'green')}
      </div>
      <div class="requirement-status-groups">
        ${renderRequirementStatusGroup('이행 중', '공개수업 또는 참관 요건이 남아 있습니다.', inProgressTeachers, 'ongoing')}
        ${renderRequirementStatusGroup('연간 완료', '공개수업 1회와 참관 2회를 모두 완료했습니다.', annualCompletedTeachers, 'complete')}
      </div>
    </div>
  </details>`;
}

function progressSummaryCard(label, count, tone) {
  return `<div class="progress-summary-card ${attr(tone)}"><span>${esc(label)}</span><strong>${Number(count) || 0}명</strong></div>`;
}

function mergeLoginTeacherProgress(openTeachers, observationTeachers, completedTeachers) {
  const merged = new Map();
  const getTeacher = item => {
    const subject = item.subject || '교과 미분류';
    const key = `${subject}:${item.displayName}`;
    if (!merged.has(key)) merged.set(key, { displayName: item.displayName, subject, openRemaining: false, observationRemaining: 0, completed: false });
    return merged.get(key);
  };
  openTeachers.forEach(item => { getTeacher(item).openRemaining = true; });
  observationTeachers.forEach(item => { getTeacher(item).observationRemaining = Number(item.remaining) || 0; });
  completedTeachers.forEach(item => { getTeacher(item).completed = true; });
  return [...merged.values()].sort((left, right) => left.subject.localeCompare(right.subject, 'ko') || left.displayName.localeCompare(right.displayName, 'ko'));
}

function renderRequirementStatusGroup(title, description, teachers, tone) {
  const subjects = [...new Set(teachers.map(item => item.subject || '교과 미분류'))].sort((left, right) => left.localeCompare(right, 'ko'));
  const subjectGroups = subjects.map(subject => {
    const subjectTeachers = teachers.filter(item => (item.subject || '교과 미분류') === subject);
    const items = subjectTeachers.map(item => {
      const statusBadges = tone === 'complete'
        ? '<span class="teacher-requirement-badge complete">✓ 완료</span>'
        : `${item.openRemaining ? '<span class="teacher-requirement-badge open">공개수업</span>' : ''}${item.observationRemaining > 0 ? `<span class="teacher-requirement-badge observation">참관 ${item.observationRemaining}회</span>` : ''}`;
      return `<div class="requirement-teacher-pill"><strong>${esc(item.displayName)}</strong><span class="teacher-requirement-badges">${statusBadges}</span></div>`;
    }).join('');
    const weight = 1 + Math.ceil(subjectTeachers.reduce((total, item) => total + 1 + Number(item.openRemaining) * .45 + Number(item.observationRemaining > 0) * .55, 0) / 4);
    return {
      subject,
      weight,
      html: `<div class="requirement-subject-group"><div class="requirement-subject-heading"><strong>${esc(subject)}</strong><span>${subjectTeachers.length}명</span></div><div class="requirement-teacher-pills">${items}</div></div>`
    };
  });
  const groups = subjectGroups.length
    ? arrangeRequirementSubjectColumns(subjectGroups).map(column => `<div class="requirement-subject-column">${column.map(group => group.html).join('')}</div>`).join('')
    : '<div class="requirement-status-empty">해당 교사가 없습니다.</div>';
  return `<section class="requirement-status-group ${attr(tone)}"><header><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div><strong>${teachers.length}명</strong></header><div class="requirement-subject-groups">${groups}</div></section>`;
}

function arrangeRequirementSubjectColumns(groups) {
  const columns = [[], []];
  const heights = [0, 0];
  const remaining = [...groups];
  const take = subject => {
    const index = remaining.findIndex(group => group.subject === subject);
    return index >= 0 ? remaining.splice(index, 1)[0] : null;
  };
  ['가정', '기술'].forEach(subject => {
    const group = take(subject);
    if (!group) return;
    columns[0].push(group);
    heights[0] += group.weight;
  });
  if (columns[0].length && remaining.length) {
    const largestIndex = remaining.reduce((best, group, index, source) => group.weight > source[best].weight ? index : best, 0);
    const largest = remaining.splice(largestIndex, 1)[0];
    columns[1].push(largest);
    heights[1] += largest.weight;
  }
  remaining.forEach(group => {
    const target = heights[0] <= heights[1] ? 0 : 1;
    columns[target].push(group);
    heights[target] += group.weight;
  });
  return columns.filter(column => column.length);
}

function renderTeacherLoginOptions(teachers) {
  const groups = new Map();
  (teachers || []).forEach(item => {
    const subject = item.subjectGroup || item.subject || '교과 미분류';
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(item);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'ko'))
    .map(([subject, items]) => `<optgroup label="${attr(subject)}">${items.map(item => {
      const displayName = item.displayName || item.name || '';
      return `<option value="${attr(item.id)}">${esc(subject)} - ${esc(displayName)}</option>`;
    }).join('')}</optgroup>`)
    .join('');
}

async function enterTeacher(event) {
  event.preventDefault();
  const teacherId = value('loginTeacher');
  if (!teacherId) return showToast('본인 이름을 선택해 주세요.', true);
  userSession = { actorType: 'teacher', teacherId };
  sessionStorage.removeItem(`personal_schedule_popup_${loginOptions?.schoolYear || 2026}_${teacherId}`);
  storeSession();
  await loadApp();
}

async function enterAdmin(event) {
  event.preventDefault();
  const password = value('adminPassword');
  setLoading(true);
  try {
    const { response, result } = await fetchJsonWithTimeout('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok || !result.ok) throw new Error(result.message || '관리자 비밀번호가 올바르지 않습니다.');
    userSession = { actorType: 'admin', adminToken: result.token };
    activeTab = 'dashboard';
    storeSession();
    await loadApp();
  } catch (error) {
    try {
      await renderLogin(error.message);
    } catch (loginError) {
      renderFatal(loginError.message);
    }
  } finally {
    setLoading(false);
  }
}

function signOut() {
  if (state && !state.actor.isAdmin) sessionStorage.removeItem(personalSchedulePopupKey());
  adminTodoOpen = null;
  adminTodoMessage = null;
  userSession = null;
  state = null;
  loginOptions = null;
  completionNoticeShownFor = '';
  editingAnnualTeacherId = '';
  annualEditDraft = null;
  sessionStorage.removeItem('school_open_class_session');
  return loadApp();
}

async function api(action, payload = {}, attempt = 0) {
  const headers = { 'Content-Type': 'application/json' };
  if (userSession && userSession.actorType === 'admin' && userSession.adminToken) {
    headers.Authorization = `Bearer ${userSession.adminToken}`;
  }
  const { response, result } = await fetchJsonWithTimeout('/api', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action,
      payload,
      actorType: userSession ? userSession.actorType : 'public',
      teacherId: userSession && userSession.actorType === 'teacher' ? userSession.teacherId : ''
    })
  });
  if ((!response.ok || !result.ok) && /JWT issued at future/i.test(result.message || '') && attempt < 2) {
    await wait(900 * (attempt + 1));
    return api(action, payload, attempt + 1);
  }
  if (response.status === 401 || response.status === 403) {
    userSession = null;
    sessionStorage.removeItem('school_open_class_session');
    await renderLogin(result.message || '다시 로그인해 주세요.');
    throw new Error(result.message || '로그인이 필요합니다.');
  }
  if (!response.ok || !result.ok) {
    const message = /JWT issued at future/i.test(result.message || '')
      ? '서버 인증 시간이 잠시 맞지 않습니다. 잠시 후 다시 시도해 주세요.'
      : (result.message || '요청을 처리하지 못했습니다.');
    throw new Error(message);
  }
  return result;
}

async function loadApp() {
  setLoading(true);
  try {
    if (!userSession) {
      await renderLogin();
      return;
    }
    const response = await api('bootstrap');
    editingAnnualTeacherId = '';
    annualEditDraft = null;
    state = response.data;
    render();
  } catch (error) {
    if (userSession || error.code === 'SERVER_DELAY') renderFatal(error.message);
  } finally {
    setLoading(false);
  }
}

async function mutate(action, payload, options = {}) {
  if (options.confirm && !window.confirm(options.confirm)) return null;
  setLoading(true);
  try {
    const response = await api(action, payload);
    if (response.data) state = response.data;
    if (options.clearSelections) selectedObservationIds.clear();
    render();
    if (!options.silent) showToast(response.message || '처리되었습니다.');
    return response;
  } catch (error) {
    if (userSession) showRequestError(error);
    return null;
  } finally {
    setLoading(false);
  }
}

function render() {
  if (!state) return;
  if (activeTab === 'admin' && !state.actor.isAdmin) activeTab = 'dashboard';
  if (state.actor.isAdmin && !['dashboard', 'admin'].includes(activeTab)) activeTab = 'dashboard';
  if (!isTabEnabled(activeTab)) activeTab = 'dashboard';
  initializeAdminTodo();
  document.getElementById('root').innerHTML = `
    <header class="app-header ${state.actor.isAdmin ? 'admin-header' : ''}">
      <div class="header-inner">
        <div class="brand">
          <div class="brand-mark">${BOOK_ICON}</div>
          <div><h1>${esc(state.config.appName)}</h1><p>${esc(state.config.schoolYear)}학년도 ${esc(state.config.semester)}학기</p></div>
        </div>
        <div class="user-box">
          <div class="user-meta"><strong>${esc(state.actor.name)}${state.actor.isAdmin ? '' : ' 선생님'}</strong><small>${esc(state.actor.role)}</small></div>
          ${renderAdminTodoButton()}
          <button class="icon-button" onclick="loadApp()" title="새로고침">↻</button>
          <button class="icon-button" onclick="signOut()" title="로그아웃">나가기</button>
        </div>
      </div>
    </header>
    <div class="layout">
      <nav class="sidebar">${renderNavigation()}</nav>
      <main>${renderPage()}</main>
    </div>
    ${state.actor.isAdmin ? `<div id="adminTodoHost">${renderAdminTodoPopup()}</div>` : ''}`;
  const personalScheduleShown = showPersonalSchedulePopup();
  if (!personalScheduleShown) {
    const notificationShown = showImportantNotification();
    if (!notificationShown) {
      const observationReminderHandled = showObservationApplicationReminder();
      if (!observationReminderHandled && state.config.operationPhase !== '참관신청') showAnnualCompletionNotice();
    }
  }
}

function adminTodoSessionKey() {
  return `admin_todo_closed_${state.config.schoolYear}_${state.actor.id || 'admin'}`;
}

function initializeAdminTodo() {
  if (!state?.actor.isAdmin) { adminTodoOpen = null; adminTodoMessage = null; return; }
  if (adminTodoOpen !== null) return;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(adminTodoSessionKey()) === '1'; } catch (_error) { /* In-memory close still works when storage is unavailable. */ }
  adminTodoOpen = Boolean(state.admin?.todo?.total) && !dismissed;
}

function renderAdminTodoButton() {
  if (!state?.actor.isAdmin) return '';
  const total = state.admin?.todo?.total || 0;
  return `<button id="adminTodoButton" class="button small admin-todo-button" type="button" aria-controls="adminTodoDialog" aria-expanded="${Boolean(adminTodoOpen)}" onclick="openAdminTodo()">${total ? `할 일 ${total}` : '할 일 없음'}</button>`;
}

function renderAdminTodoPopup() {
  const todo = state?.actor.isAdmin && state.admin?.todo;
  if (!todo || !adminTodoOpen) return '';
  const item = (label, count, destination, detail = '') => `<section class="admin-todo-item"><div class="admin-todo-item-heading"><h3>${label} <span>${count}건</span></h3><button class="button small" type="button" onclick="goAdminTodoSection('${destination}')">바로가기<span class="sr-only">: ${label}</span></button></div>${detail}</section>`;
  const changes = todo.pendingChanges.map(row => `<li>${esc(row.teacherName || '교사 정보 없음')} · ${esc(row.subject || '교과 미분류')}</li>`).join('');
  const messages = todo.messageClasses.map(row => `<li class="admin-todo-lesson ${row.isToday ? 'today' : ''}"><p>${row.isToday ? '<strong class="badge blue">오늘</strong> ' : ''}${fmtDate(row.date)} · ${esc(row.period)}교시</p><strong>${esc(row.teacherName)} 선생님</strong><span>참관 ${esc(row.observerCount)}명</span><div class="actions"><button class="button small" type="button" onclick="makeAdminTodoMessage('${attr(row.id)}','reminder')">리마인드 문구</button></div></li>`).join('');
  const current = adminTodoMessage;
  const currentClass = current && todo.messageClasses.find(row => row.id === current.classId);
  const generated = currentClass ? `<section class="admin-todo-generated"><h4>${esc(currentClass.teacherName)} · 리마인드</h4><label class="sr-only" for="adminTodoMessageText">생성된 메신저 문구</label><textarea id="adminTodoMessageText" oninput="adminTodoMessage.text=this.value" placeholder="문구를 생성하고 있습니다.">${esc(current.text)}</textarea><p class="admin-todo-recipients">받는 사람: ${messageRecipientsForClass(current.classId, current.type).map(esc).join(', ')}</p><div class="actions"><button class="button primary small" type="button" onclick="copyMessage('adminTodoMessageText')">문구 복사</button><button class="button small" type="button" onclick="copyMessageRecipients('${attr(current.classId)}','${current.type}')">받는 사람 복사</button></div></section>` : '';
  return `<aside id="adminTodoDialog" class="admin-todo-dialog" role="dialog" aria-label="관리자 오늘 할 일" aria-modal="false"><header class="admin-todo-heading"><div><h2>오늘 할 일</h2><p>${esc(todo.today)} 기준 · 처리할 일 ${todo.total}건</p></div><button id="adminTodoClose" class="button small" type="button" onclick="closeAdminTodo()" aria-label="오늘 할 일 닫기">닫기</button></header><div class="admin-todo-body">
    ${item('일정 변경 승인 대기', todo.pendingChanges.length, 'changes', changes ? `<ul>${changes}</ul>` : '')}
    ${item('공개수업 신청 승인 대기', todo.pendingClasses, 'open')}
    ${item('시간표 충돌 미해결', todo.conflicts, 'conflicts')}
    <section class="admin-todo-item"><h3>메신저 문구 만들기</h3><p>이번 주·다음 주 수업 ${todo.messageClasses.length}건</p><small>${esc(todo.today)} ~ ${esc(todo.messageEnd)} · 할 일 건수에서 제외</small><ul class="admin-todo-lessons">${messages || '<li>이 기간의 확정된 2학기 수업이 없습니다.</li>'}</ul>${generated}</section>
    ${item('제출자료 미완료', todo.missingDocuments, 'documents', `<p>지난 수업 ${todo.missingDocumentClasses}건 · 미완료 자료 ${todo.missingDocuments}건</p><small>지도안·협의록·참관록, 1·2학기 확정 수업 기준</small>`)}
    </div></aside>`;
}

function refreshAdminTodoPopup() {
  const host = document.getElementById('adminTodoHost');
  if (host) host.innerHTML = renderAdminTodoPopup();
  const button = document.getElementById('adminTodoButton');
  button?.setAttribute('aria-expanded', String(Boolean(adminTodoOpen)));
}

function openAdminTodo() {
  if (!state?.actor.isAdmin) return;
  adminTodoOpen = true;
  refreshAdminTodoPopup();
  document.getElementById('adminTodoClose')?.focus?.();
}

function closeAdminTodo() {
  if (!state?.actor.isAdmin) return;
  adminTodoOpen = false;
  try { sessionStorage.setItem(adminTodoSessionKey(), '1'); } catch (_error) { /* Keep the in-memory dismissed state. */ }
  refreshAdminTodoPopup();
  document.getElementById('adminTodoButton')?.focus?.();
}

function goAdminTodoSection(destination) {
  if (!state?.actor.isAdmin) return;
  const targets = { changes: 'adminChangeApprovals', open: 'adminOpenApprovals', conflicts: 'adminScheduleConflicts', documents: 'adminDocumentCenter' };
  const target = targets[destination];
  if (!target) return;
  closeAdminTodo();
  activeTab = destination === 'documents' ? 'admin' : 'dashboard';
  if (destination === 'conflicts') rememberAdminSection('schedule-conflicts', true);
  render();
  const element = document.getElementById(target);
  if (element) {
    if (element.tagName === 'DETAILS') element.open = true;
    element.setAttribute('tabindex', '-1');
    element.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    element.focus?.({ preventScroll: true });
  }
}

async function makeAdminTodoMessage(classId, type) {
  if (!state?.actor.isAdmin || type !== 'reminder' || !state.admin?.todo?.messageClasses.some(row => row.id === classId)) return;
  const draft = { classId, type, text: '' };
  adminTodoMessage = draft;
  refreshAdminTodoPopup();
  setLoading(true);
  try {
    const response = await generateClassMessage(classId, type);
    // Ignore a stale response if the user switched accounts or selected another message.
    if (!state?.actor.isAdmin || adminTodoMessage !== draft) return;
    draft.text = response.messageText;
    refreshAdminTodoPopup();
  } catch (error) {
    if (adminTodoMessage === draft) { adminTodoMessage = null; refreshAdminTodoPopup(); }
    showRequestError(error);
  } finally {
    setLoading(false);
  }
}

function visibleNotifications() {
  const persistentTypes = new Set(['공개수업시간표충돌', '참관시간표충돌', '학사일정충돌']);
  return (state.notifications || []).filter(item => !item.read || persistentTypes.has(item.type));
}

function showImportantNotification() {
  if (!state || state.actor.isAdmin) return false;
  const item = (state.notifications || []).find(notification => !notification.read && ['일정변경', '참관취소'].includes(notification.type));
  if (!item || notificationModalShownFor.has(item.id) || document.querySelector('.modal-backdrop')) return false;
  notificationModalShownFor.add(item.id);
  const canceled = item.type === '참관취소';
  document.body.insertAdjacentHTML('beforeend', `<div id="importantNotificationModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="importantNotificationTitle">
    <section class="completion-modal notification-modal ${canceled ? 'danger' : 'warning'}">
      <div class="completion-icon">${canceled ? '!' : '↻'}</div>
      <p class="eyebrow">SCHEDULE NOTICE</p>
      <h2 id="importantNotificationTitle">${esc(item.title)}</h2>
      <p class="completion-message">${esc(item.message)}</p>
      <div class="completion-done"><strong>${canceled ? '기존 참관 신청은 취소 처리되었습니다.' : '참관 신청은 그대로 유지됩니다.'}</strong><span>${canceled ? '아래 버튼에서 가능한 다른 공개수업을 바로 선택할 수 있습니다.' : '참관 신청 화면에서 변경된 시간과 장소를 확인해 주세요.'}</span></div>
      <div class="completion-actions">
        <button class="button primary" type="button" onclick="acknowledgeNotification('${attr(item.id)}','${attr(item.actionTab || 'dashboard')}')">${canceled ? '다른 참관 신청하기' : '변경 일정 확인하기'}</button>
      </div>
    </section>
  </div>`);
  return true;
}

async function acknowledgeNotification(notificationId, actionTab = 'dashboard') {
  document.getElementById('importantNotificationModal')?.remove();
  const result = await mutate('markNotificationRead', { notificationId }, { silent: true });
  if (!result) return;
  if (actionTab && isTabEnabled(actionTab)) activeTab = actionTab;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function observationApplicationReminderKey(status) {
  return `observation_application_reminder_${state.config.schoolYear}_${state.actor.id}_${status.applied}_${status.remaining}`;
}

function showObservationApplicationReminder() {
  if (!state || state.actor.isAdmin || state.config.operationPhase !== '참관신청') return false;
  const status = state.dashboard?.observationApplicationStatus;
  if (!status?.target || status.remaining <= 0) return false;
  const noticeKey = observationApplicationReminderKey(status);
  if (sessionStorage.getItem(noticeKey) === 'dismissed' || document.getElementById('observationApplicationReminder')) return true;
  document.body.insertAdjacentHTML('beforeend', `<div id="observationApplicationReminder" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="observationApplicationReminderTitle">
    <section class="completion-modal outstanding-modal observation-application-reminder">
      <div class="completion-icon">!</div>
      <p class="eyebrow">OBSERVATION APPLICATION</p>
      <h2 id="observationApplicationReminderTitle">2학기 참관 신청이 아직 필요합니다.</h2>
      <p class="completion-message">1학기 참관 ${Number(status.firstSemesterCompleted) || 0}회를 반영한 결과, 2학기에 ${Number(status.required) || 0}회 신청이 필요합니다.</p>
      <div class="completion-done"><strong>현재 ${Number(status.applied) || 0}/${Number(status.required) || 0}회 신청</strong><span>앞으로 ${Number(status.remaining) || 0}회를 더 신청해 주세요.</span></div>
      <div class="completion-actions">
        <button class="button" type="button" onclick="closeObservationApplicationReminder()">나중에 확인</button>
        <button class="button primary" type="button" onclick="goToObservationApplicationFromReminder()">참관 신청하러 가기</button>
      </div>
    </section>
  </div>`);
  return true;
}

function closeObservationApplicationReminder() {
  const status = state.dashboard?.observationApplicationStatus;
  if (status) sessionStorage.setItem(observationApplicationReminderKey(status), 'dismissed');
  document.getElementById('observationApplicationReminder')?.remove();
}

function goToObservationApplicationFromReminder() {
  closeObservationApplicationReminder();
  observationSubTab = 'application';
  go('observe');
}

function renderNotificationPanel() {
  const items = visibleNotifications();
  if (!items.length) return '';
  return `<section class="notification-panel" aria-label="일정 충돌 및 변경 알림"><div class="notification-panel-head"><div><span>!</span><div><h3>확인할 일정 알림</h3><p>시간표 또는 공개수업 일정이 바뀌어 확인이 필요합니다.</p></div></div><b>${items.length}건</b></div>
    <div class="notification-list">${items.map(item => `<article class="notification-item ${attr(item.severity || 'warning')}"><div><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(item.createdAt || '')}</small></div><button class="button small" type="button" onclick="acknowledgeNotification('${attr(item.id)}','${attr(item.actionTab || 'dashboard')}')">확인하기</button></article>`).join('')}</div></section>`;
}

function showAnnualCompletionNotice() {
  if (!state || state.actor.isAdmin || !state.dashboard) return;
  const noticeKey = `${state.config.schoolYear}_${state.actor.id}`;
  if (completionNoticeShownFor === noticeKey || document.getElementById('annualCompletionModal')) return;
  completionNoticeShownFor = noticeKey;
  const outstanding = annualOutstandingItems();
  if (outstanding.length) {
    const first = outstanding[0];
    document.body.insertAdjacentHTML('beforeend', `<div id="annualCompletionModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="annualCompletionTitle">
      <section class="completion-modal outstanding-modal">
        <div class="completion-icon">!</div>
        <p class="eyebrow">NEXT STEP</p>
        <h2 id="annualCompletionTitle">아직 완료하지 않은 항목이 있습니다.</h2>
        <p class="completion-message">공개수업 → 참관 → 제출자료 순서로 확인해 주세요.</p>
        <div class="outstanding-list">${outstanding.map((item, index) => `<button type="button" onclick="goOutstandingItem('${attr(item.tab)}','${attr(item.subTab || '')}')"><span>${index + 1}</span><div><strong>${esc(item.title)}${index === 0 ? '<em>우선 확인</em>' : ''}</strong><small>${esc(item.description)}</small></div><b>확인 ›</b></button>`).join('')}</div>
        <div class="completion-actions">
          <button class="button" type="button" onclick="closeAnnualCompletionNotice()">내 대시보드 보기</button>
          <button class="button primary" type="button" onclick="goOutstandingItem('${attr(first.tab)}','${attr(first.subTab || '')}')">${esc(first.title)} 확인하기</button>
        </div>
      </section>
    </div>`);
    return;
  }
  const documentText = state.dashboard.documentRequiredCount ? '공개수업과 참관, 제출자료를 모두 완료했습니다.' : '올해 공개수업과 참관을 모두 완료하였습니다!';
  document.body.insertAdjacentHTML('beforeend', `<div id="annualCompletionModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="annualCompletionTitle">
    <section class="completion-modal">
      <div class="completion-icon">✓</div>
      <p class="eyebrow">ANNUAL GOAL COMPLETE</p>
      <h2 id="annualCompletionTitle">축하드립니다!</h2>
      <p class="completion-message">${esc(documentText)}</p>
      <div class="completion-done"><strong>올해 필수로 해야 할 항목은 더 없습니다.</strong><span>공개수업 1회와 실제 참관 2회 이상을 모두 충족했습니다.</span></div>
      <p class="completion-extra">추가로 수업 참관을 원하시는 선생님들께서는 <strong>참관 신청</strong>을 눌러주세요.</p>
      <div class="completion-actions">
        <button class="button" type="button" onclick="closeAnnualCompletionNotice()">내 대시보드 보기</button>
        <button class="button primary" type="button" onclick="goAdditionalObservation()">추가 참관 신청</button>
      </div>
    </section>
  </div>`);
}

function annualOutstandingItems() {
  const dashboard = state.dashboard;
  const items = [];
  if (!dashboard.annual.openCompleted) {
    items.push({ tab: 'open', title: '공개수업', description: dashboard.openClassStatus === '미신청' ? '공개수업 일정을 신청해 주세요.' : `현재 상태: ${dashboard.openClassStatus}` });
  }
  if (!dashboard.annual.observationRequirementMet) {
    const remaining = Math.max(0, 2 - Number(dashboard.annual.observationCompleted || 0));
    items.push({ tab: 'observe', title: '참관', description: `실제 참관 ${remaining}회가 더 필요합니다.` });
  }
  const missingTasks = (state.documentTasks || []).filter(task => !task.status);
  if (missingTasks.length) {
    const missingTypes = [...new Set(missingTasks.map(task => documentTypeLabel(task.type)))];
    items.push({ tab: 'operation', subTab: 'documents', title: '제출자료', description: `${missingTypes.join(', ')}을 제출해 주세요.` });
  }
  return items;
}

function goOutstandingItem(tab, subTab = '') {
  closeAnnualCompletionNotice();
  if (tab === 'operation' && subTab === 'documents') operationSubTab = 'documents';
  go(tab);
}

function closeAnnualCompletionNotice() {
  document.getElementById('annualCompletionModal')?.remove();
}

function goAdditionalObservation() {
  closeAnnualCompletionNotice();
  if (!isTabEnabled('observe')) {
    showToast('현재는 참관 신청 기간이 아닙니다. 참관 신청 단계에 다시 이용해 주세요.', true);
    return;
  }
  activeTab = 'observe';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderNavigation() {
  if (state.actor.isAdmin) {
    return `<div class="phase-chip"><span>관리자 메뉴</span><strong>운영·자료 관리</strong></div>${navButton('dashboard', '관리자 대시보드')}${navButton('admin')}`;
  }
  const regular = ['dashboard', 'open', 'observe', 'operation'];
  let html = `<div class="phase-chip"><span>현재 단계</span><strong>${esc(state.config.operationPhaseLabel || '전체 운영')}</strong></div>`;
  html += regular.map(key => navButton(key, key === 'open' && isOpenApplicationClosed() && hasConfirmedOpenClass() ? '공개수업 일정 변경' : '')).join('');
  return html;
}

function navButton(key, labelOverride = '') {
  const meta = TAB_META[key];
  const enabled = isTabEnabled(key);
  return `<button class="nav-button ${activeTab === key ? 'active' : ''} ${enabled ? '' : 'locked'}" onclick="go('${key}')" aria-disabled="${enabled ? 'false' : 'true'}" title="${enabled ? '' : '현재 운영 단계에서는 사용할 수 없습니다.'}"><span class="nav-icon">${enabled ? meta[0] : '🔒'}</span>${esc(labelOverride || meta[1])}</button>`;
}

function go(tab) {
  if (!isTabEnabled(tab)) {
    showToast(`현재는 ${TAB_META[tab][1]} 기간이 아닙니다.`, true);
    return;
  }
  if (tab === 'observe' && !state.actor.isAdmin && state.dashboard?.annual?.observationRequirementMet) {
    if (!window.confirm('이미 연간 참관 2회를 완료하였습니다. 추가로 참관 신청하시겠습니까?')) return;
  }
  if (tab !== 'dashboard') {
    editingAnnualTeacherId = '';
    annualEditDraft = null;
  }
  if (tab === 'open' && isOpenApplicationClosed() && hasConfirmedOpenClass()) openSubTab = 'change';
  activeTab = tab;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hasConfirmedOpenClass() {
  return Boolean(state?.myOpenClasses?.some(item => item.semester === 2 && item.status === '확정'));
}

function isOpenApplicationClosed() {
  return Boolean(state?.config?.tabAccess && state.config.tabAccess.open === false);
}

function isTabEnabled(tab) {
  if (!state || !state.config || !state.config.tabAccess) return true;
  if (['dashboard', 'admin'].includes(tab)) return true;
  if (tab === 'open' && state.myOpenClasses?.some(item => item.semester === 2 && ['승인대기', '확정'].includes(item.status))) return true;
  return state.config.tabAccess[tab] !== false;
}

function renderPage() {
  switch (activeTab) {
    case 'open': return renderOpenClass();
    case 'observe': return renderObservations();
    case 'operation': return renderOperation();
    case 'admin': return renderAdmin();
    default: return renderDashboard();
  }
}

function pageHead(eyebrow, title, description) {
  return `<div class="page-head"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2><p>${esc(description)}</p></div>`;
}

function renderSectionTabs(items, selected, handler) {
  return `<div class="section-tabs" role="tablist">${items.map(item => `<button type="button" role="tab" class="section-tab ${selected === item.key ? 'active' : ''}" aria-selected="${selected === item.key ? 'true' : 'false'}" onclick="${handler}('${item.key}')"><span>${item.icon}</span>${esc(item.label)}</button>`).join('')}</div>`;
}

function renderDashboard() {
  if (state.actor.isAdmin && state.admin) return renderAdminDashboard();
  const d = state.dashboard;
  const confirmedOpen = state.myOpenClasses
    .filter(item => item.semester === 2 && item.status === '확정')
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.period) - Number(b.period))[0];
  const nextObservation = state.myObservations
    .filter(item => item.semester === 2 && item.status === '확정' && item.date >= today())
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.period) - Number(b.period))[0];

  const remaining = [];
  if (!d.annual.openCompleted) remaining.push('공개수업 1회');
  if (!d.annual.observationRequirementMet) remaining.push(`참관 ${2 - d.annual.observationCompleted}회`);
  if (d.pendingDocumentCount) remaining.push(`제출자료 ${d.pendingDocumentCount}건`);
  const openNote = d.firstSemester.openCompleted
    ? '1학기 완료'
    : (d.secondSemester.openCompleted ? '2학기 완료' : `2학기 ${d.secondSemester.openStatus}`);
  const documentRequired = d.documentRequiredCount || 0;
  const documentSubmitted = d.documentSubmittedCount || 0;
  const documentProgress = documentRequired ? Math.round((documentSubmitted / documentRequired) * 100) : 100;
  const documentCompleted = d.annual.openCompleted && !d.pendingDocumentCount && !d.paperPendingCount;

  const dashboardCards = [
    {
      completed: d.annual.openCompleted,
      html: confirmedOpen ? renderConfirmedOpenDashboardCard(confirmedOpen) : dashboardCategoryCard({
        icon: '▣', title: '공개수업', tone: d.annual.openCompleted ? 'green' : 'blue', status: d.annual.openCompleted ? '완료' : d.openClassStatus,
        description: `연간 1회 기준 · ${openNote}`, details: [`1학기 ${d.firstSemester.openStatus}`, `2학기 ${d.secondSemester.openStatus}`], tab: 'open', button: '공개수업 일정 보기'
      })
    },
    {
      completed: d.annual.observationRequirementMet,
      html: dashboardCategoryCard({
        icon: '◎', title: '참관', tone: d.annual.observationRequirementMet ? 'green' : 'amber',
        status: d.annual.observationRequirementMet ? '2회 완료' : `${d.annual.observationCompleted}/2회`,
        description: nextObservation ? `${fmtDate(nextObservation.date)} ${nextObservation.period}교시 · ${displayRoom(nextObservation.room)}` : '공개수업 진행자가 참석으로 확인한 횟수',
        details: nextObservation ? [`${nextObservation.teacherName} 선생님`, `${nextObservation.className} · ${nextObservation.subject}`] : [`1학기 ${d.firstSemester.observationCompleted}회`, `2학기 ${d.secondSemester.observationCompleted}회`],
        tab: 'observe', button: '참관 일정 보기', progress: Math.min(100, d.annual.observationCompleted / 2 * 100)
      })
    },
    {
      completed: documentCompleted,
      html: dashboardCategoryCard({
        icon: '▤', title: '제출자료', tone: documentCompleted ? 'green' : 'red',
        status: documentRequired ? `${documentSubmitted}/${documentRequired}건` : '제출 대상 없음',
        description: d.pendingDocumentCount ? `미제출 ${d.pendingDocumentCount}건` : (d.paperPendingCount ? `수기 확인 대기 ${d.paperPendingCount}건` : '현재 처리할 자료가 없습니다.'),
        details: d.paperPendingCount ? [`수기 확인 대기 ${d.paperPendingCount}건`] : ['온라인·수기 제출 현황'],
        tab: 'operation', button: '운영 화면 보기', progress: documentProgress
      })
    }
  ];
  const inProgressCards = dashboardCards.filter(card => !card.completed);
  const completedCards = dashboardCards.filter(card => card.completed);

  return `
    <section class="hero">
      <h2>${esc(state.actor.name)} 선생님, 안녕하세요.</h2>
      <p>지금은 <strong>${esc(state.config.operationPhaseLabel)}</strong> 단계입니다. 진행 중인 일과 완료한 일을 한눈에 확인하세요.</p>
      <div class="hero-actions">${dashboardActionButton('open', '공개수업 확인')}${dashboardActionButton('observe', '참관 확인')}${dashboardActionButton('operation', '공개수업 운영')}</div>
    </section>
    ${renderPersonalScheduleOverview()}
    ${renderNotificationPanel()}
    ${d.annual.allRequirementsMet && !d.pendingDocumentCount ? `<div class="notice success"><span>✓</span><div><strong>현재 교사가 처리할 공개수업·참관·제출자료를 모두 완료했습니다.</strong></div></div>` : `<div class="notice warning"><span>!</span><div><strong>아직 ${esc(remaining.join(', '))}가 필요합니다.</strong><br><span class="muted">공개수업 → 참관 → 제출자료 순서로 확인해 주세요.</span></div></div>`}
    <div class="dashboard-status-board">
      ${renderDashboardStatusGroup('in-progress', '진행 중', '지금 확인하거나 처리할 항목', inProgressCards)}
      ${renderDashboardStatusGroup('completed', '완료', '올해 기준을 충족한 항목', completedCards)}
    </div>`;
}

function personalScheduleItems() {
  const openClasses = (state.myOpenClasses || [])
    .filter(item => item.semester === 2 && ['승인대기', '확정'].includes(item.status))
    .sort(sortPersonalScheduleItems);
  const observations = (state.myObservations || [])
    .filter(item => item.semester === 2 && item.status === '확정')
    .sort(sortPersonalScheduleItems);
  return { openClasses, observations };
}

function sortPersonalScheduleItems(left, right) {
  const leftPast = String(left.date || '') < today();
  const rightPast = String(right.date || '') < today();
  if (leftPast !== rightPast) return leftPast ? 1 : -1;
  const dateOrder = leftPast
    ? String(right.date || '').localeCompare(String(left.date || ''))
    : String(left.date || '').localeCompare(String(right.date || ''));
  return dateOrder || Number(left.period || 0) - Number(right.period || 0);
}

function renderPersonalScheduleOverview() {
  if (!state || state.actor.isAdmin) return '';
  const schedules = personalScheduleItems();
  return `<section class="personal-schedule-overview" aria-labelledby="personalScheduleOverviewTitle">
    <header class="personal-schedule-overview-head">
      <div><p class="eyebrow">MY SCHEDULE</p><h2 id="personalScheduleOverviewTitle">내 공개수업·참관 일정</h2><p>확정된 2학기 일정을 날짜순으로 모았습니다.</p></div>
      <span>총 ${schedules.openClasses.length + schedules.observations.length}건</span>
    </header>
    ${renderPersonalSchedulePanels(schedules, false)}
  </section>`;
}

function renderPersonalSchedulePanels(schedules, modal = false) {
  return `<div class="personal-schedule-panels ${modal ? 'in-modal' : ''}">
    ${renderPersonalSchedulePanel('open', '▣', '내 공개수업 일정', '내가 진행하는 수업', schedules.openClasses, modal)}
    ${renderPersonalSchedulePanel('observe', '◎', '내 참관 일정', '내가 신청한 참관 수업', schedules.observations, modal)}
  </div>`;
}

function renderPersonalSchedulePanel(type, icon, title, description, items, modal) {
  const actionLabel = type === 'open' ? '공개수업 일정 관리' : '참관 일정 확인';
  const list = items.length
    ? items.map(item => renderPersonalScheduleItem(item, type)).join('')
    : `<div class="personal-schedule-empty"><span>${icon}</span><strong>등록된 일정이 없습니다.</strong><p>${type === 'open' ? '확정되거나 승인 대기 중인 공개수업이 없습니다.' : '2학기에 신청한 참관 일정이 없습니다.'}</p></div>`;
  return `<article class="personal-schedule-panel ${type}">
    <header><div class="personal-schedule-title"><span>${icon}</span><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div></div><b>${items.length}건</b></header>
    <div class="personal-schedule-list">${list}</div>
    <button class="personal-schedule-action" type="button" onclick="${modal ? 'closePersonalSchedulePopup();' : ''}go('${type === 'open' ? 'open' : 'observe'}')">${esc(actionLabel)} <span>›</span></button>
  </article>`;
}

function renderPersonalScheduleItem(item, type) {
  const past = String(item.date || '') < today();
  const title = type === 'open'
    ? `${item.subject || '과목 미입력'} · ${item.className || '학급 미입력'}`
    : `${item.teacherName || '교사 미입력'} 선생님 · ${item.subject || '과목 미입력'}`;
  const stateText = type === 'open'
    ? (item.status || '미확인')
    : (item.attendance === '참석' ? '참관 완료' : past ? '확인 대기' : '참관 예정');
  return `<article class="personal-schedule-item ${past ? 'past' : 'upcoming'}">
    <div class="personal-schedule-date"><strong>${esc(shortDate(item.date))}</strong><span>${esc(fmtDate(item.date).replace(/^\d+월 \d+일/, ''))}</span></div>
    <div class="personal-schedule-body"><strong>${esc(title)}</strong><p><span>${esc(item.period)}교시 ${esc(periodTime(item.period))}</span><span>${esc(displayRoom(item.room))}</span></p></div>
    <span class="personal-schedule-state">${esc(stateText)}</span>
  </article>`;
}

function personalSchedulePopupKey() {
  return `personal_schedule_popup_${state?.config?.schoolYear || 2026}_${state?.actor?.id || ''}`;
}

function showPersonalSchedulePopup() {
  if (!state || state.actor.isAdmin || activeTab !== 'dashboard' || document.querySelector('.modal-backdrop')) return false;
  const key = personalSchedulePopupKey();
  if (sessionStorage.getItem(key) === 'dismissed' || document.getElementById('personalSchedulePopup')) return false;
  const schedules = personalScheduleItems();
  document.body.insertAdjacentHTML('beforeend', `<div id="personalSchedulePopup" class="modal-backdrop personal-schedule-backdrop" role="dialog" aria-modal="true" aria-labelledby="personalSchedulePopupTitle">
    <section class="personal-schedule-modal">
      <button class="personal-schedule-close" type="button" onclick="closePersonalSchedulePopup()" aria-label="내 일정 창 닫기">×</button>
      <header class="personal-schedule-modal-head">
        <div><p class="eyebrow">TODAY'S PERSONAL SCHEDULE</p><h2 id="personalSchedulePopupTitle">${esc(state.actor.name)} 선생님의 공개수업·참관 일정</h2><p>로그인한 계정의 2학기 일정만 모아 보여드립니다.</p></div>
        <strong>${schedules.openClasses.length + schedules.observations.length}건</strong>
      </header>
      ${renderPersonalSchedulePanels(schedules, true)}
      <footer class="personal-schedule-modal-footer"><p>창을 닫아도 대시보드 맨 위에서 언제든 다시 확인할 수 있습니다.</p><button class="button primary" type="button" onclick="closePersonalSchedulePopup()">확인하고 닫기</button></footer>
    </section>
  </div>`);
  document.querySelector('.personal-schedule-close')?.focus();
  return true;
}

function closePersonalSchedulePopup() {
  if (state && !state.actor.isAdmin) sessionStorage.setItem(personalSchedulePopupKey(), 'dismissed');
  document.getElementById('personalSchedulePopup')?.remove();
}

function renderDashboardStatusGroup(tone, title, description, cards) {
  const emptyMessage = tone === 'completed' ? '아직 완료된 항목이 없습니다.' : '현재 진행 중인 항목이 없습니다.';
  return `<section class="dashboard-status-group ${tone}" aria-label="${esc(title)}">
    <div class="dashboard-status-heading">
      <div><span>${tone === 'completed' ? '✓' : '●'}</span><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div></div>
      <b>${cards.length}</b>
    </div>
    <div class="dashboard-status-list">${cards.length ? cards.map(card => card.html).join('') : `<div class="dashboard-status-empty">${esc(emptyMessage)}</div>`}</div>
  </section>`;
}

function renderConfirmedOpenDashboardCard(cls) {
  const group = state.attendanceClasses.find(item => item.classInfo.id === cls.id);
  const observers = group ? group.observations : [];
  const enabled = isTabEnabled('open');
  return `<section class="dashboard-category confirmed-open-card">
    <div class="dashboard-category-head"><span class="dashboard-category-icon">▣</span><div><h3>공개수업</h3><span class="badge green compact-status">확정</span></div></div>
    <div class="confirmed-open-schedule"><strong>${fmtDate(cls.date)}</strong><span>${esc(cls.period)}교시 ${esc(periodTime(cls.period))}</span><b>${esc(cls.className)} · ${esc(displayRoom(cls.room))}</b></div>
    <div class="confirmed-observers"><div><strong>참관인 ${observers.length}/${cls.capacity}명</strong><span>${observers.length ? '신청한 선생님' : '아직 신청한 선생님이 없습니다.'}</span></div>${observers.length ? `<div class="observer-chips">${observers.map(obs => `<span>${esc(obs.observerName)}(${esc(obs.observerSubject || '교과 미분류')})</span>`).join('')}</div>` : ''}</div>
    <button class="button ${enabled ? 'primary' : ''} wide" onclick="go('open')">${enabled ? '공개수업 일정 확인' : '🔒 현재 단계에서는 열리지 않음'}</button>
  </section>`;
}

function dashboardActionButton(tab, label) {
  const enabled = isTabEnabled(tab);
  return `<button class="button ghost" onclick="go('${tab}')">${enabled ? '' : '🔒 '}${esc(label)}</button>`;
}

function dashboardCategoryCard(options) {
  const enabled = isTabEnabled(options.tab);
  const progress = options.progress;
  return `<section class="dashboard-category ${esc(options.tone || 'blue')}">
    <div class="dashboard-category-head"><span class="dashboard-category-icon">${options.icon}</span><div><h3>${esc(options.title)}</h3><strong>${esc(options.status)}</strong></div></div>
    <p>${esc(options.description)}</p>
    ${Number.isFinite(progress) ? `<div class="category-progress"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>` : ''}
    <div class="category-details">${(options.details || []).map(item => `<span>${esc(item)}</span>`).join('')}</div>
    <button class="button ${enabled ? 'primary' : ''} wide" onclick="go('${options.tab}')">${enabled ? esc(options.button) : '🔒 현재 단계에서는 열리지 않음'}</button>
  </section>`;
}

function statCard(label, value, note, filter = '') {
  const content = `<div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(String(value))}</div><div class="stat-note">${esc(note)}${filter ? ' · 눌러서 교사 보기' : ''}</div>`;
  return filter ? `<button type="button" class="stat-card stat-card-button" onclick="focusAdminStatus('${attr(filter)}')">${content}</button>` : `<div class="stat-card">${content}</div>`;
}

function renderOpenClass() {
  const tabs = [
    { key: 'application', icon: '▣', label: '신청·일정 확인' },
    { key: 'change', icon: '↻', label: '공개수업 일정 변경' }
  ];
  const changeOnly = isOpenApplicationClosed() && hasConfirmedOpenClass();
  return `${pageHead('OPEN CLASS', changeOnly ? '공개수업 일정 변경' : '공개수업 신청', changeOnly ? '신규 신청은 마감되었지만 확정된 공개수업 일정은 변경 요청할 수 있습니다.' : '공개수업 신청과 확정된 일정 변경을 한 화면에서 처리합니다.')}
    ${renderSectionTabs(tabs, openSubTab, 'setOpenSubTab')}
    ${openSubTab === 'change' ? renderChanges(true) : renderOpenClassApplication()}`;
}

function setOpenSubTab(tab) {
  openSubTab = tab === 'change' ? 'change' : 'application';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderOpenClassApplication() {
  const firstSemesterClasses = state.myOpenClasses.filter(item => item.semester === 1);
  const secondSemesterClasses = state.myOpenClasses.filter(item => item.semester === 2);
  const firstCompleted = firstSemesterClasses.some(item => item.status === '확정' && item.date <= today());
  const pending = secondSemesterClasses.find(item => item.status === '승인대기');
  const confirmed = secondSemesterClasses.find(item => item.status === '확정');
  const hasRegisteredTimetable = (state.myTimetable || []).length > 0 || (state.weeklyTimetable || []).length > 0;
  let form = '';
  if (!state.actor.isTarget) {
    form = firstCompleted
      ? `<div class="notice success"><span>✓</span><div><strong>1학기 공개수업을 완료했습니다.</strong><br>연간 공개수업 1회 요건을 충족하여 2학기 공개 대상에서 제외되었습니다.</div></div>`
      : `<div class="notice"><span>i</span><div><strong>2학기 수업공개 대상자가 아닙니다.</strong><br>${esc(state.actor.exclusionReason || '관리자가 대상 여부를 설정합니다.')}</div></div>`;
  } else if (confirmed) {
    form = `<div class="notice success"><span>✓</span><div><strong>관리자 승인이 완료되었습니다.</strong><br>확정된 공개수업 일정입니다.</div></div>`;
  } else if (!hasRegisteredTimetable) {
    form = renderManualOnlyOpenClassForm(pending);
  } else {
    form = renderOpenClassForm(pending);
  }
  return `${form}
    <h3 class="section-title">1학기 공개수업 실적</h3><div class="card">${firstSemesterClasses.length ? `<div class="lesson-list">${firstSemesterClasses.map(item => lessonCard(item, statusBadge(firstCompleted ? '공개수업 완료' : item.status), renderPresenterObserverContacts(item))).join('')}</div>` : empty('1학기 공개수업 실적이 없습니다.')}</div>
    <h3 class="section-title">2학기 공개수업 일정</h3><div class="card">${secondSemesterClasses.length ? `<div class="lesson-list">${secondSemesterClasses.map(item => lessonCard(item, statusBadge(item.status))).join('')}</div>` : empty('2학기 공개수업 신청 내역이 없습니다.')}</div>`;
}

function renderManualOnlyOpenClassForm(pending) {
  return `${pending ? '<div class="notice warning"><span>i</span><div><strong>현재 관리자 승인대기 중입니다.</strong><br>승인 전까지 아래 내용을 자유롭게 수정할 수 있습니다.</div></div>' : ''}
    <div class="notice info"><span>i</span><div><strong>등록된 컴시간 시간표가 없습니다.</strong><br>별도 시간표를 사용하는 경우 아래에서 공개수업 일정을 직접 등록해 주세요.</div></div>
    <div class="card"><div class="card-head"><div><h3>${pending ? '수동 신청 내용 수정' : '공개수업 수동 일정 등록'}</h3><p>날짜·교시·과목·학급·장소를 직접 입력하면 관리자 승인 후 확정됩니다.</p></div></div>
      ${renderManualOpenClassForm(pending, true)}
    </div>`;
}

function renderOpenClassForm(pending) {
  if (!openWeekStart) openWeekStart = mondayDateKey(pending && pending.date ? pending.date : today());
  const weeklyRows = Array.isArray(state.weeklyTimetable) ? state.weeklyTimetable : [];
  const selectedTimetable = pending
    ? weeklyRows.find(item => item.date === pending.date && Number(item.period) === Number(pending.period) && sameClassLabel(item.className, pending.className))
      || state.myTimetable.find(item => item.weekday === pending.weekday && Number(item.period) === Number(pending.period) && sameClassLabel(item.className, pending.className))
    : null;
  const selectedId = selectedTimetable ? selectedTimetable.id : '';
  const dateOptions = selectedTimetable
    ? (selectedTimetable.date
      ? `<option value="${attr(selectedTimetable.date)}" selected>${esc(fmtDate(selectedTimetable.date))}</option>`
      : renderOpenDateOptions(selectedTimetable, pending ? pending.date : ''))
    : '<option value="">수업을 먼저 선택해 주세요</option>';
  const selectedHelp = selectedTimetable
    ? `<strong>${selectedTimetable.date ? esc(fmtDate(selectedTimetable.date)) : esc(selectedTimetable.weekday + '요일')} ${esc(selectedTimetable.period)}교시 · ${esc(selectedTimetable.className)} · ${esc(selectedTimetable.subject || '과목 미입력')}</strong>을 선택했습니다.`
    : '주간 시간표에서 색이 있는 수업 칸을 눌러 주세요.';
  return `${pending ? '<div class="notice warning"><span>i</span><div><strong>현재 관리자 승인대기 중입니다.</strong><br>승인 전까지 아래 내용을 자유롭게 수정할 수 있습니다.</div></div>' : ''}
    <div class="card"><div class="card-head"><div><h3>${pending ? '공개수업 신청 내용 수정' : '공개수업 일정 신청'}</h3><p>시간표에서 수업을 선택하거나, 3~4주 뒤 변경수업은 직접 등록할 수 있습니다.</p></div><button class="button manual-open-button" type="button" onclick="openManualOpenClassForm()">＋ 시간표와 관계없이 직접 등록</button></div>
      <form onsubmit="submitOpenClass(event)"><div class="form-grid">
        <div class="field full"><label>1. 주간 시간표에서 공개할 수업 선택</label>${renderOpenWeeklyTimetablePicker(selectedId)}<input id="openTimetable" type="hidden" value="${attr(selectedId)}"><div id="openTimetableHelp" class="help">${selectedHelp}</div></div>
        <div class="field"><label for="openDate">2. 진행 날짜 선택</label><select id="openDate" required ${selectedTimetable ? '' : 'disabled'}>${dateOptions}</select><div class="help">같은 요일만 표시되며, 회색 날짜는 학사일정 때문에 선택할 수 없습니다.</div></div>
        <div class="field"><label for="openRoom">수업 장소 <span class="auto-fill-label">시간표에서 자동 입력</span></label><input id="openRoom" value="${attr(pending ? pending.room : (selectedTimetable ? defaultRoomForTimetable(selectedTimetable) : ''))}" placeholder="예: 2-3 교실" required><div class="help">선택한 학급의 교실이 자동 입력됩니다. 음악실·체육관·특별실 등 실제 장소에 맞게 직접 변경할 수 있습니다.</div></div>
        <div class="field"><label for="openTopic">수업 주제·단원</label><input id="openTopic" value="${attr(pending ? pending.topic : '')}" placeholder="선택 입력"></div>
      </div><div class="actions"><button class="button primary" type="submit">${pending ? '변경 내용 저장' : '관리자 승인 요청'}</button></div></form>
      ${renderManualOpenClassForm(pending)}
    </div>`;
}

function renderManualOpenClassForm(pending, forceOpen = false) {
  const periodOptions = Array.from({ length: 7 }, (_, index) => index + 1).map(period => `<option value="${period}" ${Number(pending && pending.period) === period ? 'selected' : ''}>${period}교시</option>`).join('');
  const open = forceOpen || (pending && pending.source === '직접입력') ? 'open' : '';
  return `<details id="manualOpenClassForm" class="manual-open-form" ${open}><summary>수동 일정 등록 · 3~4주 뒤 일정 포함</summary><div class="notice info"><span>i</span><div><strong>내 시간표에 표시되지 않는 수업도 등록할 수 있습니다.</strong><br>날짜·교시·과목·학급·장소를 직접 입력해 주세요. 학사일정과 장소 중복을 검사한 뒤 관리자 승인으로 확정됩니다.</div></div>
    <form onsubmit="submitManualOpenClass(event)"><div class="form-grid">
      <div class="field"><label for="manualOpenDate">진행 날짜</label><input id="manualOpenDate" type="date" min="${attr(today())}" max="${openClassFinalDate()}" value="${attr(pending ? pending.date : '')}" required><div class="help">공개수업 일정은 ${finalDateLabel()}까지 등록할 수 있습니다.</div></div>
      <div class="field"><label for="manualOpenPeriod">교시</label><select id="manualOpenPeriod" required><option value="">교시 선택</option>${periodOptions}</select></div>
      <div class="field"><label for="manualOpenSubject">과목</label><input id="manualOpenSubject" value="${attr(pending ? pending.subject : (state.actor.subject || ''))}" required></div>
      <div class="field"><label for="manualOpenClassName">학급</label><input id="manualOpenClassName" value="${attr(pending ? pending.className : '')}" placeholder="예: 1-3" required></div>
      <div class="field"><label for="manualOpenRoom">수업 장소</label><input id="manualOpenRoom" value="${attr(pending ? pending.room : '')}" placeholder="예: 1-3 교실" required></div>
      <div class="field"><label for="manualOpenTopic">수업 주제·단원</label><input id="manualOpenTopic" value="${attr(pending ? pending.topic : '')}" placeholder="선택 입력"></div>
    </div><div class="actions"><button class="button" type="submit">${pending ? '직접 입력 내용으로 수정' : '직접 입력으로 승인 요청'}</button></div></form>
  </details>`;
}

function openManualOpenClassForm() {
  const details = document.getElementById('manualOpenClassForm');
  if (!details) return;
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => document.getElementById('manualOpenDate')?.focus(), 350);
}

async function submitManualOpenClass(event) {
  event.preventDefault();
  const manualDate = value('manualOpenDate');
  const manualPeriod = Number(value('manualOpenPeriod'));
  if (manualDate > openClassFinalDate()) return showToast(`공개수업 일정은 ${finalDateLabel()}까지 등록할 수 있습니다.`, true);
  const blockedReason = blockedReasonFor({ period: manualPeriod }, manualDate);
  if (blockedReason) return showToast(`${fmtDate(manualDate)} ${manualPeriod}교시는 ${blockedReason} 때문에 신청할 수 없습니다.`, true);
  await mutate('applyOpenClass', {
    manual: true,
    date: manualDate,
    period: manualPeriod,
    subject: value('manualOpenSubject'),
    className: value('manualOpenClassName'),
    room: value('manualOpenRoom'),
    topic: value('manualOpenTopic')
  }, { confirm: '시간표와 관계없이 입력한 일정으로 관리자 승인을 요청하시겠습니까?' });
}

async function submitOpenClass(event) {
  event.preventDefault();
  if (!value('openTimetable')) return showToast('내 시간표에서 공개할 수업을 먼저 선택해 주세요.', true);
  if (!value('openDate')) return showToast('공개수업 날짜를 선택해 주세요.', true);
  await mutate('applyOpenClass', { date: value('openDate'), timetableId: value('openTimetable'), room: value('openRoom'), topic: value('openTopic') });
}

function mondayDateKey(value) {
  const parts = String(value || today()).split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDateKey(value, days) {
  const parts = String(value).split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + Number(days || 0));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameClassLabel(left, right) {
  const normalize = value => {
    const text = String(value || '').trim();
    const match = text.match(/^(\d+)\s*학년\s*(\d+)\s*반/) || text.match(/^(\d+)\s*-\s*(\d+)/);
    return match ? `${Number(match[1])}-${Number(match[2])}` : text.replace(/\s/g, '');
  };
  return normalize(left) === normalize(right);
}

function changeOpenWeek(offset) {
  const nextWeekStart = shiftDateKey(openWeekStart || mondayDateKey(today()), Number(offset) * 7);
  if (nextWeekStart > mondayDateKey(openClassFinalDate())) return showToast(`공개수업 일정은 ${finalDateLabel()}까지 선택할 수 있습니다.`, true);
  openWeekStart = nextWeekStart;
  const selected = document.getElementById('openTimetable');
  if (selected) selected.value = '';
  render();
  document.querySelector('.open-week-picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function goCurrentOpenWeek() {
  openWeekStart = mondayDateKey(today());
  render();
  document.querySelector('.open-week-picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openWeekRows() {
  const start = openWeekStart || mondayDateKey(today());
  const actual = (state.weeklyTimetable || []).filter(item => item.weekStart === start && item.date <= openClassFinalDate());
  if (actual.length) return { rows: actual, actual: true };
  return {
    actual: false,
    rows: state.myTimetable.map(item => ({
      ...item,
      date: shiftDateKey(start, ['월','화','수','목','금'].indexOf(item.weekday)),
      weekStart: start,
      isModified: false,
      fallback: true
    })).filter(item => item.date >= start && item.date <= openClassFinalDate())
  };
}

function renderOpenWeeklyTimetablePicker(selectedId = '', selectHandler = 'selectOpenTimetable') {
  const start = openWeekStart || mondayDateKey(today());
  const end = shiftDateKey(start, 4);
  const week = openWeekRows();
  const weekdays = ['월', '화', '수', '목', '금'];
  const maxPeriod = Math.max(7, ...week.rows.map(item => Number(item.period) || 0));
  let cells = '<div class="timetable-corner">교시</div>' + weekdays.map((day, index) => {
    const date = shiftDateKey(start, index);
    return `<div class="timetable-day ${date > openClassFinalDate() ? 'disabled' : ''}"><strong>${day}</strong><small>${date > openClassFinalDate() ? '마감' : `${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`}</small></div>`;
  }).join('');
  for (let period = 1; period <= maxPeriod; period += 1) {
    cells += `<div class="timetable-period"><strong>${period}</strong><span>${periodTime(period)}</span></div>`;
    weekdays.forEach((day, index) => {
      const date = shiftDateKey(start, index);
      const lessons = date > openClassFinalDate() ? [] : week.rows.filter(item => item.date === date && Number(item.period) === period);
      cells += `<div class="timetable-cell">${lessons.length ? lessons.map(item => {
        const blockedReason = blockedReasonFor(item, date);
        const blocked = Boolean(blockedReason);
        return `<button type="button" class="timetable-slot ${item.id === selectedId ? 'selected' : ''} ${item.isModified ? 'modified' : ''} ${blocked ? 'blocked' : ''}" data-timetable-id="${attr(item.id)}" onclick="${selectHandler}('${attr(item.id)}','${attr(item.date)}')" ${blocked ? 'disabled' : ''} title="${blocked ? attr(blockedReason) : ''}"><strong>${esc(item.subject || '과목')}</strong><span>${esc(item.className)}</span>${item.isModified ? '<small>변경</small>' : ''}${blocked ? `<small>선택 불가 · ${esc(blockedReason)}</small>` : ''}</button>`;
      }).join('') : '<span class="timetable-dash">-</span>'}</div>`;
    });
  }
  return `<div class="open-week-picker">
    <div class="open-week-nav"><button type="button" class="button subtle small" onclick="changeOpenWeek(-1)">‹ 이전 주</button><div><strong>${fmtDate(start)} ~ ${fmtDate(end)}</strong><span class="badge ${week.actual ? 'green' : 'blue'}">${week.actual ? '컴시간 주간 변경 반영' : '기본시간표 기준'}</span></div><button type="button" class="button subtle small" onclick="changeOpenWeek(1)" ${start >= mondayDateKey(openClassFinalDate()) ? 'disabled' : ''}>다음 주 ›</button></div>
    <div class="open-week-today"><button type="button" onclick="goCurrentOpenWeek()">이번 주로 이동</button><span>${week.actual ? '컴시간의 변경·교환수업이 반영된 주간 자료입니다.' : '이 주의 변경자료가 없어 기본시간표를 표시합니다.'}</span></div>
    <div class="teacher-timetable-scroll"><div class="teacher-timetable-grid">${cells}</div></div>
  </div>`;
}

function renderTeacherTimetablePicker(selectedId = '', selectHandler = 'selectOpenTimetable') {
  const weekdays = ['월', '화', '수', '목', '금'];
  const maxPeriod = Math.max(7, ...state.myTimetable.map(item => Number(item.period) || 0));
  let cells = `<div class="timetable-corner">교시</div>${weekdays.map(day => `<div class="timetable-day">${day}</div>`).join('')}`;
  for (let period = 1; period <= maxPeriod; period += 1) {
    cells += `<div class="timetable-period"><strong>${period}</strong><span>${periodTime(period)}</span></div>`;
    weekdays.forEach(day => {
      const lessons = state.myTimetable.filter(item => item.weekday === day && Number(item.period) === period);
      cells += `<div class="timetable-cell">${lessons.length ? lessons.map(item => `<button type="button" class="timetable-slot ${item.id === selectedId ? 'selected' : ''}" data-timetable-id="${attr(item.id)}" onclick="${selectHandler}('${attr(item.id)}')"><strong>${esc(item.subject || '과목')}</strong><span>${esc(item.className)}</span></button>`).join('') : '<span class="timetable-dash">-</span>'}</div>`;
    });
  }
  return `<div class="teacher-timetable-scroll"><div class="teacher-timetable-grid">${cells}</div></div>`;
}

function selectOpenTimetable(timetableId, lessonDate = '') {
  const item = (state.weeklyTimetable || []).find(row => row.id === timetableId)
    || openWeekRows().rows.find(row => row.id === timetableId && (!lessonDate || row.date === lessonDate))
    || state.myTimetable.find(row => row.id === timetableId);
  if (!item) return;
  const selectedDate = lessonDate || item.date || '';
  const blockedReason = selectedDate ? blockedReasonFor(item, selectedDate) : '';
  if (blockedReason) return showToast(`${fmtDate(selectedDate)} ${item.period}교시는 ${blockedReason} 때문에 신청할 수 없습니다.`, true);
  document.getElementById('openTimetable').value = item.id;
  document.querySelectorAll('.timetable-slot').forEach(button => button.classList.toggle('selected', button.dataset.timetableId === item.id));
  const room = document.getElementById('openRoom');
  if (room) room.value = defaultRoomForTimetable(item);
  const dateSelect = document.getElementById('openDate');
  dateSelect.innerHTML = selectedDate
    ? `<option value="${attr(selectedDate)}" selected>${esc(fmtDate(selectedDate))}</option>`
    : renderOpenDateOptions(item);
  dateSelect.disabled = false;
  const help = document.getElementById('openTimetableHelp');
  if (help) help.innerHTML = `<strong>${selectedDate ? esc(fmtDate(selectedDate)) : esc(item.weekday + '요일')} ${esc(item.period)}교시 · ${esc(item.className)} · ${esc(item.subject || '과목 미입력')}</strong>을 선택했습니다.`;
}

function defaultRoomForTimetable(item) {
  const room = String(item && item.room ? item.room : '').trim();
  const className = String(item && item.className ? item.className : '').trim();
  const candidate = room || className;
  const dashed = candidate.match(/^(\d+)\s*-\s*(\d+)(?:\s*교실)?$/);
  const korean = candidate.match(/^(\d+)\s*학년\s*(\d+)\s*반(?:\s*교실)?$/);
  const match = dashed || korean;
  return match ? `${Number(match[1])}-${Number(match[2])} 교실` : candidate;
}

function renderOpenDateOptions(timetable, selectedDate = '') {
  const dates = matchingWeekdayDates(timetable.weekday, 18);
  if (selectedDate && !dates.includes(selectedDate)) dates.push(selectedDate);
  dates.sort();
  return `<option value="">${esc(timetable.weekday)}요일 날짜를 선택해 주세요</option>${dates.map(date => {
    const reason = blockedReasonFor(timetable, date);
    const disabled = reason ? 'disabled class="blocked-date-option"' : '';
    const selected = date === selectedDate ? 'selected' : '';
    const label = `${fmtDate(date)}${reason ? ` (${reason})` : ''}`;
    return `<option value="${attr(date)}" ${disabled} ${selected}>${esc(label)}</option>`;
  }).join('')}`;
}

function blockedReasonFor(timetable, date) {
  const reasons = (state.blockedDates || [])
    .filter(item => item.date === date && (item.period === null || Number(item.period) === Number(timetable.period)))
    .map(item => item.reason || '신청 불가');
  return [...new Set(reasons)].join('·');
}

function weekdayFromDate(dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  return ['일', '월', '화', '수', '목', '금', '토'][date.getDay()] || '';
}

function matchingWeekdayDates(targetWeekday, limit) {
  const dates = [];
  const cursor = new Date(`${today()}T12:00:00`);
  for (let offset = 0; offset <= 180 && dates.length < limit; offset += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + offset);
    const dateText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (dateText > openClassFinalDate()) break;
    if (weekdayFromDate(dateText) === targetWeekday) dates.push(dateText);
  }
  return dates;
}

function periodTime(period) {
  return ({ 1: '09:05–09:50', 2: '10:00–10:45', 3: '10:55–11:40', 4: '11:50–12:35', 5: '13:40–14:25', 6: '14:35–15:20', 7: '15:30–16:15' })[Number(period)] || '';
}

function renderObservations() {
  const tabs = [
    { key: 'application', icon: '◎', label: '참관 신청·현황' },
    { key: 'change', icon: '↻', label: '참관 일정 변경' }
  ];
  return `${pageHead('OBSERVATION', '참관 신청', '참관 신청과 기존 참관 일정 변경을 한 화면에서 처리합니다.')}
    ${renderSectionTabs(tabs, observationSubTab, 'setObservationSubTab')}
    ${observationSubTab === 'change' ? renderObservationChangePanel() : renderObservationApplication()}`;
}

function setObservationSubTab(tab) {
  observationSubTab = tab === 'change' ? 'change' : 'application';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderObservationApplication() {
  const annualCompleted = state.dashboard.annual.observationCompleted;
  const secondActiveCount = state.myObservations.filter(item => item.semester === 2 && item.status === '확정').length;
  const orderedAvailableClasses = sortObservationChoices(state.availableClasses || []);
  const observationExempt = state.dashboard?.observationApplicationStatus?.excludedByTeacherSetting === true;
  const observationStatusNotice = observationExempt
    ? `<div class="notice success"><span>✓</span><div><strong>순회교사로 2학기 참관 신청 대상에서 제외되었습니다.</strong><br><span class="muted">필수 신청 및 미신청 알림 대상에는 포함되지 않습니다. 필요한 경우 아래 목록에서 자율적으로 참관 신청할 수 있습니다.</span></div></div>`
    : `<div class="notice ${annualCompleted >= 2 ? 'success' : ''}"><span>${annualCompleted >= 2 ? '✓' : 'i'}</span><div>연간 실제 참관은 <strong>${annualCompleted}회</strong>입니다. ${annualCompleted >= 2 ? '<strong>참관 완료</strong> 상태입니다.' : `앞으로 ${2 - annualCompleted}회가 더 필요합니다.`}<br><span class="muted">2학기 확정 신청 ${secondActiveCount}회 · 수업당 정원 ${state.config.capacity}명 · 대기 신청 없음</span></div></div>`;
  return `${observationStatusNotice}
    <div class="card"><div class="card-head"><div><h3>신청 가능한 공개수업</h3><p>동일 교과·교과군 다음으로 참관 2명 미만 수업을 우선 표시하며, 정원이 차면 즉시 마감됩니다.</p></div><span class="badge blue">${orderedAvailableClasses.length}개 가능</span></div>
      <div class="observation-match-legend" aria-label="우선 표시 안내"><span class="observation-match-key exact">동일 교과</span><span class="observation-match-key group">동일 교과군</span><span class="observation-match-key shortage">참관 2명 미만</span></div>
      ${orderedAvailableClasses.length ? `<div class="lesson-list">${orderedAvailableClasses.map(item => observationChoice(item, false)).join('')}</div><div class="actions"><button class="button primary" onclick="applySelectedObservations()">선택한 수업 신청</button></div>` : empty('현재 신청 가능한 공개수업이 없습니다.')}</div>
    <div class="card schedule-conflict-card"><div class="card-head"><div><h3>시간표 변경 후 신청 가능한 공개수업</h3><p>현재 내 수업과 겹치지만, 시간표를 조정할 수 있다면 참관 신청할 수 있습니다.</p></div><span class="badge amber">${(state.scheduleConflictClasses || []).length}개</span></div>
      <div class="notice warning"><span>!</span><div>이 목록의 수업을 신청하면 현재 수업시간과 겹칩니다. 실제 참관 전 반드시 시간표 변경을 완료해 주세요.</div></div>
      ${(state.scheduleConflictClasses || []).length ? `<div class="lesson-list">${state.scheduleConflictClasses.map(item => observationChoice(item, true)).join('')}</div><div class="actions"><button class="button warning-button" onclick="applySelectedObservations()">선택한 충돌 수업도 신청</button></div>` : empty('현재 시간표와 겹쳐 별도 표시할 공개수업이 없습니다.')}</div>
    <h3 class="section-title">1학기 참관 실적</h3><div class="card">${renderMyObservationTable(1)}</div>
    <h3 class="section-title">2학기 참관 신청</h3><div class="card">${renderMyObservationTable(2)}</div>`;
}

function renderObservationChangePanel() {
  const changeable = state.myObservations
    .filter(item => item.semester === 2 && item.status === '확정' && item.attendance !== '참석' && item.date >= today())
    .sort((left, right) => left.date.localeCompare(right.date) || Number(left.period) - Number(right.period));
  return `<div class="notice"><span>i</span><div><strong>참관 일정은 기존 신청을 취소한 뒤 새 수업을 선택하여 변경합니다.</strong><br>수업이 지난 뒤이거나 실제 참석으로 확인된 일정은 변경할 수 없습니다.</div></div>
    <section class="card"><div class="card-head"><div><h3>변경 가능한 참관 일정</h3><p>취소하면 해당 수업의 자리가 즉시 다시 열립니다.</p></div><span class="badge blue">${changeable.length}건</span></div>
      ${changeable.length ? `<div class="lesson-list">${changeable.map(item => lessonCard(item, `<button class="button danger small" onclick="cancelObservation('${attr(item.id)}')">이 일정 취소</button>`)).join('')}</div>` : empty('현재 변경할 수 있는 참관 일정이 없습니다.')}
      <div class="actions"><button class="button primary" onclick="setObservationSubTab('application')">새 참관 일정 선택</button></div></section>`;
}

function observationSubjectKey(value) {
  return String(value || '').trim().toLocaleLowerCase('ko-KR').replace(/[\s·ㆍ_-]+/g, '');
}

function observationSubjectMatchType(item) {
  const classSubject = observationSubjectKey(item.subject);
  const actorGroup = observationSubjectKey(state.actor?.subject);
  const classGroup = observationSubjectKey(item.subjectGroup);
  const mySubjectKeys = new Set([
    ...(state.myTimetable || []).map(row => observationSubjectKey(row.subject)),
    ...(state.weeklyTimetable || []).map(row => observationSubjectKey(row.subject))
  ].filter(Boolean));
  if (classSubject && mySubjectKeys.has(classSubject)) return 'exact';
  if (actorGroup && (classGroup === actorGroup || classSubject === actorGroup)) return 'group';
  return '';
}

function observationPriority(item) {
  const matchType = observationSubjectMatchType(item);
  if (matchType === 'exact') return 0;
  if (matchType === 'group') return 1;
  if (Number(item.observerCount || 0) < 2) return 2;
  return 3;
}

function sortObservationChoices(items) {
  return [...items].sort((left, right) =>
    observationPriority(left) - observationPriority(right)
    || Number(left.observerCount || 0) - Number(right.observerCount || 0)
    || String(left.date || '').localeCompare(String(right.date || ''))
    || Number(left.period || 0) - Number(right.period || 0)
    || String(left.teacherName || '').localeCompare(String(right.teacherName || ''), 'ko-KR')
  );
}

function observationChoice(item, scheduleConflict = false) {
  const selected = selectedObservationIds.has(item.id);
  const matchType = observationSubjectMatchType(item);
  const shortagePriority = !scheduleConflict && !matchType && Number(item.observerCount || 0) < 2;
  const matchLabel = matchType === 'exact' ? '동일 교과' : (matchType === 'group' ? '동일 교과군' : (shortagePriority ? '참관인원 미달' : ''));
  const priorityClass = matchType ? `subject-match-${matchType}` : (shortagePriority ? 'observer-shortage-priority' : '');
  const labelClass = matchType || (shortagePriority ? 'shortage' : '');
  return `<div class="lesson-card selectable ${scheduleConflict ? 'schedule-conflict' : ''} ${priorityClass} ${selected ? 'selected' : ''}" onclick="toggleObservation('${attr(item.id)}')">
    <div class="lesson-top"><div class="check-wrap"><input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation();toggleObservation('${attr(item.id)}')"><div><div class="lesson-heading-row"><h4 class="lesson-title">${esc(item.teacherName)} 선생님 · ${esc(item.subject || '과목 미입력')}</h4>${matchLabel ? `<span class="subject-match-label ${labelClass}">${matchLabel}</span>` : ''}${scheduleConflict ? '<span class="subject-match-label conflict">시간표 변경 필요</span>' : ''}</div><div class="lesson-meta"><span>${fmtDate(item.date)} ${esc(item.period)}교시</span><span>${esc(item.className)}</span><span>${esc(displayRoom(item.room))}</span></div></div></div><span class="badge ${item.remaining === 1 ? 'amber' : 'green'}">${item.observerCount}/${item.capacity}명</span></div>
    ${item.topic ? `<p class="lesson-topic">${esc(item.topic)}</p>` : ''}</div>`;
}

function toggleObservation(id) {
  if (selectedObservationIds.has(id)) selectedObservationIds.delete(id); else selectedObservationIds.add(id);
  render();
}

async function applySelectedObservations() {
  const ids = [...selectedObservationIds];
  if (!ids.length) return showToast('참관할 수업을 선택해 주세요.', true);
  const conflictIdSet = new Set((state.scheduleConflictClasses || []).map(item => item.id));
  const allowScheduleConflictIds = ids.filter(id => conflictIdSet.has(id));
  const confirm = allowScheduleConflictIds.length
    ? '수업시간과 겹쳐 시간표 변경이 필요합니다. 참관신청 하시겠습니까?'
    : `${ids.length}개의 수업을 참관 신청하시겠습니까?`;
  await mutate('applyObservations', { classIds: ids, allowScheduleConflictIds }, { clearSelections: true, confirm });
}

function renderMyObservationTable(semester) {
  const observations = state.myObservations.filter(item => item.semester === semester);
  if (!observations.length) return empty(`${semester}학기 참관 내역이 없습니다.`);
  return `<div class="table-wrap"><table><thead><tr><th>일정</th><th>공개 교사</th><th>장소</th><th>신청 상태</th><th>실제 참관</th></tr></thead><tbody>${observations.map(item => `<tr><td class="nowrap">${fmtDate(item.date)} ${esc(item.period)}교시</td><td>${esc(item.teacherName)}</td><td>${esc(displayRoom(item.room))}</td><td>${semester === 1 ? statusBadge('실적 반영') : statusBadge(item.status)}</td><td>${statusBadge(item.attendance)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function cancelObservation(id) {
  await mutate('cancelObservation', { observationId: id }, { confirm: '공개수업 진행 교사에게 통지하였나요?\n\n확인을 누르면 이 참관 일정이 취소되며, 취소 후 참관 2회 조건을 다시 충족해야 합니다.' });
}

function renderOperation() {
  if (!state.attendanceClasses.length && state.documentTasks.length) operationSubTab = 'documents';
  const tabs = [
    { key: 'attendance', icon: '✓', label: '참관 확인' },
    { key: 'documents', icon: '▤', label: '자료 제출' }
  ];
  return `${pageHead('OPEN CLASS OPERATION', '공개수업 운영', '수업 후 참관 여부 확인과 자료 제출을 한곳에서 처리합니다.')}
    ${renderTemplateLibrary()}
    ${renderOperationChecklist()}
    ${renderSectionTabs(tabs, operationSubTab, 'setOperationSubTab')}
    ${operationSubTab === 'documents' ? renderDocuments(true) : renderAttendance(true)}`;
}

function renderOperationChecklist() {
  const classes = state.attendanceClasses || [];
  const tasks = state.documentTasks || [];
  const hasConfirmedClass = classes.length > 0 || tasks.length > 0;
  const pastClasses = classes.filter(group => group.classInfo.date <= today());
  const attendanceDone = pastClasses.length > 0 && pastClasses.every(group => group.observations.length > 0 && group.observations.every(item => ['참석', '불참'].includes(item.attendance)));
  const typeProgress = type => {
    const typeTasks = tasks.filter(item => item.type === type);
    return { ready: typeTasks.length > 0, done: typeTasks.length > 0 && typeTasks.every(item => Boolean(item.status)) };
  };
  const lessonPlan = typeProgress('지도안');
  const conference = typeProgress('협의록');
  const observation = typeProgress('참관록');
  const stepData = [
    { label: '참관 확인', done: attendanceDone, ready: pastClasses.length > 0, tab: 'attendance' },
    { label: '수업 지도안', ...lessonPlan, tab: 'documents' },
    { label: '수업나눔 협의록', ...conference, tab: 'documents' },
    { label: '참관록', ...observation, tab: 'documents' }
  ];
  return `<section class="operation-checklist"><div><p class="eyebrow">수업 후 할 일</p><h3>${hasConfirmedClass ? '확인과 제출을 순서대로 마무리해 주세요.' : '공개수업 일정 확정 후 할 일이 표시됩니다.'}</h3></div><div class="operation-checklist-steps">${stepData.map((step, index) => `<button type="button" class="operation-step ${step.done ? 'done' : step.ready ? 'ready' : ''}" onclick="setOperationSubTab('${attr(step.tab)}')"><span>${step.done ? '✓' : index + 1}</span><strong>${esc(step.label)}</strong><small>${step.done ? '완료' : step.ready ? '처리 필요' : '대기'}</small></button>`).join('')}</div></section>`;
}

function renderTemplateLibrary() {
  const files = state.templateLibrary || [];
  const items = ADMIN_DOCUMENT_TYPES.map(type => {
    const file = files.find(item => item.type === type);
    return `<article class="template-download-card"><div class="template-icon">${type === '지도안' ? '1' : type === '협의록' ? '2' : '3'}</div><div><strong>${esc(documentTypeLabel(type))} 양식</strong><small>${file ? `${esc(file.fileName)}${file.uploadedAt ? ` · ${esc(file.uploadedAt)} 등록` : ''}` : '관리자가 양식을 준비 중입니다.'}</small></div>${file?.fileUrl ? `<a class="button small" href="${attr(file.fileUrl)}">양식 내려받기</a>` : '<span class="badge">준비 중</span>'}</article>`;
  }).join('');
  return `<section class="template-library"><div class="template-library-head"><div><p class="eyebrow">공용 양식 자료실</p><h3>작성 전에 필요한 양식을 내려받으세요.</h3></div><span class="badge blue">공개수업 운영에서 항상 이용 가능</span></div><div class="template-download-grid">${items}</div></section>`;
}

function setOperationSubTab(tab) {
  operationSubTab = tab === 'documents' ? 'documents' : 'attendance';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAttendance(embedded = false) {
  return `${embedded ? '' : pageHead('ATTENDANCE', '참관 여부 확인', '자신이 공개한 수업의 실제 참관 여부를 확인합니다.')}
    <div class="notice warning"><span>!</span><div><strong>수업을 진행한 선생님이 직접 확인합니다.</strong><br>실제로 참관한 선생님은 ‘참석’, 신청했지만 오지 않은 선생님은 ‘불참’으로 선택해 주세요.</div></div>
    ${state.attendanceClasses.length ? state.attendanceClasses.map(renderAttendanceClass).join('') : `<div class="card">${empty('확정된 공개수업이 없습니다.')}</div>`}`;
}

function renderAttendanceClass(group) {
  const cls = group.classInfo;
  const future = cls.date > today();
  const checkedCount = group.observations.filter(obs => ['참석', '불참'].includes(obs.attendance)).length;
  const presentCount = group.observations.filter(obs => obs.attendance === '참석').length;
  const complete = group.observations.length > 0 && checkedCount === group.observations.length;
  return `<div class="card attendance-card"><div class="card-head"><div><h3>${fmtDate(cls.date)} ${esc(cls.period)}교시 수업</h3><p>${esc(cls.className)} · ${esc(displayRoom(cls.room))} · 신청자 ${group.observations.length}명</p></div>${future ? '<span class="badge blue">수업 전</span>' : statusBadge(complete ? '확인 완료' : '확인 필요')}</div>
    ${group.observations.length ? `
      <div class="attendance-overview">
        <div><strong id="attendanceProgress_${attr(cls.id)}">${checkedCount}/${group.observations.length}명 선택</strong><span>현재 참석 ${presentCount}명</span></div>
        <div class="actions"><button class="button small" ${future ? 'disabled' : ''} onclick="setAllAttendance('${attr(cls.id)}','참석')">모두 참석</button><button class="button small" ${future ? 'disabled' : ''} onclick="setAllAttendance('${attr(cls.id)}','')">선택 지우기</button></div>
      </div>
      <div class="attendance-list">${group.observations.map(obs => `<div class="attendance-person"><div><strong>${esc(obs.observerName)}(${esc(obs.observerSubject || '교과 미분류')}) 선생님</strong><small>${obs.attendanceCheckedAt ? `마지막 확인 ${esc(obs.attendanceCheckedAt)}` : '아직 확인하지 않음'}</small></div><div class="attendance-choice">
        <label><input type="radio" name="att_${attr(obs.id)}" value="참석" ${obs.attendance === '참석' ? 'checked' : ''} ${future ? 'disabled' : ''} onchange="updateAttendanceProgress('${attr(cls.id)}')"><span>✓ 참석</span></label>
        <label><input type="radio" name="att_${attr(obs.id)}" value="불참" ${obs.attendance === '불참' ? 'checked' : ''} ${future ? 'disabled' : ''} onchange="updateAttendanceProgress('${attr(cls.id)}')"><span>✕ 불참</span></label>
      </div></div>`).join('')}</div>
      <div class="attendance-save"><p>모든 참관 교사를 선택한 후 한 번에 저장해 주세요.</p><button class="button success" ${future ? 'disabled' : ''} onclick="saveAttendance('${attr(cls.id)}')">참관 여부 저장하기</button></div>` : empty('이 수업에 신청한 참관 교사가 없습니다.')}</div>`;
}

function setAllAttendance(classId, attendance) {
  const group = state.attendanceClasses.find(item => item.classInfo.id === classId);
  if (!group) return;
  group.observations.forEach(observation => {
    const radios = document.querySelectorAll(`input[name="att_${cssEscape(observation.id)}"]`);
    radios.forEach(radio => { radio.checked = attendance ? radio.value === attendance : false; });
  });
  updateAttendanceProgress(classId);
}

function updateAttendanceProgress(classId) {
  const group = state.attendanceClasses.find(item => item.classInfo.id === classId);
  const element = document.getElementById(`attendanceProgress_${classId}`);
  if (!group || !element) return;
  const checked = group.observations.filter(observation => document.querySelector(`input[name="att_${cssEscape(observation.id)}"]:checked`)).length;
  element.textContent = `${checked}/${group.observations.length}명 선택`;
}

async function saveAttendance(classId) {
  const group = state.attendanceClasses.find(item => item.classInfo.id === classId);
  const records = [];
  for (const observation of group.observations) {
    const checked = document.querySelector(`input[name="att_${cssEscape(observation.id)}"]:checked`);
    if (!checked) return showToast(`${observation.observerName} 선생님의 참석·불참을 선택해 주세요.`, true);
    records.push({ observationId: observation.id, attendance: checked.value });
  }
  await mutate('confirmAttendance', { classId, records }, { confirm: '선택한 실제 참관 여부를 저장하시겠습니까?' });
}

function renderDocuments(embedded = false) {
  const typeTabs = [
    { key: 'lessonPlan', icon: '1', label: '수업 지도안' },
    { key: 'conference', icon: '2', label: '수업나눔 협의록' },
    { key: 'observation', icon: '3', label: '참관록' }
  ];
  if (!typeTabs.some(tab => tab.key === documentTypeSubTab)) documentTypeSubTab = 'lessonPlan';
  const internalType = ({ lessonPlan: '지도안', conference: '협의록', observation: '참관록' })[documentTypeSubTab] || '지도안';
  const tasks = state.documentTasks
    .filter(task => task.type === internalType)
    .sort((left, right) => left.classInfo.date.localeCompare(right.classInfo.date) || Number(left.classInfo.period) - Number(right.classInfo.period));
  if (tasks.length && !tasks.some(task => task.classId === selectedDocumentClassId)) selectedDocumentClassId = tasks[0].classId;
  const selected = tasks.find(task => task.classId === selectedDocumentClassId) || tasks[0];
  const label = documentTypeLabel(internalType);
  const description = internalType === '지도안'
    ? '공개수업에서 사용할 수업 설계와 활동 내용을 담은 지도안 파일입니다.'
    : internalType === '협의록'
      ? '공개수업 후 나눈 의견과 협의 내용을 정리한 협의록 파일입니다.'
      : '공개수업 진행 교사가 참관 내용을 확인하고 정리하여 제출하는 참관록 파일입니다.';
  const unavailable = `본인의 1·2학기 공개수업 일정이 등록되면 ${label}을 온라인 또는 수기로 제출할 수 있습니다.`;
  return `${embedded ? '' : pageHead('DOCUMENTS', '자료 제출', '1·2학기 공개수업 일정을 선택한 뒤 해당 수업의 자료를 제출합니다.')}
    <div class="notice"><span>i</span><div>온라인 파일은 PDF, HWP, HWPX, DOC, DOCX 형식과 ${state.config.maxFileMb}MB 이하를 지원합니다. 수기 제출은 관리자 확인 후 완료됩니다.</div></div>
    <div class="document-type-heading"><div><p class="eyebrow">제출 자료 구분</p><h3>제출할 파일 종류를 먼저 선택해 주세요.</h3></div><span class="badge blue">각 파일 별도 저장</span></div>
    ${renderSectionTabs(typeTabs, documentTypeSubTab, 'setDocumentTypeSubTab')}
    <section class="card selected-document-class"><div class="card-head"><div><p class="eyebrow">PRESENTER DOCUMENT</p><h3>${esc(label)}</h3><p>${esc(description)}</p></div>${selected && selected.status ? statusBadge(selected.status) : '<span class="badge red">미제출</span>'}</div>
      ${tasks.length > 1 ? `<div class="field document-schedule-field"><label for="documentClass">자료가 연결되는 공개수업 일정</label><select id="documentClass" onchange="selectDocumentClass(this.value)">${tasks.map(task => `<option value="${attr(task.classId)}" ${task.classId === selected.classId ? 'selected' : ''}>${esc(task.classInfo.semester)}학기 · ${fmtDate(task.classInfo.date)} ${esc(task.classInfo.period)}교시 · ${esc(task.classInfo.teacherName)}</option>`).join('')}</select></div>` : ''}
      ${selected ? `<div class="document-linked-class"><strong><span class="badge blue">${esc(selected.classInfo.semester)}학기</span> ${fmtDate(selected.classInfo.date)} ${esc(selected.classInfo.period)}교시 · ${esc(selected.classInfo.className)}</strong><span>${esc(selected.classInfo.teacherName)} 선생님 수업 · ${esc(displayRoom(selected.classInfo.room))}</span></div>${renderDocumentTask(selected, true)}` : renderUnavailableDocumentSubmission(unavailable)}
    </section>`;
}

function renderUnavailableDocumentSubmission(message) {
  return `<div class="document-submission-unavailable">
    ${empty(message)}
    <div class="document-method-preview" aria-label="자료 제출 방법">
      <div><strong>온라인 제출</strong><span>파일을 선택해 바로 제출합니다.</span><button class="button primary" type="button" disabled>온라인 제출</button></div>
      <div><strong>수기 제출</strong><span>종이로 제출할 예정임을 등록한 뒤 관리자가 수령 확인합니다.</span><button class="button" type="button" disabled>수기 제출 예정</button></div>
    </div>
    <p class="document-enable-help">공개수업 일정이 확정되면 위 버튼이 활성화됩니다.</p>
  </div>`;
}

function setDocumentTypeSubTab(tab) {
  documentTypeSubTab = ['lessonPlan', 'conference', 'observation'].includes(tab) ? tab : 'lessonPlan';
  selectedDocumentClassId = '';
  render();
}

function selectDocumentClass(classId) {
  selectedDocumentClassId = classId;
  render();
}

function renderDocumentTask(task, compact = false) {
  const label = documentTypeLabel(task.type);
  return `<article class="document-task ${compact ? 'compact' : ''}">${compact ? '' : `<div class="card-head"><div><h3>${esc(label)}</h3><p>수업 진행자로서 ${esc(label)} 파일을 별도로 제출합니다.</p></div>${task.status ? statusBadge(task.status) : '<span class="badge red">미제출</span>'}</div>`}
    ${task.fileName ? `<p class="muted">최근 파일: ${task.fileUrl ? `<a href="${attr(task.fileUrl)}" target="_blank" rel="noopener">${esc(task.fileName)}</a>` : esc(task.fileName)} · ${esc(task.submittedAt)}</p>` : ''}
    <div class="file-row"><div class="field"><label for="file_${attr(task.taskKey)}">온라인 파일 선택</label><input id="file_${attr(task.taskKey)}" type="file" accept=".pdf,.hwp,.hwpx,.doc,.docx"></div><button class="button primary" onclick="submitFile('${attr(task.taskKey)}')">온라인 제출</button><button class="button" onclick="submitPaper('${attr(task.taskKey)}')">수기 제출 예정</button></div></article>`;
}

async function submitFile(taskKey) {
  const task = state.documentTasks.find(item => item.taskKey === taskKey);
  const input = document.getElementById(`file_${taskKey}`);
  const file = input && input.files ? input.files[0] : null;
  if (!file) return showToast('제출할 파일을 선택해 주세요.', true);
  if (file.size > state.config.maxFileMb * 1024 * 1024) return showToast(`파일은 ${state.config.maxFileMb}MB 이하만 제출할 수 있습니다.`, true);
  const dataUrl = await readFileAsDataUrl(file);
  await mutate('submitDocument', { classId: task.classId, type: task.type, method: '온라인', file: { name: file.name, mimeType: file.type, base64: dataUrl.split(',')[1] } }, { confirm: `${documentTypeLabel(task.type)} 파일을 제출하시겠습니까?` });
}

async function submitPaper(taskKey) {
  const task = state.documentTasks.find(item => item.taskKey === taskKey);
  await mutate('submitDocument', { classId: task.classId, type: task.type, method: '수기' }, { confirm: `${documentTypeLabel(task.type)}을 수기로 제출할 예정으로 등록하시겠습니까?` });
}

function documentTypeLabel(type) {
  return ({ 지도안: '수업 지도안', 협의록: '수업나눔 협의록', 참관록: '참관록' })[type] || type;
}

function renderChanges(embedded = false) {
  const classes = state.myOpenClasses.filter(item => item.semester === 2 && item.status === '확정');
  const hasTimetable = (state.myTimetable || []).length > 0 || (state.weeklyTimetable || []).length > 0;
  return `${embedded ? '' : pageHead('CHANGE REQUEST', '일정 변경 신청', '확정된 공개수업의 일정을 관리자에게 변경 요청합니다.')}
    ${classes.length ? `<div class="card"><div class="card-head"><div><h3>변경 신청</h3><p>주간 시간표에서 새 수업을 선택하거나, 시간표 반영이 늦은 일정은 직접 입력할 수 있습니다.</p></div><button class="button manual-open-button" type="button" onclick="openManualChangeForm()">＋ 시간표와 관계없이 직접 변경</button></div>
      ${hasTimetable ? `<form onsubmit="submitChange(event)"><div class="form-grid">
        <div class="field full"><label for="changeClass">1. 변경할 공개수업</label><select id="changeClass" required><option value="">기존 일정을 선택해 주세요</option>${classes.map(item => `<option value="${attr(item.id)}">${fmtDate(item.date)} ${esc(item.period)}교시 · ${esc(item.className)} · ${esc(displayRoom(item.room))}</option>`).join('')}</select></div>
        <div class="field full"><label>2. 주간 시간표에서 새 수업 선택</label>${renderOpenWeeklyTimetablePicker('', 'selectChangeTimetable')}<input id="changeTimetable" type="hidden"><div id="changeTimetableHelp" class="help">색이 있는 수업 칸을 눌러 주세요.</div></div>
        <div class="field"><label for="changeDate">3. 희망 날짜 선택</label><select id="changeDate" required disabled><option value="">수업을 먼저 선택해 주세요</option></select><div class="help">${finalDateLabel()}까지 표시되며, 회색 일정은 학사일정 때문에 선택할 수 없습니다.</div></div>
        <div class="field"><label for="changeRoom">희망 장소 <span class="auto-fill-label">시간표에서 자동 입력</span></label><input id="changeRoom" placeholder="예: 2-3 교실" required></div>
        <div class="field full"><label for="changeReason">4. 변경 사유</label><textarea id="changeReason" required placeholder="변경이 필요한 이유를 입력해 주세요."></textarea></div>
      </div><div class="actions"><button class="button primary" type="submit">변경 승인 요청</button></div></form>` : `<div class="notice info"><span>i</span><div><strong>연동된 시간표가 없어도 직접 변경할 수 있습니다.</strong><br>오른쪽 위 ‘시간표와 관계없이 직접 변경’을 눌러 주세요.</div></div>`}
      ${renderManualChangeForm(classes, !hasTimetable)}
    </div>` : `<div class="notice warning"><span>!</span><div>변경할 수 있는 확정 공개수업이 없습니다.</div></div>`}
    <h3 class="section-title">변경 신청 내역</h3><div class="card">${renderChangeHistory()}</div>`;
}

function renderManualChangeForm(classes, forceOpen = false) {
  const periodOptions = Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1}교시</option>`).join('');
  return `<details id="manualChangeForm" class="manual-open-form" ${forceOpen ? 'open' : ''}><summary>수동 일정 변경 · 시간표 미반영 일정 포함</summary>
    <div class="notice info"><span>i</span><div><strong>컴시간 반영이 늦거나 별도 시간표를 쓰는 경우에도 변경할 수 있습니다.</strong><br>${finalDateLabel()}까지 날짜·교시·과목·학급·장소를 직접 입력해 주세요.</div></div>
    <form onsubmit="submitManualChange(event)"><div class="form-grid">
      <div class="field full"><label for="manualChangeClass">변경할 공개수업</label><select id="manualChangeClass" required><option value="">기존 일정을 선택해 주세요</option>${classes.map(item => `<option value="${attr(item.id)}">${fmtDate(item.date)} ${esc(item.period)}교시 · ${esc(item.className)} · ${esc(displayRoom(item.room))}</option>`).join('')}</select></div>
      <div class="field"><label for="manualChangeDate">희망 날짜</label><input id="manualChangeDate" type="date" min="${attr(today())}" max="${openClassFinalDate()}" required></div>
      <div class="field"><label for="manualChangePeriod">희망 교시</label><select id="manualChangePeriod" required><option value="">교시 선택</option>${periodOptions}</select></div>
      <div class="field"><label for="manualChangeSubject">과목</label><input id="manualChangeSubject" value="${attr(state.actor.subject || '')}" required></div>
      <div class="field"><label for="manualChangeClassName">학급</label><input id="manualChangeClassName" placeholder="예: 1-3" required></div>
      <div class="field"><label for="manualChangeRoom">희망 장소</label><input id="manualChangeRoom" placeholder="예: 1-3 교실" required></div>
      <div class="field full"><label for="manualChangeReason">변경 사유</label><textarea id="manualChangeReason" required placeholder="변경이 필요한 이유를 입력해 주세요."></textarea></div>
    </div><div class="actions"><button class="button primary" type="submit">직접 입력으로 변경 승인 요청</button></div></form>
  </details>`;
}

function openManualChangeForm() {
  const details = document.getElementById('manualChangeForm');
  if (!details) return;
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => document.getElementById('manualChangeDate')?.focus(), 350);
}

async function submitChange(event) {
  event.preventDefault();
  if (!value('changeTimetable')) return showToast('주간 시간표에서 변경할 수업을 먼저 선택해 주세요.', true);
  if (!value('changeDate')) return showToast('변경할 공개수업 날짜를 선택해 주세요.', true);
  if (value('changeDate') > openClassFinalDate()) return showToast(`공개수업 일정은 ${finalDateLabel()}까지 변경할 수 있습니다.`, true);
  await mutate('requestChange', { classId: value('changeClass'), date: value('changeDate'), timetableId: value('changeTimetable'), room: value('changeRoom'), reason: value('changeReason') });
}

async function submitManualChange(event) {
  event.preventDefault();
  const date = value('manualChangeDate');
  const period = Number(value('manualChangePeriod'));
  if (date > openClassFinalDate()) return showToast(`공개수업 일정은 ${finalDateLabel()}까지 변경할 수 있습니다.`, true);
  const blockedReason = blockedReasonFor({ period }, date);
  if (blockedReason) return showToast(`${fmtDate(date)} ${period}교시는 ${blockedReason} 때문에 변경할 수 없습니다.`, true);
  await mutate('requestChange', {
    manual: true,
    classId: value('manualChangeClass'),
    date,
    period,
    subject: value('manualChangeSubject'),
    className: value('manualChangeClassName'),
    room: value('manualChangeRoom'),
    reason: value('manualChangeReason')
  }, { confirm: '시간표와 관계없이 입력한 일정으로 변경 승인을 요청하시겠습니까?' });
}

function selectChangeTimetable(timetableId, lessonDate = '') {
  const item = (state.weeklyTimetable || []).find(row => row.id === timetableId)
    || openWeekRows().rows.find(row => row.id === timetableId && (!lessonDate || row.date === lessonDate))
    || state.myTimetable.find(row => row.id === timetableId);
  if (!item) return;
  const selectedDate = lessonDate || item.date || '';
  if (selectedDate && selectedDate > openClassFinalDate()) return showToast(`공개수업 일정은 ${finalDateLabel()}까지 변경할 수 있습니다.`, true);
  const blockedReason = selectedDate ? blockedReasonFor(item, selectedDate) : '';
  if (blockedReason) return showToast(`${fmtDate(selectedDate)} ${item.period}교시는 ${blockedReason} 때문에 변경할 수 없습니다.`, true);
  document.getElementById('changeTimetable').value = item.id;
  document.querySelectorAll('.timetable-slot').forEach(button => button.classList.toggle('selected', button.dataset.timetableId === item.id));
  const room = document.getElementById('changeRoom');
  if (room) room.value = defaultRoomForTimetable(item);
  const dateSelect = document.getElementById('changeDate');
  dateSelect.innerHTML = selectedDate
    ? `<option value="${attr(selectedDate)}" selected>${esc(fmtDate(selectedDate))}</option>`
    : renderOpenDateOptions(item);
  dateSelect.disabled = false;
  const help = document.getElementById('changeTimetableHelp');
  if (help) help.innerHTML = `<strong>${selectedDate ? esc(fmtDate(selectedDate)) : esc(item.weekday + '요일')} ${esc(item.period)}교시 · ${esc(item.className)} · ${esc(item.subject || '과목 미입력')}</strong>을 선택했습니다.`;
}

function renderChangeHistory() {
  if (!state.myChanges.length) return empty('일정 변경 신청 내역이 없습니다.');
  return `<div class="table-wrap"><table class="change-history-table"><thead><tr><th>신청일시</th><th>기존 일정</th><th>희망 일정</th><th>사유</th><th>상태</th></tr></thead><tbody>${state.myChanges.map(item => `<tr><td class="application-time-cell">${esc(item.requestedAt || '기록 없음')}</td><td>${fmtDate(item.originalDate)} ${esc(item.originalPeriod)}교시<br>${esc(item.originalClass)} · ${esc(displayRoom(item.originalRoom))}</td><td>${fmtDate(item.requestedDate)} ${esc(item.requestedPeriod)}교시<br>${esc(item.requestedClass)} · ${esc(displayRoom(item.requestedRoom))}</td><td>${esc(item.reason)}</td><td>${statusBadge(item.status)}${item.adminNote ? `<br><small>${esc(item.adminNote)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderAdmin() {
  if (!state.admin) return '';
  const a = state.admin;
  return `${pageHead('ADMIN', '관리자 센터', '1·2학기 연간 이행 현황과 승인 업무를 관리합니다.')}
    ${renderOperationPhaseControl()}
    ${renderReminderRecipientSettings()}
    <section id="adminMessageCenter" class="admin-message-center"><div class="section-title-row"><h3 class="section-title">메신저 안내 문구</h3><div class="section-title-actions"><span class="badge blue">일정별 리마인드</span><button class="button primary small" type="button" onclick="openAdminPublicMessengerManager()">공개 메신저 관리</button><button class="button small" type="button" onclick="openAdminRoomLocationManager()">교실 위치 관리</button></div></div><div class="card">${renderMessageBuilder(a.approvedClasses, a.documentClasses)}</div></section>
    ${renderAdminTemplateManager()}
    ${renderComciganSync(a)}
    ${renderAdminAttendance(a.attendanceVerification || [])}
    ${renderAdminDocumentCenter(a)}
    <h3 class="section-title">수기 제출 확인</h3><div class="card">${renderPaperDocuments(a.paperDocuments)}</div>
    <h3 class="section-title">1학기 CSV 가져오기</h3><div class="card"><div class="card-head"><div><h3>1학기 실적·2학기 대상자 반영</h3><p>1학기 공개수업과 참관 실적을 저장하고, 2학기 공개수업 대상자를 함께 설정합니다.</p></div></div><div class="file-row"><div class="field"><label for="legacyCsv">CSV 파일</label><input id="legacyCsv" type="file" accept=".csv,text/csv"></div><button class="button primary" onclick="importCsv()">CSV 반영</button><span></span></div></div>`;
}

function renderAdminTemplateManager() {
  const files = state.templateLibrary || [];
  return `<section class="card admin-template-manager"><div class="card-head"><div><p class="eyebrow">SHARED FORMS</p><h3>공용 양식 자료실 관리</h3><p>등록한 양식은 모든 교사의 ‘공개수업 운영’ 화면 상단에 표시됩니다.</p></div><span class="badge blue">PDF·HWP·HWPX·DOC·DOCX</span></div><div class="admin-template-grid">${ADMIN_DOCUMENT_TYPES.map(type => {
    const file = files.find(item => item.type === type);
    return `<article><div><strong>${esc(documentTypeLabel(type))}</strong><small>${file ? `<span class="template-current-file">현재 파일: <b>${esc(file.fileName)}</b></span>${file.uploadedAt ? `<span class="template-uploaded-at">교체·등록 시각: ${esc(file.uploadedAt)}</span>` : ''}` : '등록된 양식 없음'}</small></div><div class="field"><label class="sr-only" for="template_${attr(type)}">${esc(type)} 양식 파일</label><input id="template_${attr(type)}" type="file" accept=".pdf,.hwp,.hwpx,.doc,.docx"></div><div class="actions"><button class="button primary small" type="button" onclick="uploadOperationTemplate('${attr(type)}')">${file ? '새 파일로 교체' : '양식 등록'}</button>${file ? `${file.fileUrl ? `<a class="button small" href="${attr(file.fileUrl)}">확인</a>` : ''}<button class="button danger small" type="button" onclick="deleteOperationTemplate('${attr(type)}')">삭제</button>` : ''}</div></article>`;
  }).join('')}</div><p class="template-security-note">양식 파일은 제출자료와 같은 비공개 저장소에 보관하고, 웹앱에서 15분 동안만 유효한 다운로드 주소를 만들어 제공합니다.</p></section>`;
}

async function uploadOperationTemplate(type) {
  const input = document.getElementById(`template_${type}`);
  const file = input?.files?.[0];
  if (!file) return showToast(`${documentTypeLabel(type)} 양식 파일을 선택해 주세요.`, true);
  if (file.size > state.config.maxFileMb * 1024 * 1024) return showToast(`양식 파일은 ${state.config.maxFileMb}MB 이하만 등록할 수 있습니다.`, true);
  const dataUrl = await readFileAsDataUrl(file);
  await mutate('uploadTemplate', { type, file: { name: file.name, mimeType: file.type, base64: dataUrl.split(',')[1] } }, { confirm: `${documentTypeLabel(type)} 양식을 등록하시겠습니까? 기존 파일이 있으면 새 파일로 교체됩니다.` });
}

async function deleteOperationTemplate(type) {
  await mutate('deleteTemplate', { type }, { confirm: `${documentTypeLabel(type)} 공용 양식을 삭제하시겠습니까? 교사 화면의 내려받기 버튼도 사라집니다.` });
}

function renderAdminDashboard() {
  const a = state.admin;
  const total = a.stats.totalTeachers || 0;
  const done = a.stats.allRequirementsCompleted || 0;
  const progress = total ? Math.round((done / total) * 100) : 0;
  return `${pageHead('DASHBOARD', '관리자 대시보드', '승인 업무와 자료 제출 현황을 먼저 확인하고, 교사별 연간 실적을 관리합니다.')}
    <section class="hero admin-hero"><h2>오늘 처리할 업무</h2><p>공개수업 승인 ${a.pendingClasses.length}건 · 일정 변경 승인 ${a.pendingChanges.length}건 · 자료 미제출 ${a.stats.documentPending}건입니다.</p><div class="admin-hero-actions"><button class="button ghost" type="button" onclick="openAdminMessageCenter()">메신저 문구 만들기</button><button class="button ghost" type="button" onclick="openAdminPublicMessengerManager()">공개 메신저 관리</button><button class="button ghost" type="button" onclick="openAdminRoomLocationManager()">교실 위치 관리</button><button class="button ghost" type="button" onclick="go('admin')">관리자 센터 전체 보기</button></div><div style="margin-top:22px;max-width:520px"><div class="progress"><span style="width:${progress}%"></span></div><div class="progress-label"><span>전체 요건 완료 ${done}/${total}명</span><span>${progress}%</span></div></div></section>
    ${renderAdminOpenApprovals(a.pendingClasses)}
    ${renderAdminChangeApprovals(a.pendingChanges)}
    ${renderApplicationOverview(a)}
    ${renderAdminAttentionCenter(a)}
    ${renderAdminScheduleConflicts(a.scheduleConflicts || [])}
    ${renderAdminConfirmedClasses(a.approvedClasses, a.observationApplications || [])}
    ${renderAdminDocumentSummary(a)}
    ${renderAdminStatCards(a)}
    ${renderAnnualStatusSection(a.annualTeacherStatuses)}
    `;
}

function openAdminMessageCenter() {
  activeTab = 'admin';
  render();
  window.setTimeout(() => document.getElementById('adminMessageCenter')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

function applicationOverviewData(a) {
  const statuses = [...(a.annualTeacherStatuses || [])].sort((left, right) =>
    String(left.subject || '').localeCompare(String(right.subject || ''), 'ko') ||
    String(left.name || '').localeCompare(String(right.name || ''), 'ko')
  );
  const openTargets = statuses.filter(item => item.isSecondSemesterTarget);
  const observationTargets = statuses.filter(item => item.secondObservationTarget);
  return {
    openApplied: openTargets.filter(item => item.secondOpenApplied),
    openMissing: openTargets.filter(item => !item.secondOpenApplied),
    observationComplete: observationTargets.filter(item => item.secondObservationApplicationComplete),
    observationMissing: observationTargets.filter(item => !item.secondObservationApplicationComplete)
  };
}

function renderApplicationTeacherList(title, items, tone, emptyMessage) {
  return `<details class="application-list ${attr(tone)}" ${tone === 'danger' ? 'open' : ''}><summary class="application-list-head"><strong>${esc(title)}</strong><span>${items.length}명</span></summary>${items.length ? `<div class="application-name-list">${items.map(item => `<span><strong>${esc(item.name)}</strong><small>${esc(item.subject || '교과 미분류')}</small></span>`).join('')}</div>` : `<p class="application-list-empty">${esc(emptyMessage)}</p>`}</details>`;
}

function renderApplicationOverview(a) {
  const data = applicationOverviewData(a);
  const openDeadline = state.config.openApplicationDeadline ? fmtDate(state.config.openApplicationDeadline) : '마감일 미설정';
  const observationWindow = state.config.observationApplicationStart && state.config.observationApplicationDeadline
    ? `${fmtDate(state.config.observationApplicationStart)}~${fmtDate(state.config.observationApplicationDeadline)}`
    : '기간 미설정';
  return `<section class="application-overview">
    <div class="application-overview-head"><div><p class="eyebrow">APPLICATION OVERVIEW</p><h3>신청 현황 한눈에 보기</h3><p>명단을 바로 확인하고, 필요한 대상만 복사해 메신저로 안내할 수 있습니다.</p></div><span class="badge blue">실시간 현황</span></div>
    <div class="application-overview-grid">
      <article class="application-board open-board">
        <div class="application-board-head"><div><span class="application-board-step">1</span><div><h4>공개수업 신청</h4><p>신청 마감 ${esc(openDeadline)}</p></div></div><strong>${data.openApplied.length}/${data.openApplied.length + data.openMissing.length}명</strong></div>
        <div class="application-progress"><span style="width:${data.openApplied.length + data.openMissing.length ? Math.round(data.openApplied.length / (data.openApplied.length + data.openMissing.length) * 100) : 0}%"></span></div>
        <div class="application-summary-actions"><button type="button" class="application-summary success" onclick="focusApplicationStatus('second_open_applied')"><span>신청 완료</span><strong>${data.openApplied.length}명</strong></button><button type="button" class="application-summary danger" onclick="focusApplicationStatus('second_open_missing')"><span>미신청</span><strong>${data.openMissing.length}명</strong></button></div>
        <div class="application-lists">${renderApplicationTeacherList('신청 완료 교사', data.openApplied, 'success', '아직 신청 완료 교사가 없습니다.')}${renderApplicationTeacherList('메신저 안내 대상 · 미신청', data.openMissing, 'danger', '모든 대상 교사가 신청했습니다.')}</div>
        <div class="application-copy-actions"><button class="button primary" type="button" onclick="copyApplicationOverviewNames('openMissing')" ${data.openMissing.length ? '' : 'disabled'}>미신청 교사 이름 복사</button><button class="button" type="button" onclick="copyApplicationOverviewNames('openApplied')" ${data.openApplied.length ? '' : 'disabled'}>신청 교사 이름 복사</button></div>
      </article>
      <article class="application-board observation-board">
        <div class="application-board-head"><div><span class="application-board-step">2</span><div><h4>2학기 참관 신청</h4><p>신청 기간 ${esc(observationWindow)} · 1학기 2회 완료자는 제외</p></div></div><strong>대상 ${data.observationComplete.length + data.observationMissing.length}명</strong></div>
        <div class="application-summary-actions"><button type="button" class="application-summary success" onclick="focusApplicationStatus('second_observation_complete')"><span>2학기 신청 완료</span><strong>${data.observationComplete.length}명</strong></button><button type="button" class="application-summary danger" onclick="focusApplicationStatus('second_observation_missing')"><span>2학기 신청 미완료</span><strong>${data.observationMissing.length}명</strong></button></div>
        <div class="application-lists observation-lists">${renderApplicationTeacherList('2학기 참관 신청 완료', data.observationComplete, 'success', '아직 신청 완료 교사가 없습니다.')}${renderApplicationTeacherList('메신저 안내 대상 · 2학기 신청 미완료', data.observationMissing, 'danger', '대상 교사가 모두 필요한 횟수만큼 신청했습니다.')}</div>
        <div class="application-copy-actions"><button class="button primary" type="button" onclick="copyApplicationOverviewNames('observationMissing')" ${data.observationMissing.length ? '' : 'disabled'}>미완료 교사 이름 복사</button><button class="button" type="button" onclick="copyApplicationOverviewNames('observationComplete')" ${data.observationComplete.length ? '' : 'disabled'}>신청 완료 교사 이름 복사</button></div>
      </article>
    </div>
  </section>`;
}

async function copyApplicationOverviewNames(key) {
  const data = applicationOverviewData(state.admin);
  const names = [...new Set((data[key] || []).map(item => item.name).filter(Boolean))];
  if (!names.length) return showToast('복사할 교사가 없습니다.', true);
  await copyPlainText(names.join(', '));
  showToast(`${names.length}명의 이름을 복사했습니다.`);
}

function focusApplicationStatus(filter) {
  adminStatusFilter = filter;
  adminStatusSort = 'name';
  adminSectionOpenState.set('annual-status', true);
  render();
  setTimeout(() => document.getElementById('annualStatusSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

function adminAttentionGroups(a) {
  const statuses = a.annualTeacherStatuses || [];
  const openMissing = statuses.filter(item => item.isSecondSemesterTarget && !item.annualOpenCompleted && !item.secondOpenApplied);
  const observationMissing = statuses.filter(item => !item.observationRequirementMet);
  const observerShortage = (a.approvedClasses || []).filter(item => Number(item.observerCount || 0) < 2);
  const attendancePending = (a.attendanceVerification || []).filter(item => !item.complete);
  const documentKeys = new Set((a.allDocuments || []).map(item => `${item.classId}|${item.type}`));
  const documentPending = (a.documentClasses || []).map(cls => ({
    ...cls,
    missingTypes: ADMIN_DOCUMENT_TYPES.filter(type => !documentKeys.has(`${cls.id}|${type}`))
  })).filter(item => item.missingTypes.length);
  return {
    open: { title: '공개수업 미신청', caption: '2학기 대상자 중 아직 신청하지 않은 교사', items: openMissing, names: openMissing.map(item => item.name), tone: 'blue' },
    observation: { title: '참관 횟수 부족', caption: '연간 실제 참관 2회가 남은 교사', items: observationMissing, names: observationMissing.map(item => item.name), tone: 'amber' },
    shortage: { title: '참관인 2명 미만', caption: '참관이 남은 교사에게 추가 신청 안내 필요', items: observerShortage, names: observationMissing.map(item => item.name), tone: 'amber' },
    attendance: { title: '참관 확인 대기', caption: '수업 후 참석·불참 확인이 남은 진행 교사', items: attendancePending, names: attendancePending.map(item => item.teacherName), tone: 'red' },
    documents: { title: '제출자료 미완료', caption: '지도안·협의록·참관록 중 미제출 자료가 있는 교사', items: documentPending, names: documentPending.map(item => item.teacherName), tone: 'red' }
  };
}

function renderAdminAttentionCenter(a) {
  const groups = adminAttentionGroups(a);
  const keys = ['open', 'observation', 'shortage', 'attendance', 'documents'];
  return `<section class="admin-attention-center"><div class="card-head"><div><p class="eyebrow">MESSAGE PRIORITY</p><h3>지금 안내할 대상</h3><p>신청 → 참관 인원 → 수업 후 확인·제출 순으로 확인합니다. 이름 복사를 누르면 메신저 수신자에 붙여 넣을 수 있습니다.</p></div></div><div class="admin-attention-grid">${keys.map(key => {
    const group = groups[key];
    return `<article class="attention-card ${attr(group.tone)}"><div><span>${esc(group.title)}</span><strong>${group.items.length}명${key === 'shortage' ? '·수업' : ''}</strong><small>${esc(group.caption)}</small></div><button class="button small" type="button" onclick="copyAdminAttentionNames('${attr(key)}')" ${group.names.length ? '' : 'disabled'}>이름 복사</button></article>`;
  }).join('')}</div></section>`;
}

async function copyAdminAttentionNames(key) {
  const group = adminAttentionGroups(state.admin)[key];
  const names = [...new Set(group?.names || [])];
  if (!names.length) return showToast('복사할 대상자가 없습니다.', true);
  await copyPlainText(names.join(', '));
  showToast(`${group.title} 대상 ${names.length}명의 이름을 복사했습니다.`);
}

function renderAdminScheduleConflicts(items) {
  const badge = `<span class="badge ${items.length ? 'red' : 'green'}">${items.length ? `${items.length}건 확인 필요` : '충돌 없음'}</span>`;
  const content = items.length ? `<div class="table-wrap"><table><thead><tr><th>교사</th><th>구분</th><th>연결 일정</th><th>충돌 내용</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.teacherName)}</strong><br><small>${esc(item.teacherSubject)}</small></td><td>${statusBadge(item.type === '참관시간표충돌' ? '참관 충돌' : '공개수업 충돌')}</td><td class="nowrap">${fmtDate(item.date)} ${esc(item.period)}교시<br>${esc(item.className)} · ${esc(displayRoom(item.room))}</td><td><strong>${esc(item.title)}</strong><br><small>${esc(item.message)}</small></td></tr>`).join('')}</tbody></table></div>` : empty('현재 시간표·학사일정과 충돌하는 확정 일정이 없습니다.');
  return `<section id="adminScheduleConflicts">${renderAdminCollapsible('schedule-conflicts', '일정 충돌 점검', '충돌이 있을 때만 펼쳐서 상세 내용을 확인합니다.', badge, content, items.length > 0)}</section>`;
}

async function downloadAdminWorkbook() {
  if (!userSession || userSession.actorType !== 'admin' || !userSession.adminToken) return showToast('관리자로 다시 로그인해 주세요.', true);
  const report = value('adminExportReport') || adminExportReport;
  const params = new URLSearchParams({ report, filter: adminStatusFilter, sort: adminStatusSort });
  setLoading(true);
  try {
    const response = await fetch(`/api/export?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${userSession.adminToken}` },
      cache: 'no-store'
    });
    if (!response.ok) {
      let message = '엑셀 파일을 만들지 못했습니다.';
      try { message = (await response.json()).message || message; } catch (_error) {}
      if (response.status === 401 || response.status === 403) {
        userSession = null;
        sessionStorage.removeItem('school_open_class_session');
        await renderLogin(message);
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const reportName = document.querySelector('#adminExportReport option:checked')?.textContent?.trim() || '교사별 연간 이행 현황';
    const fileName = encodedName ? decodeURIComponent(encodedName) : `${state.config.schoolYear || new Date().getFullYear()}학년도_${reportName}.xlsx`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`${reportName} 엑셀 파일을 내려받았습니다.`);
  } catch (error) {
    if (userSession) showRequestError(error);
  } finally {
    setLoading(false);
  }
}

function renderAdminDocumentSummary(a) {
  const summaries = ADMIN_DOCUMENT_TYPES.map(type => adminDocumentStats(a, type));
  return `<h3 class="section-title">자료 제출 현황 <span class="badge ${a.stats.documentPending ? 'red' : 'green'}">미제출 ${a.stats.documentPending}건</span></h3>
    <section class="card admin-document-summary">
      <div class="document-overview-grid">${summaries.map(summary => `<button class="document-overview-card" type="button" onclick="openAdminDocuments('${attr(summary.type)}')">
        <span>${esc(documentTypeLabel(summary.type))}</span>
        <strong>${summary.required ? `${summary.submitted}/${summary.required}건` : '제출 대상 없음'}</strong>
        <div class="document-progress"><span style="width:${summary.progress}%"></span></div>
        <small>${summary.pending ? `미제출 ${summary.pending}건` : '미제출 없음'}${summary.paperPending ? ` · 수기 확인 ${summary.paperPending}건` : ''}</small>
      </button>`).join('')}</div>
      <div class="document-summary-footer"><span>확정된 1·2학기 공개수업을 함께 계산합니다.</span><button class="button primary" onclick="openAdminDocuments()">제출 자료 상세 관리</button></div>
    </section>`;
}

function adminDocumentStats(a, type) {
  const classes = a.documentClasses || a.approvedClasses || [];
  const requiredIds = new Set(classes.map(item => item.id));
  const documents = (a.allDocuments || []).filter(item => item.type === type && requiredIds.has(item.classId));
  const documentByClass = new Map();
  documents.forEach(item => { if (!documentByClass.has(item.classId)) documentByClass.set(item.classId, item); });
  const required = requiredIds.size;
  const submitted = documentByClass.size;
  return {
    type,
    required,
    submitted,
    pending: Math.max(0, required - submitted),
    paperPending: [...documentByClass.values()].filter(item => item.status === '수기제출예정').length,
    progress: required ? Math.round(submitted / required * 100) : 0
  };
}

function openAdminDocuments() {
  activeTab = 'admin';
  render();
  setTimeout(() => document.getElementById('adminDocumentCenter')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

function renderAdminOpenApprovals(classes) {
  const pending = sortClassesBySchedule(classes);
  return `<section id="adminOpenApprovals"><h3 class="section-title">공개수업 승인 대기 <span class="badge ${pending.length ? 'red' : 'green'}">${pending.length}건</span></h3><div class="card">${pending.length ? `<div class="bulk-approval-toolbar"><label class="bulk-select-all" for="pendingOpenSelectAll"><input id="pendingOpenSelectAll" type="checkbox" onchange="togglePendingOpenApprovalAll(this.checked)"><span>전체 선택</span></label><strong id="pendingOpenSelectedCount">0건 선택</strong><div class="bulk-approval-actions"><button id="approveSelectedOpenClasses" class="button success small" type="button" onclick="approvePendingOpenClasses('selected')" disabled>선택 승인</button><button class="button primary small" type="button" onclick="approvePendingOpenClasses('all')">전체 일괄 승인 (${pending.length}건)</button></div></div>${renderClassesByDate(pending, item => lessonCard(item, `<div class="pending-approval-controls"><label class="pending-approval-select"><input class="pending-open-checkbox" type="checkbox" value="${attr(item.id)}" onchange="updatePendingOpenApprovalSelection()" aria-label="${attr(item.teacherName)} 선생님 공개수업 선택"><span>선택</span></label><div class="admin-class-actions"><button class="button success small" onclick="processOpen('${attr(item.id)}',true)">승인</button><button class="button danger small" onclick="processOpen('${attr(item.id)}',false)">반려</button><button class="button subtle small" onclick="deleteAdminOpenClass('${attr(item.id)}','${attr(item.teacherName)}')">삭제</button></div></div>`))}<p class="bulk-approval-note">일괄 승인에서도 시간표·학사일정·장소 충돌을 각 신청별로 다시 확인하며, 검증을 통과한 일정만 확정됩니다.</p>` : empty('승인 대기 중인 공개수업이 없습니다.')}</div></section>`;
}

function rememberAdminSection(id, isOpen) {
  adminSectionOpenState.set(id, Boolean(isOpen));
}

function renderAdminCollapsible(id, title, description, badge, content, defaultOpen = false) {
  const isOpen = adminSectionOpenState.has(id) ? adminSectionOpenState.get(id) : defaultOpen;
  return `<details class="admin-collapsible" data-section-id="${attr(id)}" ${isOpen ? 'open' : ''} ontoggle="rememberAdminSection(this.dataset.sectionId, this.open)">
    <summary class="admin-collapsible-summary"><div><h3>${esc(title)}</h3>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="admin-collapsible-meta">${badge}<b class="admin-expand-label">펼쳐보기⌄</b><b class="admin-collapse-label">접기⌃</b></div></summary>
    <div class="admin-collapsible-body">${content}</div>
  </details>`;
}

function renderAdminChangeApprovals(changes) {
  const pending = changes || [];
  return `<section id="adminChangeApprovals" class="admin-priority-section ${pending.length ? 'urgent' : ''}"><div class="admin-priority-heading"><div><p class="eyebrow">APPROVAL REQUIRED</p><h3>일정 변경 승인 대기</h3><p>처리가 필요한 변경 요청을 확정 일정표보다 먼저 보여줍니다.</p></div><span class="badge ${pending.length ? 'red' : 'green'}">${pending.length}건</span></div><div class="card">${renderAdminChanges(pending)}</div></section>`;
}

function renderAdminConfirmedClasses(classes, observations = []) {
  const confirmed = sortClassesBySchedule(classes);
  const currentDate = todayKst();
  const remaining = confirmed.filter(item => item.date >= currentDate);
  const past = confirmed.filter(item => item.date < currentDate);
  const observerCountByClass = new Map(remaining.map(item => [
    item.id,
    observations.filter(observation => observation.classId === item.id).length
  ]));
  const shortageSorted = [...remaining].sort((left, right) => {
    const leftCount = observerCountByClass.get(left.id) || 0;
    const rightCount = observerCountByClass.get(right.id) || 0;
    const leftPriority = leftCount < 2 ? 0 : 1;
    const rightPriority = rightCount < 2 ? 0 : 1;
    return leftPriority - rightPriority || leftCount - rightCount ||
      String(left.date || '').localeCompare(String(right.date || '')) ||
      Number(left.period || 0) - Number(right.period || 0) ||
      String(left.teacherName || '').localeCompare(String(right.teacherName || ''), 'ko');
  });
  const badge = `<span class="badge ${confirmed.length ? 'blue' : 'green'}">총 ${confirmed.length}건</span>`;
  const sortControl = `<div class="admin-schedule-toolbar"><div><strong>표시 순서</strong><span>참관인원이 부족한 수업을 먼저 모아볼 수 있습니다.</span></div><label class="admin-schedule-sort"><span class="sr-only">확정 공개수업 정렬</span><select onchange="setAdminConfirmedSort(this.value)" aria-label="확정 공개수업 정렬"><option value="schedule" ${adminConfirmedSort === 'schedule' ? 'selected' : ''}>일정별 정렬</option><option value="shortage" ${adminConfirmedSort === 'shortage' ? 'selected' : ''}>참관인원 미달 우선</option></select></label></div>`;
  const renderClass = item => renderAdminConfirmedClass(item, observations.filter(observation => observation.classId === item.id));
  const list = !remaining.length ? empty('오늘 이후 확정된 공개수업이 없습니다.') : adminConfirmedSort === 'shortage'
    ? `<div class="lesson-list admin-shortage-sort-list">${shortageSorted.map(renderClass).join('')}</div>`
    : renderClassesByDate(remaining, renderClass);
  const note = adminConfirmedSort === 'shortage'
    ? '오늘 이후 일정만 참관 0명 → 1명 → 2명 이상 순으로 표시하고, 같은 인원에서는 날짜와 교시 순으로 정렬합니다.'
    : '한국 시간 기준 오늘 일정부터 날짜 → 교시 → 교사 순으로 정렬됩니다.';
  const pastList = past.length ? renderAdminCollapsible('past-confirmed-classes', `지난 일정 (${past.length}건)`, '최근 날짜부터 표시합니다. 지난 일정도 변경·삭제하거나 정원을 조정할 수 있습니다.', '', renderClassesByDate(past, renderClass, true), false) : '';
  const content = confirmed.length ? `${sortControl}${list}<p class="schedule-sort-note">${note} 각 수업의 참관 정원을 바로 조정할 수 있으며, 참관 신청은 개별 삭제할 수 있습니다.</p>${pastList}` : empty('확정된 2학기 공개수업이 없습니다.');
  return renderAdminCollapsible('confirmed-classes', '2학기 확정 공개수업 일정', '일정별 또는 참관인원 미달 우선으로 확인하고, 수업별 참관 정원을 조정하세요.', badge, content, false);
}

function setAdminConfirmedSort(mode) {
  if (!['schedule', 'shortage'].includes(mode)) return;
  adminConfirmedSort = mode;
  render();
  window.setTimeout(() => document.querySelector('[data-section-id="confirmed-classes"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

function renderAdminConfirmedClass(item, observations) {
  const observerCount = observations.length;
  const currentCapacity = Number(item.capacity) || Number(state.config?.capacity) || 4;
  const minimumCapacity = Math.max(1, observerCount);
  const capacityOptions = Array.from({ length: 21 - minimumCapacity }, (_, index) => minimumCapacity + index)
    .map(capacity => `<option value="${capacity}" ${capacity === currentCapacity ? 'selected' : ''}>${capacity}명</option>`).join('');
  const capacityControl = `<label class="admin-capacity-control"><span>참관 정원</span><select aria-label="${attr(item.teacherName)} 선생님 수업 참관 정원" onchange="updateAdminClassCapacity('${attr(item.id)}', this.value, '${attr(item.teacherName)}')">${capacityOptions}</select></label>`;
  const actions = `<div class="admin-class-actions">${statusBadge('확정')}${capacityControl}<button class="button primary small" onclick="openAdminClassEditor('${attr(item.id)}')">일정 변경</button><button class="button subtle small" onclick="deleteAdminOpenClass('${attr(item.id)}','${attr(item.teacherName)}')">일정 삭제</button></div>`;
  const observerStatus = observerCount < 2
    ? `<span class="badge amber">참관 ${observerCount}/${currentCapacity}명 · ${2 - observerCount}명 부족</span>`
    : `<span class="badge green">참관 ${observerCount}/${currentCapacity}명</span>`;
  const subjectCandidateCount = (state.admin?.eligibleSubjectObservers?.[item.id] || []).length;
  const candidateButtons = observerCount < 2
    ? `<div class="eligible-button-group"><button type="button" class="button primary small eligible-subject-button" onclick="openEligibleSubjectObservers('${attr(item.id)}', 'subject')">참관 가능 동교과 확인 <b>${subjectCandidateCount}명</b></button><button type="button" class="button small eligible-other-button" onclick="openEligibleSubjectObservers('${attr(item.id)}', 'other')">참관 가능 타교과 확인</button></div>`
    : '';
  const observerHeading = `<div class="admin-observer-heading"><strong>${observerStatus}</strong>${candidateButtons}</div>`;
  const observers = observations.length
    ? `<div class="admin-observer-list">${observerHeading}<div>${observations.map(observation => `<span class="admin-observer-chip">${esc(observation.observerName)}(${esc(observation.observerSubject || '교과 미분류')}) <button type="button" onclick="deleteAdminObservation('${attr(observation.id)}','${attr(observation.observerName)}','${attr(item.teacherName)}')" aria-label="${attr(observation.observerName)} 참관 신청 삭제">×</button></span>`).join('')}</div></div>`
    : `<div class="admin-observer-list empty-observers">${observerHeading}<span>참관 신청자가 없습니다.</span></div>`;
  return `<div class="admin-confirmed-class ${observerCount < 2 ? 'observer-shortage' : ''}">${lessonCard(item, actions)}${observers}</div>`;
}

function eligibleSubjectObserverContext(classId, mode = 'subject') {
  const item = (state.admin?.approvedClasses || []).find(row => row.id === classId);
  if (!item) return null;
  const isOther = mode === 'other';
  const candidates = isOther
    ? (state.admin?.eligibleOtherSubjectObservers?.[classId] || [])
    : (state.admin?.eligibleSubjectObservers?.[classId] || []);
  const names = candidates.map(candidate => candidate.name).filter(Boolean);
  const message = isOther
    ? `[공개수업 추가 참관 협조 요청]

안녕하세요. 연구부입니다.

${fmtDate(item.date)} ${item.period}교시에 진행되는 ${item.teacherName} 선생님의 ${item.subject} 공개수업에 참관 협조를 부탁드립니다.

현재 시간표와 확정된 공개수업·참관 일정을 확인했을 때, 선생님께서는 해당 시간에 참관 가능한 것으로 확인되어 안내드립니다. 교과가 다르더라도 수업 나눔과 공개수업 운영을 위해 가능하시면 시스템에서 참관 신청해 주시기 바랍니다.

- 공개 교사: ${item.teacherName} 선생님
- 교과: ${item.subject}
- 일시: ${fmtDate(item.date)} ${item.period}교시
- 장소: ${displayRoom(item.room)}
- 수업 주제: ${item.topic || '미입력'}
- 신청 링크: ${appShareUrl()}

해당 공개수업은 참관 협조가 더 필요한 상황입니다. 이미 연간 참관 기준을 충족하셨더라도 가능하신 경우 추가 참관을 부탁드립니다.
감사합니다.`
    : `[동교과·교과군 공개수업 참관 협조 요청]

안녕하세요. 연구부입니다.

${fmtDate(item.date)} ${item.period}교시에 진행되는 ${item.teacherName} 선생님의 ${item.subject} 공개수업에 동교과·교과군 참관 협조를 부탁드립니다.

현재 시간표와 확정된 공개수업·참관 일정을 확인했을 때, 해당 시간에 참관 가능한 동교과·교과군 선생님으로 확인되어 안내드립니다. 가능하시면 시스템에서 참관 신청해 주시기 바랍니다.

- 공개 교사: ${item.teacherName} 선생님
- 일시: ${fmtDate(item.date)} ${item.period}교시
- 장소: ${displayRoom(item.room)}
- 수업 주제: ${item.topic || '미입력'}
- 신청 링크: ${appShareUrl()}

이미 연간 참관 기준을 충족하셨더라도 동교과·교과군 수업 나눔이 원활히 이루어질 수 있도록 협조 부탁드립니다.
감사합니다.`;
  return {
    item, candidates, names, message,
    mode: isOther ? 'other' : 'subject',
    title: isOther ? '참관 가능 타교과 확인' : '참관 가능 동교과·교과군 확인',
    eyebrow: isOther ? 'OTHER SUBJECT OBSERVERS' : 'SUBJECT OBSERVERS',
    emptyText: isOther ? '현재 시간표와 기존 일정을 모두 확인했을 때 참관 가능한 타교과 교사가 없습니다.' : '현재 시간표와 기존 일정을 모두 확인했을 때 참관 가능한 동교과·교과군 교사가 없습니다.',
    ruleText: isOther ? '동교과·교과군 후보를 제외한 교사 중 해당 날짜·교시에 수업, 학사일정, 본인 공개수업, 다른 참관 일정이 없는 교사입니다. 이미 이 수업을 신청한 교사는 제외됩니다.' : '동교과 또는 교과군(역사·사회 / 미술·음악 / 일어(일본어)·영어·한문)이면서 해당 날짜·교시에 수업, 학사일정, 본인 공개수업, 다른 참관 일정이 없는 교사입니다. 이미 이 수업을 신청한 교사는 제외됩니다.'
  };
}

async function fetchEligibleOtherSubjectObservers(classId) {
  const headers = { 'Content-Type': 'application/json' };
  if (userSession?.actorType === 'admin' && userSession.adminToken) headers.Authorization = `Bearer ${userSession.adminToken}`;
  const response = await fetch('/api/observer-candidates', {
    method: 'POST',
    headers,
    body: JSON.stringify({ classId })
  });
  let result;
  try {
    result = await response.json();
  } catch (_error) {
    throw new Error('서버가 올바른 응답을 보내지 않았습니다.');
  }
  if (response.status === 401 || response.status === 403) {
    userSession = null;
    sessionStorage.removeItem('school_open_class_session');
    renderLogin(result.message || '다시 로그인해 주세요.');
    throw new Error(result.message || '로그인이 필요합니다.');
  }
  if (!response.ok || !result.ok) throw new Error(result.message || '참관 가능 타교과를 확인하지 못했습니다.');
  return result.data?.candidates || [];
}

async function openEligibleSubjectObservers(classId, mode = 'subject') {
  document.getElementById('eligibleSubjectObserverModal')?.remove();
  if (mode === 'other') {
    setLoading(true);
    try {
      const candidates = await fetchEligibleOtherSubjectObservers(classId);
      if (!state.admin.eligibleOtherSubjectObservers) state.admin.eligibleOtherSubjectObservers = {};
      state.admin.eligibleOtherSubjectObservers[classId] = candidates;
    } catch (error) {
      if (userSession) showRequestError(error);
      return;
    } finally {
      setLoading(false);
    }
  }
  const context = eligibleSubjectObserverContext(classId, mode);
  if (!context) return showToast('공개수업 정보를 찾을 수 없습니다.', true);
  const { item, candidates, message, title, eyebrow, emptyText, ruleText } = context;
  const candidateList = candidates.length
    ? `<div class="eligible-observer-chips">${candidates.map(candidate => `<span><b>${esc(candidate.name)}</b><small>${esc(candidate.subject)} · ${esc(candidate.relationship || '타교과')}</small></span>`).join('')}</div>`
    : `<div class="eligible-observer-empty">${esc(emptyText)}</div>`;
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="eligibleSubjectObserverModal" class="modal-backdrop admin-data-backdrop" role="dialog" aria-modal="true" aria-labelledby="eligibleSubjectObserverTitle">
    <section class="login-schedule-tool-modal admin-data-modal eligible-observer-modal">
      <button class="login-application-close" type="button" onclick="closeEligibleSubjectObservers()" aria-label="${attr(title)} 닫기">×</button>
      <header class="login-schedule-tool-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2 id="eligibleSubjectObserverTitle">${esc(title)}</h2><p>${esc(item.teacherName)} 선생님 · ${esc(item.subject)} · ${esc(fmtDate(item.date))} ${Number(item.period)}교시</p></div><strong>${candidates.length}명</strong></header>
      <div class="notice eligible-observer-rule"><span>i</span><div><strong>현재 참관 가능한 교사만 표시합니다.</strong><p>${esc(ruleText)}</p></div></div>
      <section class="eligible-observer-section">
        <div class="eligible-observer-section-head"><div><h3>메신저 수신 대상</h3><p>아래 명단만 선택해 보내시면 됩니다.</p></div><button class="button small" type="button" onclick="copyEligibleSubjectObserverNames('${attr(classId)}', '${attr(mode)}')" ${candidates.length ? '' : 'disabled'}>이름 복사</button></div>
        ${candidateList}
      </section>
      <section class="eligible-observer-section">
        <div class="eligible-observer-section-head"><div><h3>메신저 내용</h3><p>선택한 후보 유형과 수업 정보가 자동으로 반영되었습니다.</p></div><button class="button primary small" type="button" onclick="copyEligibleSubjectObserverMessage('${attr(classId)}', '${attr(mode)}')">내용 복사</button></div>
        <pre class="eligible-observer-message">${esc(message)}</pre>
      </section>
    </section>
  </div>`);
}

function closeEligibleSubjectObservers() {
  document.getElementById('eligibleSubjectObserverModal')?.remove();
  document.body.classList.remove('login-notice-open');
}

async function copyEligibleSubjectObserverNames(classId, mode = 'subject') {
  const context = eligibleSubjectObserverContext(classId, mode);
  if (!context || !context.names.length) return showToast('복사할 참관 가능 교사가 없습니다.', true);
  await copyPlainText(context.names.join(', '));
  showToast(`${context.names.length}명의 이름을 복사했습니다.`);
}

async function copyEligibleSubjectObserverMessage(classId, mode = 'subject') {
  const context = eligibleSubjectObserverContext(classId, mode);
  if (!context) return showToast('메신저 내용을 만들 수 없습니다.', true);
  await copyPlainText(context.message);
  showToast('메신저 내용을 복사했습니다.');
}

async function updateAdminClassCapacity(classId, nextValue, teacherName) {
  const item = (state.admin?.approvedClasses || []).find(row => row.id === classId);
  if (!item) return showToast('정원을 변경할 공개수업을 찾을 수 없습니다.', true);
  const capacity = Number(nextValue);
  const currentCapacity = Number(item.capacity) || Number(state.config?.capacity) || 4;
  if (capacity === currentCapacity) return;
  const response = await mutate('adminUpdateClassCapacity', { classId, capacity }, {
    confirm: `${teacherName} 선생님 수업의 참관 정원을 ${currentCapacity}명에서 ${capacity}명으로 변경하시겠습니까?`
  });
  if (!response) render();
}

function roomLocationEntries() {
  return Object.entries(state?.roomLocations || {}).sort((left, right) => left[0].localeCompare(right[0], 'ko', { numeric: true }));
}

function openAdminRoomLocationManager() {
  document.getElementById('adminRoomLocationModal')?.remove();
  const rows = roomLocationEntries().map(([room, location]) => `${room} = ${location}`).join('\n');
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="adminRoomLocationModal" class="modal-backdrop admin-data-backdrop" role="dialog" aria-modal="true" aria-labelledby="adminRoomLocationTitle">
    <section class="login-schedule-tool-modal admin-data-modal admin-room-location-modal">
      <button class="login-application-close" type="button" onclick="closeAdminRoomLocationManager()" aria-label="교실 위치 관리 닫기">×</button>
      <header class="login-schedule-tool-head"><div><p class="eyebrow">ROOM LOCATIONS</p><h2 id="adminRoomLocationTitle">교실 위치 관리</h2><p>참관 교사가 장소를 쉽게 찾도록 교실명 뒤에 층과 본관·별관을 표시합니다.</p></div><strong>${roomLocationEntries().length}곳</strong></header>
      <div class="notice admin-room-location-example"><span>i</span><div><strong>한 줄에 한 장소씩 입력</strong><p><code>3-4 = 2층 본관</code><br><code>미래교실 = 4층 별관</code></p></div></div>
      <form class="admin-room-location-form" onsubmit="submitAdminRoomLocations(event)">
        <div class="field full"><label for="adminRoomLocations">교실·특별실 위치</label><textarea id="adminRoomLocations" rows="18" spellcheck="false" placeholder="3-4 = 2층 본관&#10;미래교실 = 4층 별관">${esc(rows)}</textarea><small>교실명은 실제 일정에 등록된 장소명과 같게 입력해 주세요. ‘3-4 교실’처럼 표시되어도 3-4 설정을 자동으로 찾아 적용합니다.</small></div>
        <div class="actions"><button class="button primary" type="submit">교실 위치 저장</button><button class="button" type="button" onclick="closeAdminRoomLocationManager()">취소</button></div>
      </form>
    </section>
  </div>`);
  document.getElementById('adminRoomLocations')?.focus();
}

function closeAdminRoomLocationManager() {
  document.getElementById('adminRoomLocationModal')?.remove();
  document.body.classList.remove('login-notice-open');
}

async function submitAdminRoomLocations(event) {
  event.preventDefault();
  const lines = value('adminRoomLocations').split(/\r?\n/);
  const locations = {};
  const invalid = [];
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const separator = line.search(/[=\t]/);
    if (separator <= 0) {
      invalid.push(index + 1);
      return;
    }
    const room = line.slice(0, separator).trim();
    const location = line.slice(separator + 1).trim();
    if (!room || !location) invalid.push(index + 1);
    else locations[room] = location;
  });
  if (invalid.length) return showToast(`${invalid.join(', ')}번째 줄을 ‘교실명 = 위치’ 형식으로 확인해 주세요.`, true);
  if (!Object.keys(locations).length) return showToast('교실 위치를 한 곳 이상 입력해 주세요.', true);
  closeAdminRoomLocationManager();
  await mutate('updateRoomLocations', { locations }, { confirm: `교실 위치 정보 ${Object.keys(locations).length}개를 저장하시겠습니까?` });
}

function openAdminPublicMessengerManager() {
  document.getElementById('adminPublicMessengerModal')?.remove();
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="adminPublicMessengerModal" class="modal-backdrop admin-data-backdrop" role="dialog" aria-modal="true" aria-labelledby="adminPublicMessengerTitle">
    <section class="login-schedule-tool-modal admin-data-modal">
      <button class="login-application-close" type="button" onclick="closeAdminPublicMessengerManager()" aria-label="공개 메신저 관리 닫기">×</button>
      <header class="login-schedule-tool-head"><div><p class="eyebrow">PUBLIC MESSENGER</p><h2 id="adminPublicMessengerTitle">공개 메신저 관리</h2><p>로그인 전 화면에 모든 교직원이 볼 수 있는 공용 안내만 등록해 주세요.</p></div><strong>${(state.messengerMessages || []).length}건</strong></header>
      <div class="notice warning admin-public-message-warning"><span>!</span><div><strong>개인 대화 등록 금지</strong><p>특정 교사와 주고받은 개인 메신저, 상담 내용, 개인정보는 등록하지 마세요.</p></div></div>
      <form class="admin-public-message-form" onsubmit="submitAdminPublicMessenger(event)">
        <div class="form-grid">
          <div class="field"><label for="publicMessengerTitle">제목</label><input id="publicMessengerTitle" maxlength="120" placeholder="예: 2학기 참관 신청 안내" required></div>
          <div class="field"><label for="publicMessengerSentAt">발송 시각</label><input id="publicMessengerSentAt" maxlength="40" placeholder="예: 2026-08-27 14:14"></div>
          <div class="field full"><label for="publicMessengerBody">공개할 메신저 내용</label><textarea id="publicMessengerBody" rows="12" maxlength="12000" placeholder="전체 교직원에게 공개해도 되는 안내문만 붙여넣어 주세요." required></textarea></div>
        </div>
        <div class="actions"><button class="button primary" type="submit">공개 메신저 추가</button></div>
      </form>
      <div class="admin-public-message-list">${renderAdminPublicMessengerList()}</div>
      <footer class="login-schedule-tool-footer"><button class="button" type="button" onclick="closeAdminPublicMessengerManager()">닫기</button></footer>
    </section>
  </div>`);
  document.getElementById('publicMessengerTitle')?.focus();
}

function renderAdminPublicMessengerList() {
  const messages = state.messengerMessages || [];
  if (!messages.length) return '<div class="login-tool-empty compact"><strong>등록된 공개 메신저가 없습니다.</strong><span>관리자가 직접 추가한 공용 안내만 로그인 화면에 표시됩니다.</span></div>';
  return messages.map((item, index) => `<article class="admin-public-message-item">
    <div><span>${index + 1}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.sentAt || '발송 시각 미입력')}</small><p>${esc(item.body).replace(/\n/g, '<br>')}</p></div></div>
    <div class="admin-public-message-actions">
      <button class="button small" type="button" onclick="moveAdminPublicMessenger('${attr(item.id)}',-1)" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="button small" type="button" onclick="moveAdminPublicMessenger('${attr(item.id)}',1)" ${index === messages.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="button danger small" type="button" onclick="deleteAdminPublicMessenger('${attr(item.id)}','${attr(item.title)}')">삭제</button>
    </div>
  </article>`).join('');
}

function closeAdminPublicMessengerManager() {
  document.getElementById('adminPublicMessengerModal')?.remove();
  document.body.classList.remove('login-notice-open');
}

async function submitAdminPublicMessenger(event) {
  event.preventDefault();
  const payload = { title: value('publicMessengerTitle'), sentAt: value('publicMessengerSentAt'), body: value('publicMessengerBody') };
  closeAdminPublicMessengerManager();
  const result = await mutate('savePublicMessengerMessage', payload);
  if (result) openAdminPublicMessengerManager();
}

async function moveAdminPublicMessenger(messageId, direction) {
  closeAdminPublicMessengerManager();
  const result = await mutate('movePublicMessengerMessage', { messageId, direction }, { silent: true });
  if (result) openAdminPublicMessengerManager();
}

async function deleteAdminPublicMessenger(messageId, title) {
  if (!window.confirm(`"${title}" 공개 메신저를 삭제하시겠습니까?`)) return;
  closeAdminPublicMessengerManager();
  const result = await mutate('deletePublicMessengerMessage', { messageId });
  if (result) openAdminPublicMessengerManager();
}

function openAdminClassEditor(classId) {
  const item = (state.admin?.approvedClasses || []).find(row => row.id === classId);
  if (!item) return showToast('변경할 공개수업을 찾을 수 없습니다.', true);
  document.getElementById('adminClassEditorModal')?.remove();
  document.body.classList.add('login-notice-open');
  document.body.insertAdjacentHTML('beforeend', `<div id="adminClassEditorModal" class="modal-backdrop admin-data-backdrop" role="dialog" aria-modal="true" aria-labelledby="adminClassEditorTitle">
    <section class="login-schedule-tool-modal admin-data-modal class-editor-modal">
      <button class="login-application-close" type="button" onclick="closeAdminClassEditor()" aria-label="일정 변경 닫기">×</button>
      <header class="login-schedule-tool-head"><div><p class="eyebrow">ADMIN SCHEDULE EDIT</p><h2 id="adminClassEditorTitle">${esc(item.teacherName)} 선생님 일정 변경</h2><p>관리자가 확정 공개수업을 직접 수정합니다. 공개수업 일정은 ${finalDateLabel()}까지 선택할 수 있습니다.</p></div></header>
      <form onsubmit="submitAdminClassEditor(event,'${attr(item.id)}')">
        <div class="form-grid admin-class-editor-grid">
          <div class="field"><label for="adminClassDate">날짜</label><input id="adminClassDate" type="date" min="${attr(today())}" max="${attr(openClassFinalDate())}" value="${attr(item.date)}" required></div>
          <div class="field"><label for="adminClassPeriod">교시</label><select id="adminClassPeriod">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}" ${Number(item.period) === index + 1 ? 'selected' : ''}>${index + 1}교시</option>`).join('')}</select></div>
          <div class="field"><label for="adminClassSubject">과목</label><input id="adminClassSubject" maxlength="80" value="${attr(item.subject || '')}" required></div>
          <div class="field"><label for="adminClassName">학급</label><input id="adminClassName" maxlength="80" value="${attr(item.className || '')}" required></div>
          <div class="field"><label for="adminClassRoom">장소</label><input id="adminClassRoom" maxlength="120" value="${attr(item.room || '')}" required></div>
          <div class="field"><label for="adminClassTopic">수업 주제</label><input id="adminClassTopic" maxlength="500" value="${attr(item.topic || '')}"></div>
          <div class="field full"><label for="adminClassNote">관리자 메모</label><input id="adminClassNote" maxlength="300" placeholder="예: 12월 일정 정정"></div>
        </div>
        <div class="actions"><button class="button primary" type="submit">변경 내용 저장</button><button class="button" type="button" onclick="closeAdminClassEditor()">취소</button></div>
      </form>
    </section>
  </div>`);
  document.getElementById('adminClassDate')?.focus();
}

function closeAdminClassEditor() {
  document.getElementById('adminClassEditorModal')?.remove();
  document.body.classList.remove('login-notice-open');
}

async function submitAdminClassEditor(event, classId) {
  event.preventDefault();
  const payload = {
    classId,
    date: value('adminClassDate'),
    period: Number(value('adminClassPeriod')),
    subject: value('adminClassSubject'),
    className: value('adminClassName'),
    room: value('adminClassRoom'),
    topic: value('adminClassTopic'),
    note: value('adminClassNote')
  };
  closeAdminClassEditor();
  await mutate('adminUpdateOpenClass', payload);
}

async function deleteAdminOpenClass(classId, teacherName) {
  const message = `${teacherName} 선생님의 2학기 공개수업을 삭제하시겠습니까?\n\n연결된 참관 신청, 변경 요청, 제출 기록, 알림도 함께 삭제되며 되돌릴 수 없습니다.`;
  await mutate('deleteOpenClass', { classId }, { confirm: message });
}

async function deleteAdminObservation(observationId, observerName, teacherName) {
  const message = `${observerName} 선생님의 ${teacherName} 선생님 수업 참관 신청만 삭제하시겠습니까?\n\n공개수업 일정은 그대로 유지됩니다.`;
  await mutate('deleteObservation', { observationId }, { confirm: message });
}

function renderAdminStatCards(a) {
  return `<div class="grid admin-stat-grid">
    ${statCard('1학기 공개 완료', a.stats.firstOpenCompleted + '명', 'CSV·관리자 수정 기준', 'first_open_complete')}
    ${statCard('2학기 공개 신청', a.stats.openClassApplied + '명', `대상 ${a.stats.targetTeachers}명`, 'second_open_applied')}
    ${statCard('연간 공개 완료', a.stats.annualOpenCompleted + '명', '1·2학기 합계', 'annual_open_complete')}
    ${statCard('참관 2회 완료', a.stats.teachersCompletedTwo + '명', '실제 참석·관리자 수정 기준', 'observation_complete')}
    ${statCard('참관 확인 대기', a.stats.attendanceUnchecked + '명', '진행 교사 확인 필요')}
  </div>`;
}

function renderReminderRecipientSettings() {
  if (!state?.actor?.isAdmin) return '';
  const recipients = (state.admin?.reminderFixedRecipients || []).join(', ');
  return `<section id="adminReminderSettings" class="card reminder-recipient-settings"><div class="card-head"><div><h3>메신저 설정</h3><p>교장, 교감, 연구부장 이름을 쉼표로 구분해 입력해 주세요. 비워 두면 고정 수신자 없이 동작합니다.</p></div></div><form class="reminder-recipient-form" onsubmit="saveReminderFixedRecipients(event)"><div class="field"><label for="reminderFixedRecipients">리마인드 고정 수신자</label><input id="reminderFixedRecipients" type="text" maxlength="1000" value="${attr(recipients)}" placeholder="교장 이름, 교감 이름, 연구부장 이름"><small>수업 리마인드의 받는 사람은 고정 수신자 → 공개 교사 → 참관인 순서이며 같은 이름은 한 번만 포함합니다. 제출자료 리마인드는 공개 교사 개인에게 보냅니다.</small></div><button class="button primary" type="submit">고정 수신자 저장</button></form></section>`;
}

async function saveReminderFixedRecipients(event) {
  event.preventDefault();
  if (!state?.actor?.isAdmin) return;
  await mutate('updateReminderFixedRecipients', { recipients: value('reminderFixedRecipients') });
}

function renderOperationPhaseControl() {
  const current = state.config.operationPhase === '수업진행' ? '준비' : (state.config.operationPhase || '전체');
  const phases = [
    ['준비', '공개수업·참관 신청을 모두 잠급니다.'],
    ['공개수업신청', '공개수업 신청만 엽니다.'],
    ['참관신청', '공개수업 메뉴를 유지하고 참관 신청도 엽니다.'],
    ['전체', '점검용으로 두 신청 메뉴를 모두 엽니다.']
  ];
  return `<section class="card phase-control"><div class="card-head"><div><p class="eyebrow">APPLICATION STEP</p><h3>현재 신청 단계</h3><p>참관신청 단계에서는 공개수업 메뉴를 그대로 유지하면서 참관 신청 메뉴를 추가로 엽니다. 공개수업 운영은 항상 사용할 수 있습니다.</p></div>${statusBadge(state.config.operationPhaseLabel)}</div><div class="phase-control-row"><div class="field"><label for="operationPhase">신청 단계 선택</label><select id="operationPhase">${phases.map(([valueText, description]) => `<option value="${attr(valueText)}" ${current === valueText ? 'selected' : ''}>${esc(valueText)} · ${esc(description)}</option>`).join('')}</select></div><button class="button primary" onclick="saveOperationPhase()">신청 단계 적용</button></div>
    <div class="deadline-control-row"><div class="field"><label for="openApplicationStart">공개수업 신청 시작일</label><input id="openApplicationStart" type="date" value="${attr(state.config.openApplicationStart || '2026-08-26')}"></div><div class="field"><label for="openApplicationDeadline">공개수업 신청 마감일</label><input id="openApplicationDeadline" type="date" value="${attr(state.config.openApplicationDeadline || '2026-08-27')}"></div><div class="field"><label for="observationApplicationStart">참관 신청 시작일</label><input id="observationApplicationStart" type="date" value="${attr(state.config.observationApplicationStart || '2026-08-27')}"></div><div class="field"><label for="observationApplicationDeadline">참관 신청 마감일</label><input id="observationApplicationDeadline" type="date" value="${attr(state.config.observationApplicationDeadline || '2026-08-31')}"></div><button class="button" onclick="saveOperationDeadlines()">신청 기간 저장</button></div>
    <p class="deadline-control-note">이 날짜는 로그인 화면의 안내에 표시됩니다. 신청 메뉴 개방 여부는 위 단계로 관리합니다. 참관신청 단계에서는 공개수업과 참관 신청을 함께 사용할 수 있고, 공개수업 운영은 수업별 일정에 맞춰 항상 열립니다.</p></section>`;
}

async function saveOperationPhase() {
  const phase = value('operationPhase');
  await mutate('updateOperationPhase', { phase }, { confirm: `신청 단계를 ‘${phase}’으로 변경하시겠습니까? 교사 화면의 신청 메뉴가 즉시 바뀝니다.` });
}

async function saveOperationDeadlines() {
  const openStart = value('openApplicationStart');
  const openDeadline = value('openApplicationDeadline');
  const observationStart = value('observationApplicationStart');
  const observationDeadline = value('observationApplicationDeadline');
  await mutate('updateOperationDeadlines', { openStart, openDeadline, observationStart, observationDeadline }, { confirm: `공개수업 신청은 ${openStart}~${openDeadline}, 참관 신청은 ${observationStart}~${observationDeadline}로 안내하시겠습니까?` });
}

function renderComciganSync(admin) {
  const sync = admin.comciganSync || {};
  const statusColor = sync.status === '오류' ? 'red' : (sync.status === '정상' || sync.status === '최신 상태' || sync.locked ? 'green' : 'amber');
  const lastSynced = sync.lastSyncedAt ? fmtDateTime(sync.lastSyncedAt) : '아직 없음';
  const sourceUpdated = sync.sourceUpdatedAt || '확인 전';
  const explanation = sync.locked
    ? '확정 PDF 시간표를 사용하고 있습니다. 컴시간 자동 동기화는 이 자료를 덮어쓰지 않습니다.'
    : `앱 사용 시 ${esc(sync.intervalMinutes || 15)}분이 지났으면 자동으로 확인합니다. 기본 시간표만 반영하며 일시적인 보강·교체 수업은 제외합니다.`;
  return `<section class="card comcigan-sync"><div class="card-head"><div><p class="eyebrow">TIMETABLE SYNC</p><h3>컴시간 시간표 연동</h3><p>${explanation}</p></div><span class="badge ${statusColor}">${esc(sync.status || '동기화 전')}</span></div>
    <div class="sync-summary"><div><small>마지막 성공</small><strong>${esc(lastSynced)}</strong></div><div><small>컴시간 원본 수정</small><strong>${esc(sourceUpdated)}</strong></div><div><small>최근 연결 결과</small><strong>교사 ${Number(sync.matchedTeachers) || 0}명 · 수업 ${Number(sync.timetableRows) || 0}건</strong></div></div>
    ${sync.error ? `<div class="notice danger"><span>!</span><div><strong>최근 연결 오류</strong><br>${esc(sync.error)}</div></div>` : ''}
    ${sync.unresolvedNames && sync.unresolvedNames.length ? `<p class="sync-unresolved">연결 보류: ${sync.unresolvedNames.map(esc).join(', ')} — 같은 마스킹 이름을 구분할 수 없거나 명단에 없는 교사는 기존 시간표를 유지합니다.</p>` : ''}
    ${sync.locked ? '<div class="notice info"><span>✓</span><div><strong>확정 시간표 보호 중</strong><br>컴시간 자료로 다시 바꾸려면 먼저 Supabase의 timetable_manual_lock 값을 false로 변경하세요.</div></div>' : '<div class="actions"><button class="button primary" onclick="syncComciganNow()">지금 시간표 동기화</button></div>'}</section>`;
}

async function syncComciganNow() {
  await mutate('syncComcigan', {}, { confirm: '컴시간(환경변수 COMCIGAN_SCHOOL_CODE에 설정한 학교)의 기본 시간표를 지금 가져와 등록된 시간표에 반영하시겠습니까?' });
}

function renderAdminAttendance(items) {
  const pastItems = items.filter(item => item.total > 0);
  const pending = pastItems.filter(item => !item.complete).length;
  const badge = `<span class="badge ${pending ? 'red' : 'green'}">${pending ? `${pending}개 수업 확인 필요` : '모두 확인 완료'}</span>`;
  const content = pastItems.length ? `<div class="table-wrap"><table><thead><tr><th>공개수업</th><th>진행 교사</th><th>참관 신청</th><th>확인 완료</th><th>실제 참석</th><th>상태</th></tr></thead><tbody>${pastItems.map(item => `<tr><td class="nowrap">${fmtDate(item.date)} ${esc(item.period)}교시</td><td><strong>${esc(item.teacherName)}</strong><br><small>${esc(item.className)}</small></td><td>${item.total}명</td><td><strong>${item.checked}/${item.total}명</strong></td><td>${item.present}명</td><td>${statusBadge(item.complete ? '확인 완료' : '확인 필요')}</td></tr>`).join('')}</tbody></table></div>` : empty('아직 확인할 지난 공개수업이 없습니다.');
  return renderAdminCollapsible('attendance-status', '참관 확인 현황', '지난 공개수업의 참석·불참 확인 상세입니다.', badge, content, pending > 0);
}

function renderAnnualStatusSection(items) {
  const filtered = getFilteredAdminStatuses(items || []);
  const content = `<div class="table-tools">
      <div class="field"><label for="adminStatusFilter">표시할 교사</label><select id="adminStatusFilter" onchange="setAdminStatusFilter(this.value)">
        <option value="all" ${adminStatusFilter === 'all' ? 'selected' : ''}>전체</option>
        <option value="complete" ${adminStatusFilter === 'complete' ? 'selected' : ''}>전체 요건 완료</option>
        <option value="first_open_complete" ${adminStatusFilter === 'first_open_complete' ? 'selected' : ''}>1학기 공개 완료</option>
        <option value="second_open_applied" ${adminStatusFilter === 'second_open_applied' ? 'selected' : ''}>2학기 공개 신청</option>
        <option value="second_open_missing" ${adminStatusFilter === 'second_open_missing' ? 'selected' : ''}>2학기 공개 미신청</option>
        <option value="annual_open_complete" ${adminStatusFilter === 'annual_open_complete' ? 'selected' : ''}>연간 공개 완료</option>
        <option value="observation_complete" ${adminStatusFilter === 'observation_complete' ? 'selected' : ''}>연간 참관 2회 완료</option>
        <option value="second_observation_complete" ${adminStatusFilter === 'second_observation_complete' ? 'selected' : ''}>2학기 참관 신청 완료</option>
        <option value="second_observation_missing" ${adminStatusFilter === 'second_observation_missing' ? 'selected' : ''}>2학기 참관 신청 미완료</option>
        <option value="open_incomplete" ${adminStatusFilter === 'open_incomplete' ? 'selected' : ''}>공개수업 미완료</option>
        <option value="observation_incomplete" ${adminStatusFilter === 'observation_incomplete' ? 'selected' : ''}>참관 미완료</option>
      </select></div>
      <div class="field"><label for="adminStatusSort">정렬</label><select id="adminStatusSort" onchange="setAdminStatusSort(this.value)">
        <option value="name" ${adminStatusSort === 'name' ? 'selected' : ''}>이름순</option>
        <option value="open_incomplete" ${adminStatusSort === 'open_incomplete' ? 'selected' : ''}>공개수업 미완료 우선</option>
        <option value="observation_incomplete" ${adminStatusSort === 'observation_incomplete' ? 'selected' : ''}>참관 미완료 우선</option>
        <option value="first_observation_desc" ${adminStatusSort === 'first_observation_desc' ? 'selected' : ''}>1학기 참관 많은순</option>
        <option value="second_observation_desc" ${adminStatusSort === 'second_observation_desc' ? 'selected' : ''}>2학기 참관 많은순</option>
      </select></div>
      <div class="field export-report-field"><label for="adminExportReport">내려받을 현황</label><select id="adminExportReport" onchange="setAdminExportReport(this.value)">
        <option value="annual" ${adminExportReport === 'annual' ? 'selected' : ''}>교사별 연간 이행 현황</option>
        <option value="disclosure" ${adminExportReport === 'disclosure' ? 'selected' : ''}>정보공시용 수업공개 계획</option>
        <option value="open_classes" ${adminExportReport === 'open_classes' ? 'selected' : ''}>공개수업 신청·일정</option>
        <option value="observations" ${adminExportReport === 'observations' ? 'selected' : ''}>참관 신청·출석</option>
        <option value="documents" ${adminExportReport === 'documents' ? 'selected' : ''}>자료 제출 현황</option>
        <option value="changes" ${adminExportReport === 'changes' ? 'selected' : ''}>일정 변경 요청</option>
      </select></div>
      <button class="button primary admin-export-action" type="button" onclick="downloadAdminWorkbook()">엑셀로 현황 내려받기</button>
      <span class="table-count">${filtered.length}명 표시</span>
    </div>
    ${filtered.length ? `<div class="table-wrap"><table class="annual-status-table"><thead><tr><th>교사</th><th>1학기 공개</th><th>2학기 공개</th><th>연간 공개</th><th>1학기 참관</th><th>2학기 참관</th><th>연간 참관</th><th>전체 요건</th><th>관리</th></tr></thead><tbody>${filtered.map(renderAnnualStatusRow).join('')}</tbody></table></div>` : empty('조건에 맞는 교사가 없습니다.')}
  `;
  return `<section id="annualStatusSection">${renderAdminCollapsible('annual-status', '교사별 연간 이행 현황', '필터·수정·엑셀 내려받기가 필요할 때 펼쳐서 확인하세요.', `<span class="badge blue">${filtered.length}명</span>`, content, false)}</section>`;
}

function renderAnnualStatusRow(item) {
  if (editingAnnualTeacherId === item.id) return renderAnnualStatusEditRow(item);
  const observationLabel = item.observationRequirementMet ? '참관 완료' : `${Math.max(0, 2 - item.annualObservationCompleted)}회 부족`;
  return `<tr>
    <td><strong>${esc(item.name)}</strong>${item.subject ? `<br><small>${esc(item.subject)}</small>` : ''}${item.manualOverride ? '<br><span class="badge amber">관리자 수정</span>' : ''}</td>
    <td>${item.firstOpenCompleted ? statusBadge('완료') : '<span class="muted">-</span>'}</td>
    <td>${statusBadge(item.secondOpenStatus)}</td>
    <td>${statusBadge(item.annualOpenCompleted ? '공개수업 완료' : '미완료')}</td>
    <td><strong>${item.firstObservationCompleted}회</strong></td>
    <td><strong>${item.secondObservationCompleted}회</strong></td>
    <td><strong>${item.annualObservationCompleted}회</strong><br>${statusBadge(observationLabel)}</td>
    <td>${statusBadge(item.allRequirementsMet ? '전체 완료' : '진행 중')}</td>
    <td><button class="button small" onclick="editAnnualStatus('${attr(item.id)}')">수정</button></td>
  </tr>`;
}

function renderAnnualStatusEditRow(item) {
  const draft = annualEditDraft?.teacherId === item.id ? annualEditDraft : annualDraftFromItem(item);
  const annualOpenCompleted = draft.firstOpenCompleted || draft.secondOpenCompleted;
  const annualObservationCompleted = draft.firstObservationCompleted + draft.secondObservationCompleted;
  const observationRequirementMet = annualObservationCompleted >= 2;
  const allRequirementsMet = annualOpenCompleted && observationRequirementMet;
  const observationLabel = observationRequirementMet ? '참관 완료' : `${Math.max(0, 2 - annualObservationCompleted)}회 부족`;
  return `<tr class="annual-edit-row" data-annual-teacher-id="${attr(item.id)}">
    <td><strong>${esc(item.name)}</strong><br><small>${esc(item.subject || '')}</small><br><span class="inline-edit-guide">리본을 눌러 수정</span></td>
    <td>${annualOpenToggle(item.id, 'firstOpenCompleted', draft.firstOpenCompleted, '완료', '미완료')}</td>
    <td>${annualOpenToggle(item.id, 'secondOpenCompleted', draft.secondOpenCompleted, '완료', '미완료')}</td>
    <td>${statusBadge(annualOpenCompleted ? '공개수업 완료' : '미완료')}</td>
    <td>${annualObservationStepper(item.id, 'firstObservationCompleted', draft.firstObservationCompleted, '1학기')}</td>
    <td>${annualObservationStepper(item.id, 'secondObservationCompleted', draft.secondObservationCompleted, '2학기')}</td>
    <td><strong>${annualObservationCompleted}회</strong><br>${statusBadge(observationLabel)}</td>
    <td>${statusBadge(allRequirementsMet ? '전체 완료' : '진행 중')}</td>
    <td><div class="annual-edit-actions"><button class="button success small" onclick="saveAnnualStatus('${attr(item.id)}')">저장</button><button class="button small" onclick="cancelAnnualStatusEdit()">취소</button>${item.manualOverride ? `<button class="annual-reset-link" onclick="resetAnnualStatus('${attr(item.id)}')">실제값 복원</button>` : ''}</div></td>
  </tr>`;
}

function annualDraftFromItem(item) {
  return {
    teacherId: item.id,
    firstOpenCompleted: Boolean(item.firstOpenCompleted),
    secondOpenCompleted: Boolean(item.secondOpenCompleted),
    firstObservationCompleted: Number(item.firstObservationCompleted) || 0,
    secondObservationCompleted: Number(item.secondObservationCompleted) || 0
  };
}

function annualOpenToggle(teacherId, field, completed, completedLabel, incompleteLabel) {
  const label = completed ? completedLabel : incompleteLabel;
  return `<button type="button" class="badge annual-status-toggle ${completed ? 'green' : 'red'}" onclick="toggleAnnualDraft('${attr(teacherId)}','${attr(field)}')" aria-label="${esc(label)}. 눌러서 변경">${esc(label)}</button>`;
}

function annualObservationStepper(teacherId, field, count, semesterLabel) {
  return `<div class="annual-count-stepper" aria-label="${esc(semesterLabel)} 참관 횟수">
    <button type="button" onclick="changeAnnualObservationDraft('${attr(teacherId)}','${attr(field)}',-1)" aria-label="${esc(semesterLabel)} 참관 횟수 줄이기" ${count <= 0 ? 'disabled' : ''}>−</button>
    <span>${count}회</span>
    <button type="button" onclick="changeAnnualObservationDraft('${attr(teacherId)}','${attr(field)}',1)" aria-label="${esc(semesterLabel)} 참관 횟수 늘리기" ${count >= 20 ? 'disabled' : ''}>＋</button>
  </div>`;
}

function getFilteredAdminStatuses(items) {
  const filtered = items.filter(item => {
    if (adminStatusFilter === 'complete') return item.allRequirementsMet;
    if (adminStatusFilter === 'first_open_complete') return item.firstOpenCompleted;
    if (adminStatusFilter === 'second_open_applied') return item.secondOpenApplied;
    if (adminStatusFilter === 'second_open_missing') return item.isSecondSemesterTarget && !item.secondOpenApplied;
    if (adminStatusFilter === 'annual_open_complete') return item.annualOpenCompleted;
    if (adminStatusFilter === 'observation_complete') return item.observationRequirementMet;
    if (adminStatusFilter === 'second_observation_complete') return item.secondObservationTarget && item.secondObservationApplicationComplete;
    if (adminStatusFilter === 'second_observation_missing') return item.secondObservationTarget && !item.secondObservationApplicationComplete;
    if (adminStatusFilter === 'open_incomplete') return !item.annualOpenCompleted;
    if (adminStatusFilter === 'observation_incomplete') return !item.observationRequirementMet;
    return true;
  });
  return filtered.sort((a, b) => {
    let result = 0;
    if (adminStatusSort === 'open_incomplete') result = Number(a.annualOpenCompleted) - Number(b.annualOpenCompleted);
    if (adminStatusSort === 'observation_incomplete') result = Number(a.observationRequirementMet) - Number(b.observationRequirementMet) || a.annualObservationCompleted - b.annualObservationCompleted;
    if (adminStatusSort === 'first_observation_desc') result = b.firstObservationCompleted - a.firstObservationCompleted;
    if (adminStatusSort === 'second_observation_desc') result = b.secondObservationCompleted - a.secondObservationCompleted;
    return result || a.name.localeCompare(b.name, 'ko');
  });
}

function setAdminStatusFilter(value) {
  adminStatusFilter = value;
  render();
}

function setAdminStatusSort(value) {
  adminStatusSort = value;
  render();
}

function setAdminExportReport(value) {
  adminExportReport = value;
}

function focusAdminStatus(filter) {
  adminStatusFilter = filter;
  adminStatusSort = 'name';
  render();
  setTimeout(() => document.getElementById('annualStatusSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

function editAnnualStatus(teacherId) {
  const item = state?.admin?.annualTeacherStatuses?.find(row => row.id === teacherId);
  if (!item) return showToast('수정할 교사를 찾을 수 없습니다.', true);
  editingAnnualTeacherId = teacherId;
  annualEditDraft = annualDraftFromItem(item);
  refreshAnnualStatusSection();
  setTimeout(() => document.querySelector(`[data-annual-teacher-id="${cssEscape(teacherId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
}

function cancelAnnualStatusEdit() {
  editingAnnualTeacherId = '';
  annualEditDraft = null;
  refreshAnnualStatusSection();
}

function toggleAnnualDraft(teacherId, field) {
  if (!annualEditDraft || annualEditDraft.teacherId !== teacherId || !['firstOpenCompleted', 'secondOpenCompleted'].includes(field)) return;
  annualEditDraft[field] = !annualEditDraft[field];
  refreshAnnualStatusSection();
}

function changeAnnualObservationDraft(teacherId, field, amount) {
  if (!annualEditDraft || annualEditDraft.teacherId !== teacherId || !['firstObservationCompleted', 'secondObservationCompleted'].includes(field)) return;
  annualEditDraft[field] = Math.max(0, Math.min(20, annualEditDraft[field] + Number(amount || 0)));
  refreshAnnualStatusSection();
}

function refreshAnnualStatusSection() {
  const section = document.getElementById('annualStatusSection');
  if (!section || !state?.admin) return render();
  section.outerHTML = renderAnnualStatusSection(state.admin.annualTeacherStatuses || []);
}

async function saveAnnualStatus(teacherId) {
  if (!annualEditDraft || annualEditDraft.teacherId !== teacherId) return showToast('수정 내용을 다시 선택해 주세요.', true);
  const payload = { ...annualEditDraft };
  const response = await mutate('updateAnnualStatusOverride', payload, { confirm: '바꾼 리본과 참관 횟수를 저장하시겠습니까?' });
  if (!response) return;
  editingAnnualTeacherId = '';
  annualEditDraft = null;
  render();
}

async function resetAnnualStatus(teacherId) {
  const response = await mutate('updateAnnualStatusOverride', { teacherId, reset: true }, { confirm: '관리자 수정값을 지우고 CSV와 실제 신청·참관 데이터 기준으로 되돌리시겠습니까?' });
  if (!response) return;
  editingAnnualTeacherId = '';
  annualEditDraft = null;
  render();
}

async function processOpen(classId, approve) {
  const note = window.prompt(approve ? '승인 메모(선택)' : '반려 사유를 입력해 주세요.', '') || '';
  if (!approve && !note.trim()) return showToast('반려 사유를 입력해 주세요.', true);
  await mutate(approve ? 'approveOpenClass' : 'rejectOpenClass', { classId, note }, { confirm: approve ? '이 공개수업을 확정하시겠습니까?' : '이 신청을 반려하시겠습니까?' });
}

function pendingOpenApprovalCheckboxes() {
  return [...document.querySelectorAll('.pending-open-checkbox')];
}

function updatePendingOpenApprovalSelection() {
  const checkboxes = pendingOpenApprovalCheckboxes();
  const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
  const count = document.getElementById('pendingOpenSelectedCount');
  const approveButton = document.getElementById('approveSelectedOpenClasses');
  const selectAll = document.getElementById('pendingOpenSelectAll');
  if (count) count.textContent = `${selectedCount}건 선택`;
  if (approveButton) approveButton.disabled = selectedCount === 0;
  if (selectAll) {
    selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  }
}

function togglePendingOpenApprovalAll(checked) {
  pendingOpenApprovalCheckboxes().forEach(checkbox => { checkbox.checked = checked; });
  updatePendingOpenApprovalSelection();
}

async function approvePendingOpenClasses(mode) {
  const pendingIds = (state?.admin?.pendingClasses || []).map(item => String(item.id));
  const classIds = mode === 'all'
    ? pendingIds
    : pendingOpenApprovalCheckboxes().filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
  if (!classIds.length) return showToast('승인할 공개수업을 선택해 주세요.', true);
  const label = mode === 'all' ? `승인 대기 ${classIds.length}건을 모두` : `선택한 ${classIds.length}건을`;
  await mutate('approveOpenClassesBulk', { classIds, note: '' }, {
    confirm: `${label} 승인하시겠습니까?\n\n시간표·학사일정·장소 충돌 검증을 통과한 신청만 확정됩니다.`
  });
}

function renderAdminChanges(changes) {
  if (!changes.length) return empty('승인 대기 중인 변경 신청이 없습니다.');
  return `<div class="table-wrap"><table class="change-request-table"><thead><tr><th>신청 교사</th><th>신청일시</th><th>기존 일정</th><th>희망 일정</th><th>사유</th><th>처리</th></tr></thead><tbody>${changes.map(item => `<tr><td><strong>${esc(item.requesterName || '교사 정보 없음')}</strong><br><small>${esc(item.requesterSubject || '교과 미분류')}</small></td><td class="application-time-cell">${esc(item.requestedAt || '기록 없음')}</td><td>${fmtDate(item.originalDate)} ${esc(item.originalPeriod)}교시<br>${esc(item.originalClass)} · ${esc(displayRoom(item.originalRoom))}</td><td>${fmtDate(item.requestedDate)} ${esc(item.requestedPeriod)}교시<br>${esc(item.requestedClass)} · ${esc(displayRoom(item.requestedRoom))}</td><td>${esc(item.reason)}</td><td class="nowrap"><button class="button success small" onclick="processChange('${attr(item.id)}',true)">승인</button> <button class="button danger small" onclick="processChange('${attr(item.id)}',false)">반려</button></td></tr>`).join('')}</tbody></table></div>`;
}

async function processChange(changeId, approve) {
  const note = window.prompt(approve ? '승인 메모(선택)' : '반려 사유를 입력해 주세요.', '') || '';
  if (!approve && !note.trim()) return showToast('반려 사유를 입력해 주세요.', true);
  await mutate('processChange', { changeId, approve, note }, { confirm: approve ? '일정 변경을 승인하시겠습니까? 충돌하는 참관 신청은 자동 취소됩니다.' : '변경 신청을 반려하시겠습니까?' });
}

function renderPaperDocuments(documents) {
  if (!documents.length) return empty('확인 대기 중인 수기 제출이 없습니다.');
  return `<div class="table-wrap"><table><thead><tr><th>제출자</th><th>자료</th><th>연결 수업</th><th>등록일</th><th></th></tr></thead><tbody>${documents.map(item => `<tr><td>${esc(item.submitterName)}</td><td>${esc(documentTypeLabel(item.type))}</td><td>${item.classInfo ? `${fmtDate(item.classInfo.date)} ${esc(item.classInfo.period)}교시 · ${esc(item.classInfo.teacherName)}` : '-'}</td><td>${esc(item.submittedAt)}</td><td><button class="button success small" onclick="confirmPaper('${attr(item.id)}')">수기 제출 확인</button></td></tr>`).join('')}</tbody></table></div>`;
}

function renderAdminDocumentCenter(a) {
  const summaries = ADMIN_DOCUMENT_TYPES.map(type => adminDocumentStats(a, type));
  const total = summaries.reduce((result, summary) => ({
    required: result.required + summary.required,
    submitted: result.submitted + summary.submitted,
    pending: result.pending + summary.pending,
    paperPending: result.paperPending + summary.paperPending
  }), { required: 0, submitted: 0, pending: 0, paperPending: 0 });
  return `<section id="adminDocumentCenter"><h3 class="section-title">제출 자료 현황</h3><div class="card">
    <div class="document-type-summary"><div><small>전체 제출 대상</small><strong>${total.required}건</strong></div><div><small>제출·등록</small><strong>${total.submitted}건</strong></div><div><small>미제출</small><strong class="${total.pending ? 'text-red' : ''}">${total.pending}건</strong></div><div><small>수기 확인 대기</small><strong>${total.paperPending}건</strong></div></div>
    <p class="document-center-note">공개수업별로 수업 지도안·수업나눔 협의록·참관록 제출 상태를 한 줄에서 비교합니다.</p>
    ${renderAdminDocuments(a.allDocuments || [], a.documentClasses || a.approvedClasses || [])}
  </div></section>`;
}

function renderAdminDocuments(documents, classes) {
  const documentByClassAndType = new Map();
  documents.forEach(item => {
    const key = `${item.classId}|${item.type}`;
    const previous = documentByClassAndType.get(key);
    if (!previous || String(item.submittedAt || '').localeCompare(String(previous.submittedAt || '')) > 0) documentByClassAndType.set(key, item);
  });
  const rows = [...classes].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || Number(left.period) - Number(right.period));
  if (!rows.length) return empty('확정된 공개수업이 없어 현재 제출 대상이 없습니다.');
  return `<div class="table-wrap admin-document-table"><table><thead><tr><th>공개 교사</th><th>공개수업 일정</th><th>수업 지도안</th><th>수업나눔 협의록</th><th>참관록</th></tr></thead><tbody>${rows.map(cls => {
    const items = ADMIN_DOCUMENT_TYPES.map(type => documentByClassAndType.get(`${cls.id}|${type}`));
    return `<tr class="${items.some(Boolean) ? '' : 'document-missing-row'}"><td><strong>${esc(cls.teacherName)}</strong><br><small>${esc(cls.subject || '')}</small></td><td><span class="badge blue">${esc(cls.semester)}학기</span> ${fmtDate(cls.date)} ${esc(cls.period)}교시<br><small>${esc(cls.className)} · ${esc(displayRoom(cls.room))}</small></td>${ADMIN_DOCUMENT_TYPES.map((type, index) => renderAdminDocumentCell(items[index], cls, type)).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderAdminDocumentCell(item, cls, type) {
  if (!item) return `<td class="admin-document-status-cell"><span class="badge red">미제출</span><div class="admin-document-cell-actions"><button class="button small" onclick="recordAdminPaperDocument('${attr(cls.id)}','${attr(type)}','${attr(cls.teacherName)}')">수기 접수</button></div></td>`;
  const file = item.fileName
    ? (item.fileUrl ? `<a class="document-file-link" href="${attr(item.fileUrl)}" target="_blank" rel="noopener">${esc(item.fileName)}</a>` : `<span class="document-file-link">${esc(item.fileName)}</span>`)
    : '';
  const action = item.status === '수기제출예정' ? `<div class="admin-document-cell-actions"><button class="button success small" onclick="confirmPaper('${attr(item.id)}')">접수 확인</button></div>` : '';
  return `<td class="admin-document-status-cell">${statusBadge(item.status)}<small>${esc(item.method || '')}${item.submittedAt ? ` · ${esc(item.submittedAt)}` : ''}</small>${file}${action}</td>`;
}

async function confirmPaper(documentId) {
  await mutate('confirmPaper', { documentId }, { confirm: '실제 수기 자료를 받은 것으로 확인하시겠습니까?' });
}

async function recordAdminPaperDocument(classId, type, teacherName) {
  await mutate('recordPaperDocument', { classId, type }, { confirm: `${teacherName} 선생님의 ${documentTypeLabel(type)}을 실제로 수기 접수한 것으로 기록하시겠습니까?` });
}

function renderMessageBuilder(classes, documentClasses = classes) {
  const sorted = sortClassesBySchedule(classes);
  const options = groupClassesByDate(sorted).map(group => `<optgroup label="${attr(fmtDate(group.date))}">${group.items.map(item => `<option value="${attr(item.id)}">${esc(item.period)}교시 · ${esc(item.teacherName)} · ${esc(item.className)} · ${esc(displayRoom(item.room))}</option>`).join('')}</optgroup>`).join('');
  const documentRows = documentReminderRows(sortClassesBySchedule(documentClasses || []));
  const documentOptions = documentRows.map(item => `<option value="${attr(item.id)}">${esc(item.semester)}학기 · ${esc(item.teacherName)} · ${fmtDate(item.date)} ${esc(item.period)}교시 · 미제출: ${esc(item.missingTypes.join(', '))}</option>`).join('');
  return `<div class="message-builder">
    <section class="message-builder-block stage"><div class="message-builder-head"><span>전체</span><div><h4>시기별 전체 안내</h4><p>신청 시작·마감 시기에 전체 교직원에게 보낼 문구입니다.</p></div></div><div class="actions message-stage-actions"><button class="button" onclick="makeMessage('openApplication')">공개수업 신청 안내</button><button class="button" onclick="makeMessage('observationApplication')">참관 신청 안내</button><button class="button" onclick="makeMessage('observationShortage')">참관 부족 안내</button></div><div class="field full stage-message-output"><label for="stageMessageText">생성된 전체 안내 문구</label><textarea id="stageMessageText" placeholder="위 안내 종류를 누르면 여기에 문구가 생성됩니다."></textarea><div class="actions"><button class="button primary" onclick="copyMessage('stageMessageText')">문구 복사</button></div></div></section>
    <section class="message-builder-block"><div class="message-builder-head"><span>1</span><div><h4>일정별 리마인드</h4><p>고정 수신자, 공개 교사, 참관인에게 준비 사항을 함께 안내합니다.</p></div></div>${sorted.length ? `<div class="form-grid"><div class="field full"><label for="messageClass">공개수업 일정</label><select id="messageClass" onchange="updateMessageRecipients()"><option value="">날짜별 일정 선택</option>${options}</select><small>날짜별로 묶고, 같은 날에는 교시순으로 표시합니다.</small></div><div class="field full"><div id="messageRecipients" class="message-recipient-preview"><span>공개수업을 선택하면 고정 수신자, 공개 교사와 참관 신청자를 보여줍니다.</span></div></div><div class="field full"><div class="actions message-type-actions"><button class="button primary" onclick="makeMessage('reminder')">수업 리마인드(준비 사항 포함)</button><button class="button" onclick="makeMessage('presenter')">공개 교사용</button><button class="button" onclick="makeMessage('observers')">참관 교사용</button><button class="button" onclick="makeMessage('attendance')">출석 확인 요청</button><button class="button" onclick="makeMessage('change')">일정 변경 안내</button></div></div><div class="field full"><label for="messageText">생성된 일정 문구</label><textarea id="messageText" placeholder="공개수업을 선택한 뒤 안내 종류를 눌러 주세요."></textarea><div class="actions"><button class="button primary" onclick="copyMessage()">문구 복사</button><button class="button" onclick="copySelectedMessageRecipients()">받는 사람 복사</button></div></div></div>` : empty('확정된 공개수업이 생기면 날짜별 일정 선택과 리마인드 문구 생성 기능이 열립니다.')}</section>
    <section class="message-builder-block document-reminder"><div class="message-builder-head"><span>2</span><div><h4>제출자료 리마인드</h4><p>지도안·협의록·참관록 중 실제 미제출 자료만 자동으로 적습니다.</p></div></div>${documentRows.length ? `<div class="form-grid"><div class="field full"><label for="documentMessageClass">미제출 교사·공개수업</label><select id="documentMessageClass" onchange="updateDocumentMessagePreview()"><option value="">교사를 선택해 주세요</option>${documentOptions}</select></div><div class="field full"><div id="documentMessagePreview" class="message-recipient-preview"><span>교사를 선택하면 받는 사람과 미제출 자료를 보여줍니다.</span></div></div><div class="field full"><div class="actions"><button class="button primary" onclick="makeDocumentReminder()">미제출 안내 만들기</button><button class="button" onclick="copyDocumentReminderRecipient()">받는 사람 복사</button></div></div><div class="field full"><label for="documentMessageText">생성된 제출자료 문구</label><textarea id="documentMessageText" placeholder="미제출 교사를 선택하고 안내 만들기를 눌러 주세요."></textarea><div class="actions"><button class="button primary" onclick="copyMessage('documentMessageText')">문구 복사</button></div></div></div>` : empty('현재 지도안·협의록·참관록을 모두 제출하여 안내할 교사가 없습니다.')}</section>
  </div>`;
}

function documentReminderRows(classes) {
  const documents = state.admin?.allDocuments || [];
  return classes.map(cls => {
    const submitted = new Set(documents.filter(doc => doc.classId === cls.id && doc.submitterId === cls.teacherId).map(doc => doc.type));
    return { ...cls, missingTypes: ADMIN_DOCUMENT_TYPES.filter(type => !submitted.has(type)) };
  }).filter(item => item.missingTypes.length);
}

function selectedDocumentReminderClass() {
  return documentReminderRows(sortClassesBySchedule(state.admin?.documentClasses || [])).find(item => item.id === value('documentMessageClass'));
}

function updateDocumentMessagePreview() {
  const element = document.getElementById('documentMessagePreview');
  if (!element) return;
  const cls = selectedDocumentReminderClass();
  element.innerHTML = cls
    ? `<strong>받는 사람: ${esc(cls.teacherName)} 선생님</strong><span>미제출: ${esc(cls.missingTypes.join(', '))}</span>`
    : '<span>교사를 선택하면 받는 사람과 미제출 자료를 보여줍니다.</span>';
}

async function makeDocumentReminder() {
  const cls = selectedDocumentReminderClass();
  if (!cls) return showToast('미제출 교사를 먼저 선택해 주세요.', true);
  setLoading(true);
  try {
    const response = await api('buildMessage', { classId: cls.id, type: 'documentReminder' });
    document.getElementById('documentMessageText').value = response.messageText;
  } catch (error) {
    showRequestError(error);
  } finally {
    setLoading(false);
  }
}

async function copyDocumentReminderRecipient() {
  const cls = selectedDocumentReminderClass();
  if (!cls) return showToast('미제출 교사를 먼저 선택해 주세요.', true);
  await copyPlainText(cls.teacherName);
  showToast(`${cls.teacherName} 선생님의 이름을 복사했습니다.`);
}

function messageRecipientsForClass(classId, type) {
  const cls = state.admin?.approvedClasses?.find(item => item.id === classId);
  if (!cls) return [];
  const observers = (state.admin?.observationApplications || []).filter(item => item.classId === classId).map(item => item.observerName);
  const fixed = (type || 'reminder') === 'reminder' ? (state.admin?.reminderFixedRecipients || []) : [];
  return [...new Set([...fixed, cls.teacherName, ...observers].map(name => String(name || '').trim()).filter(Boolean))];
}

function selectedMessageRecipients() {
  return messageRecipientsForClass(value('messageClass'), selectedMessageType);
}

function updateMessageRecipients(type = '') {
  selectedMessageType = type;
  const element = document.getElementById('messageRecipients');
  if (!element) return;
  const recipients = selectedMessageRecipients();
  element.innerHTML = recipients.length
    ? `<strong>메신저 받는 사람 ${recipients.length}명</strong><span>${recipients.map(esc).join(', ')}</span>`
    : '<span>공개수업을 선택하면 고정 수신자, 공개 교사와 참관 신청자를 보여줍니다.</span>';
}

async function copyMessageRecipients(classId, type) {
  if (!state?.actor?.isAdmin) return;
  const recipients = messageRecipientsForClass(classId, type);
  if (!recipients.length) return showToast('먼저 공개수업을 선택해 주세요.', true);
  await copyPlainText(recipients.join(', '));
  showToast(`받는 사람 ${recipients.length}명의 이름을 복사했습니다.`);
}

async function copySelectedMessageRecipients() {
  return copyMessageRecipients(value('messageClass'), selectedMessageType);
}

async function generateClassMessage(classId, type) {
  return api('buildMessage', { classId, type });
}

async function makeMessage(type) {
  if (!['reminder', 'presenter', 'observers', 'attendance', 'change', 'openApplication', 'observationApplication', 'observationShortage'].includes(type)) return;
  const classId = value('messageClass');
  const stageTypes = ['openApplication', 'observationApplication', 'observationShortage'];
  const isStageMessage = stageTypes.includes(type);
  if (!classId && !isStageMessage) return showToast('공개수업을 선택해 주세요.', true);
  setLoading(true);
  try {
    const response = await generateClassMessage(isStageMessage ? '' : classId, type);
    const output = document.getElementById(isStageMessage ? 'stageMessageText' : 'messageText');
    if (!output) throw new Error('안내 문구를 표시할 칸을 찾을 수 없습니다. 화면을 새로고침해 주세요.');
    output.value = response.messageText;
    if (!isStageMessage) updateMessageRecipients(type);
  } catch (error) {
    showRequestError(error);
  } finally {
    setLoading(false);
  }
}

async function copyMessage(textareaId = 'messageText') {
  const textarea = document.getElementById(textareaId);
  if (!textarea || !textarea.value.trim()) return showToast('먼저 안내 문구를 생성해 주세요.', true);
  await copyPlainText(textarea.value, textarea);
  showToast('안내 문구를 복사했습니다.');
}

async function copyPlainText(text, fallbackElement = null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    const helper = fallbackElement || document.createElement('textarea');
    if (!fallbackElement) {
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
    }
    helper.select();
    document.execCommand('copy');
    if (!fallbackElement) helper.remove();
  }
}

function renderShortages(items) {
  if (!items.length) return empty('모든 교사가 실제 참관 2회를 완료했습니다.');
  return `<div class="table-wrap"><table><thead><tr><th>교사</th><th>신청</th><th>실제 참관</th><th>부족</th></tr></thead><tbody>${items.map(item => `<tr><td>${esc(item.name)}</td><td>${item.applied}회</td><td>${item.completed}회</td><td><span class="badge red">${Math.max(0, 2 - item.completed)}회</span></td></tr>`).join('')}</tbody></table></div>`;
}

async function importCsv() {
  const input = document.getElementById('legacyCsv');
  const file = input && input.files ? input.files[0] : null;
  if (!file) return showToast('CSV 파일을 선택해 주세요.', true);
  const csvText = await readFileAsText(file);
  await mutate('importFirstSemesterCsv', { csvText }, { confirm: 'CSV의 1학기 공개수업·참관 실적과 2학기 대상 여부를 반영하시겠습니까? 같은 파일을 다시 올려도 중복 저장되지 않습니다.' });
}

function renderPresenterObserverContacts(item) {
  const contacts = item.observerContacts || [];
  if (!contacts.length) return '<div class="presenter-observers empty-observers"><strong>참관 교사</strong><span>등록된 참관인이 없습니다.</span></div>';
  return `<div class="presenter-observers"><div class="presenter-observers-head"><strong>참관 교사 ${contacts.length}명</strong></div><div class="presenter-observer-list">${contacts.map(contact => `<span>${esc(contact.name)} <small>${esc(contact.subject)}</small></span>`).join('')}</div></div>`;
}

function lessonCard(item, right, extra = '') {
  const observerMeta = Number.isFinite(Number(item.observerCount)) ? `<span>참관 ${item.observerCount}${item.capacity ? '/' + item.capacity : ''}명</span>` : '';
  const hasApplicationTime = Number(item.semester) === 2 && Object.prototype.hasOwnProperty.call(item, 'appliedAt');
  const applicationMeta = hasApplicationTime ? `<span class="lesson-application-time">신청일시 ${esc(item.appliedAt || '기록 없음')}</span>` : '';
  return `<div class="lesson-card"><div class="lesson-top"><div><h4 class="lesson-title">${esc(item.teacherName || state.actor.name)} 선생님 · ${esc(item.subject || '과목 미입력')}</h4><div class="lesson-meta"><span>${esc(item.semester || 2)}학기</span><span>${fmtDate(item.date)} ${esc(item.period)}교시</span><span>${esc(item.className)}</span><span>${esc(displayRoom(item.room))}</span>${observerMeta}${applicationMeta}</div></div>${right || ''}</div>${item.topic ? `<p class="lesson-topic">${esc(item.topic)}</p>` : ''}${extra}</div>`;
}

function sortClassesBySchedule(classes) {
  return [...(classes || [])].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || Number(left.period || 0) - Number(right.period || 0) || String(left.teacherName || '').localeCompare(String(right.teacherName || ''), 'ko'));
}

function groupClassesByDate(classes) {
  return sortClassesBySchedule(classes).reduce((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
    return groups;
  }, []);
}

function renderClassesByDate(classes, renderItem, reverseDates = false) {
  const groups = groupClassesByDate(classes);
  if (reverseDates) groups.reverse();
  return `<div class="dated-class-list">${groups.map(group => `<section class="dated-class-group"><div class="dated-class-heading"><strong>${esc(fmtDate(group.date))}</strong><span>수업 ${group.items.length}건</span></div><div class="lesson-list">${group.items.map(renderItem).join('')}</div></section>`).join('')}</div>`;
}

function timetableOptions() {
  return state.myTimetable.map(item => `<option value="${attr(item.id)}" data-room="${attr(item.room)}">${esc(item.weekday)}요일 ${esc(item.period)}교시 · ${esc(item.className)} · ${esc(item.subject || '과목 미입력')}</option>`).join('');
}

function syncTimetableRoom(selectId, roomId) {
  const select = document.getElementById(selectId);
  const room = document.getElementById(roomId);
  if (select && room && select.selectedOptions[0]) room.value = select.selectedOptions[0].dataset.room || '';
}

function normalizedRoomKey(value) {
  return String(value || '').trim().replace(/\s*교실$/, '').trim();
}

function roomLocationFor(room) {
  const raw = String(room || '').trim();
  if (!raw) return '';
  if (/\(\s*\d층\s*(?:본관|별관)\s*\)$/.test(raw)) return '';
  const locations = state?.roomLocations || loginOptions?.roomLocations || {};
  const normalized = normalizedRoomKey(raw);
  if (locations[raw]) return String(locations[raw]).trim();
  if (locations[normalized]) return String(locations[normalized]).trim();
  const specialMatch = Object.entries(locations).find(([key]) => !/^\d+-\d+$/.test(key) && normalized.includes(key));
  return specialMatch ? String(specialMatch[1]).trim() : '';
}

function displayRoom(room, fallback = '장소 미입력') {
  const raw = String(room || '').trim();
  if (!raw) return fallback;
  const location = roomLocationFor(raw);
  return location ? `${raw} (${location})` : raw;
}

function statusBadge(status) {
  const text = status || '미확인';
  let color = 'blue';
  if (['확정', '참석', '승인', '온라인제출', '수기제출확인', '완료', '공개수업 완료', '참관 완료', '전체 완료', '실적 반영'].includes(text)) color = 'green';
  else if (['승인대기', '미확인', '수기제출예정', '진행 중'].includes(text)) color = 'amber';
  else if (['반려', '취소', '일정변경취소', '불참', '미완료', '미제출'].includes(text) || text.endsWith('회 부족')) color = 'red';
  return `<span class="badge ${color}">${esc(text)}</span>`;
}

function empty(message) { return `<div class="empty">${esc(message)}</div>`; }
function value(id) { const element = document.getElementById(id); return element ? element.value.trim() : ''; }
function readStoredSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('school_open_class_session') || 'null');
    if (!parsed || !['teacher', 'admin'].includes(parsed.actorType)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}
function storeSession() { sessionStorage.setItem('school_open_class_session', JSON.stringify(userSession)); }
function today() { const date = new Date(); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function todayKst() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function pad(value) { return String(value).padStart(2, '0'); }
function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function fmtDate(text) {
  if (!text) return '-';
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${month}월 ${day}일(${['일', '월', '화', '수', '목', '금', '토'][date.getDay()]})`;
}
function fmtDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function shortDate(text) {
  if (!text) return '-';
  const [, month, day] = text.split('-').map(Number);
  return `${month}/${day}`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function attr(value) { return esc(value); }
function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('CSV 파일을 읽지 못했습니다.'));
    reader.readAsText(file, 'UTF-8');
  });
}

function setLoading(show) {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.toggle('show', show);
    loading.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
}
function showToast(message, error = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4200);
}
function showRequestError(error) {
  showToast(error.message, true);
  if (error.code !== 'SERVER_DELAY') return;
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  if (toast) toast.innerHTML = `${esc(error.message)} <button class="button small" type="button" onclick="retryApp()">다시 시도</button>`;
}
function renderFatal(message) {
  const delayed = String(message || '').startsWith('서버 응답이 늦습니다');
  document.getElementById('root').innerHTML = `<div class="fatal"><h2>${delayed ? '서버 응답이 늦습니다' : '앱을 시작할 수 없습니다.'}</h2><p>${esc(message)}</p><p class="muted">${delayed ? '잠시 후 다시 시도해 주세요.' : '관리자는 Vercel의 Supabase 환경변수와 Supabase의 teachers 교사 명단을 확인해 주세요.'}</p><div class="actions"><button class="button primary" onclick="retryApp()">다시 시도</button><button class="button" onclick="signOut()">처음 화면으로</button></div></div>`;
}

