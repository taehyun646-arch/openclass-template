function mockDb(seed = {}) {
  const tables = structuredClone(seed), calls = []; let active = 0, peak = 0;
  function from(table) {
    const q = { filters: [], operation: 'select', first: 0, last: Infinity };
    const b = {
      select(_c, o = {}) { q.head = !!o.head; q.count = o.count; return this; },
      order(c, o = {}) { q.order = c; q.ascending = o.ascending !== false; return this; },
      range(a, z) { q.first = a; q.last = z; return this; },
      eq(c, v) { q.filters.push(r => r[c] === v); return this; },
      gte(c, v) { q.filters.push(r => r[c] >= v); return this; },
      is(c, v) { q.filters.push(r => (r[c] ?? null) === v); return this; },
      in(c, v) { q.filters.push(r => v.includes(r[c])); return this; },
      upsert(v) { q.operation = 'upsert'; q.values = Array.isArray(v) ? v : [v]; return this; },
      update(v) { q.operation = 'update'; q.values = v; return this; },
      insert(v) { q.operation = 'insert'; q.values = v; return this; },
      maybeSingle() { q.single = true; return this; }, single() { q.single = true; return this; },
      then(resolve, reject) {
        const c = { table, operation: q.operation, head: !!q.head, first: q.first, returned: 0, written: 0 };
        calls.push(c); active++; peak = Math.max(peak, active);
        return new Promise(done => setTimeout(done, q.first ? 0 : 3)).then(() => {
          active--; tables[table] ||= [];
          let rows = tables[table].filter(r => q.filters.every(f => f(r)));
          if (q.operation === 'upsert') {
            c.written = q.values.length;
            q.values.forEach(r => { const old = tables[table].find(i => i.dedupe_key === r.dedupe_key); if (old) Object.assign(old, structuredClone(r)); else tables[table].push({ id: `generated-${tables[table].length}`, ...structuredClone(r) }); });
            return { data: null, error: null };
          }
          if (q.operation === 'update') { c.written = rows.length; rows.forEach(r => Object.assign(r, structuredClone(q.values))); return { error: null }; }
          if (q.operation === 'insert') return { error: null };
          if (q.order) rows.sort((a, b) => String(a[q.order] ?? '').localeCompare(String(b[q.order] ?? '')) * (q.ascending ? 1 : -1));
          const count = rows.length; rows = q.head ? [] : rows.slice(q.first, q.last + 1); c.returned = rows.length;
          return { data: q.head ? null : structuredClone(q.single ? rows[0] || null : rows), count: q.count === 'exact' ? count : null, error: null };
        }).then(resolve, reject);
      }
    }; return b;
  }
  return { from, tables, calls, rpc: async (name, payload) => { calls.push({ operation: 'rpc', name, payload, returned: 0 }); return { error: null, data: {} }; }, metrics: () => ({ requests: calls.length, rows: calls.reduce((n, c) => n + c.returned, 0), upserts: calls.filter(c => c.operation === 'upsert').length, peak }), reset() { calls.length = 0; peak = 0; } };
}
const actor = { id: 'admin', name: '관리자', isAdmin: true };
function fixture() {
  const dates = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
  return {
    teachers: [{ id: 'admin', name: '관리자', role: '관리자', active: true }, { id: 'presenter', name: '김교사', role: '교사', active: true, subject_group: '영어' }, { id: 'observer', name: '이교사', role: '교사', active: true, subject_group: '수학' }],
    timetables: [{ id: 'base', teacher_id: 'presenter', weekday: '월', period: 1, class_name: '1-1', active: true }],
    weekly_timetables: dates.flatMap((date, week) => Array.from({ length: week ? 1000 : 873 }, (_, i) => ({ id: `${week}-${String(i).padStart(4, '0')}`, teacher_id: 'observer', lesson_date: date, period: i % 8 + 1, subject: '수학', class_name: '2-1' }))),
    blocked_dates: [{ id: 'blocked', active: false, blocked_date: '2026-07-01', period: null }],
    open_classes: ['2026-09-28', '2026-10-12', '2026-10-19'].map((date, i) => ({ id: `class-${i}`, teacher_id: 'presenter', class_date: date, weekday: '월', period: 1, class_name: '1-1', subject: '영어', room: '영어실', semester: 2, status: '확정', capacity: 4 })),
    observations: [0, 1, 2].map(i => ({ id: `obs-${i}`, class_id: `class-${i}`, observer_id: 'observer', semester: 2, status: '확정', attendance: '미확인' })),
    documents: [{ id: 'document', class_id: 'class-0', submitter_id: 'presenter', document_type: '지도안', status: '온라인제출', submitted_at: '2026-09-27' }],
    change_requests: [{ id: 'change', class_id: 'class-1', requester_id: 'presenter', status: '승인대기', requested_date: '2026-10-19', requested_weekday: '월', requested_period: 1, requested_class_name: '1-1', requested_room: '영어실', requested_at: '2026-10-12' }],
    app_settings: [{ setting_key: 'school_year', setting_value: '2026' }], notifications: []
  };
}
module.exports = { mockDb, fixture, actor };
