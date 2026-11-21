-- 수업공개·참관 관리 웹앱 데이터베이스 구조
-- 새 Supabase 프로젝트의 SQL Editor에 전체를 붙여 넣고 한 번 실행하세요.
-- 실행 후 seed_settings.sql 을 이어서 실행합니다.
-- 모든 테이블은 RLS가 켜져 있고 정책이 없으므로 브라우저(anon key)에서는 직접 읽을 수 없습니다.
-- 웹앱 서버(Vercel)가 secret key로만 접근합니다.

create extension if not exists pgcrypto;

create table if not exists public.teachers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  subject_group text default '교과 미분류'::text not null,
  role text default '일반교사'::text not null,
  second_semester_target boolean default false not null,
  exclusion_reason text default ''::text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.app_settings (
  setting_key text not null,
  setting_value text not null,
  description text default ''::text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.timetables (
  id uuid default gen_random_uuid() not null,
  teacher_id uuid not null,
  weekday text not null,
  period integer not null,
  class_name text not null,
  room text default ''::text not null,
  subject text default ''::text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  open_class_eligible boolean default true not null
);

create table if not exists public.weekly_timetables (
  id uuid default gen_random_uuid() not null,
  week_start date not null,
  lesson_date date not null,
  teacher_id uuid not null,
  weekday text not null,
  period integer not null,
  class_name text not null,
  room text default ''::text not null,
  subject text default ''::text not null,
  is_modified boolean default false not null,
  original_class_name text default ''::text not null,
  original_subject text default ''::text not null,
  source_updated_at text default ''::text not null,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.blocked_dates (
  id uuid default gen_random_uuid() not null,
  teacher_id uuid,
  blocked_date date not null,
  period integer,
  reason text default ''::text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.open_classes (
  id uuid default gen_random_uuid() not null,
  teacher_id uuid not null,
  class_date date not null,
  weekday text not null,
  period integer not null,
  subject text default ''::text not null,
  class_name text not null,
  room text not null,
  topic text default ''::text not null,
  capacity integer default 4 not null,
  status text default '승인대기'::text not null,
  submitted_at timestamp with time zone default now() not null,
  processed_by uuid,
  processed_at timestamp with time zone,
  admin_note text default ''::text not null,
  semester integer default 2 not null,
  source text default '앱'::text not null,
  source_key text default ''::text not null
);

create table if not exists public.observations (
  id uuid default gen_random_uuid() not null,
  class_id uuid not null,
  observer_id uuid not null,
  applied_at timestamp with time zone default now() not null,
  status text default '확정'::text not null,
  canceled_at timestamp with time zone,
  attendance text default '미확인'::text not null,
  attendance_checked_by uuid,
  attendance_checked_at timestamp with time zone,
  note text default ''::text not null,
  semester integer default 2 not null,
  source text default '앱'::text not null,
  source_key text default ''::text not null
);

create table if not exists public.documents (
  id uuid default gen_random_uuid() not null,
  class_id uuid not null,
  document_type text not null,
  submitter_id uuid not null,
  submission_method text not null,
  file_name text default ''::text not null,
  file_path text default ''::text not null,
  status text not null,
  submitted_at timestamp with time zone default now() not null,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  note text default ''::text not null
);

create table if not exists public.change_requests (
  id uuid default gen_random_uuid() not null,
  class_id uuid not null,
  requester_id uuid not null,
  original_date date not null,
  original_period integer not null,
  original_class_name text not null,
  original_room text not null,
  requested_date date not null,
  requested_weekday text not null,
  requested_period integer not null,
  requested_class_name text not null,
  requested_room text not null,
  requested_subject text default ''::text not null,
  requested_timetable_id uuid,
  reason text not null,
  status text default '승인대기'::text not null,
  requested_at timestamp with time zone default now() not null,
  processed_by uuid,
  processed_at timestamp with time zone,
  admin_note text default ''::text not null,
  affected_observers text default ''::text not null
);

create table if not exists public.notifications (
  id uuid default gen_random_uuid() not null,
  teacher_id uuid not null,
  notification_type text not null,
  severity text default 'info'::text not null,
  title text not null,
  message text not null,
  class_id uuid,
  observation_id uuid,
  action_tab text default ''::text not null,
  dedupe_key text not null,
  metadata jsonb default '{}'::jsonb not null,
  read_at timestamp with time zone,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  actor_id uuid,
  actor_name text default ''::text not null,
  action text not null,
  target_type text default ''::text not null,
  target_id text default ''::text not null,
  detail jsonb default '{}'::jsonb not null
);

alter table public.teachers add constraint teachers_pkey PRIMARY KEY (id);
alter table public.app_settings add constraint app_settings_pkey PRIMARY KEY (setting_key);
alter table public.timetables add constraint timetables_pkey PRIMARY KEY (id);
alter table public.weekly_timetables add constraint weekly_timetables_pkey PRIMARY KEY (id);
alter table public.blocked_dates add constraint blocked_dates_pkey PRIMARY KEY (id);
alter table public.open_classes add constraint open_classes_pkey PRIMARY KEY (id);
alter table public.observations add constraint observations_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.change_requests add constraint change_requests_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id);
alter table public.weekly_timetables add constraint weekly_timetables_week_start_teacher_id_lesson_date_period__key UNIQUE (week_start, teacher_id, lesson_date, period, class_name);
alter table public.documents add constraint documents_class_id_document_type_submitter_id_key UNIQUE (class_id, document_type, submitter_id);
alter table public.notifications add constraint notifications_dedupe_key_key UNIQUE (dedupe_key);
alter table public.teachers add constraint teachers_role_check CHECK ((role = ANY (ARRAY['일반교사'::text, '관리자'::text])));
alter table public.timetables add constraint timetables_period_check CHECK (((period >= 1) AND (period <= 20)));
alter table public.timetables add constraint timetables_weekday_check CHECK ((weekday = ANY (ARRAY['월'::text, '화'::text, '수'::text, '목'::text, '금'::text, '토'::text, '일'::text])));
alter table public.weekly_timetables add constraint weekly_timetables_period_check CHECK (((period >= 1) AND (period <= 12)));
alter table public.blocked_dates add constraint blocked_dates_period_check CHECK (((period IS NULL) OR ((period >= 1) AND (period <= 20))));
alter table public.open_classes add constraint open_classes_capacity_check CHECK (((capacity >= 1) AND (capacity <= 20)));
alter table public.open_classes add constraint open_classes_period_check CHECK (((period >= 1) AND (period <= 20)));
alter table public.open_classes add constraint open_classes_semester_check CHECK ((semester = ANY (ARRAY[1, 2])));
alter table public.open_classes add constraint open_classes_status_check CHECK ((status = ANY (ARRAY['승인대기'::text, '확정'::text, '반려'::text, '취소'::text])));
alter table public.open_classes add constraint open_classes_weekday_check CHECK ((weekday = ANY (ARRAY['월'::text, '화'::text, '수'::text, '목'::text, '금'::text, '토'::text, '일'::text])));
alter table public.observations add constraint observations_attendance_check CHECK ((attendance = ANY (ARRAY['미확인'::text, '참석'::text, '불참'::text])));
alter table public.observations add constraint observations_semester_check CHECK ((semester = ANY (ARRAY[1, 2])));
alter table public.observations add constraint observations_status_check CHECK ((status = ANY (ARRAY['확정'::text, '취소'::text, '일정변경취소'::text])));
alter table public.documents add constraint documents_document_type_check CHECK ((document_type = ANY (ARRAY['지도안'::text, '참관록'::text, '협의록'::text])));
alter table public.documents add constraint documents_status_check CHECK ((status = ANY (ARRAY['온라인제출'::text, '수기제출예정'::text, '수기제출확인'::text])));
alter table public.documents add constraint documents_submission_method_check CHECK ((submission_method = ANY (ARRAY['온라인'::text, '수기'::text])));
alter table public.change_requests add constraint change_requests_status_check CHECK ((status = ANY (ARRAY['승인대기'::text, '승인'::text, '반려'::text])));
alter table public.notifications add constraint notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'danger'::text])));

alter table public.timetables add constraint timetables_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.weekly_timetables add constraint weekly_timetables_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.blocked_dates add constraint blocked_dates_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.open_classes add constraint open_classes_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.teachers(id);
alter table public.open_classes add constraint open_classes_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id);
alter table public.observations add constraint observations_attendance_checked_by_fkey FOREIGN KEY (attendance_checked_by) REFERENCES public.teachers(id);
alter table public.observations add constraint observations_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.open_classes(id) ON DELETE CASCADE;
alter table public.observations add constraint observations_observer_id_fkey FOREIGN KEY (observer_id) REFERENCES public.teachers(id);
alter table public.documents add constraint documents_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.open_classes(id) ON DELETE CASCADE;
alter table public.documents add constraint documents_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.teachers(id);
alter table public.documents add constraint documents_submitter_id_fkey FOREIGN KEY (submitter_id) REFERENCES public.teachers(id);
alter table public.change_requests add constraint change_requests_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.open_classes(id) ON DELETE CASCADE;
alter table public.change_requests add constraint change_requests_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.teachers(id);
alter table public.change_requests add constraint change_requests_requested_timetable_id_fkey FOREIGN KEY (requested_timetable_id) REFERENCES public.timetables(id);
alter table public.change_requests add constraint change_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.teachers(id);
alter table public.notifications add constraint notifications_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.open_classes(id) ON DELETE SET NULL;
alter table public.notifications add constraint notifications_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.observations(id) ON DELETE SET NULL;
alter table public.notifications add constraint notifications_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.audit_logs add constraint audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.teachers(id);

CREATE INDEX IF NOT EXISTS documents_submitter_idx ON public.documents USING btree (submitter_id, class_id);
CREATE INDEX IF NOT EXISTS notifications_class_id_idx ON public.notifications USING btree (class_id);
CREATE INDEX IF NOT EXISTS notifications_observation_id_idx ON public.notifications USING btree (observation_id);
CREATE INDEX IF NOT EXISTS notifications_teacher_active_idx ON public.notifications USING btree (teacher_id, created_at DESC) WHERE (resolved_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS observations_active_unique ON public.observations USING btree (class_id, observer_id) WHERE (status = '확정'::text);
CREATE INDEX IF NOT EXISTS observations_class_idx ON public.observations USING btree (class_id, status);
CREATE INDEX IF NOT EXISTS observations_observer_idx ON public.observations USING btree (observer_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS observations_source_unique ON public.observations USING btree (source, source_key) WHERE (source_key <> ''::text);
CREATE UNIQUE INDEX IF NOT EXISTS open_classes_confirmed_room_slot_uq ON public.open_classes USING btree (class_date, period, lower(btrim(room))) WHERE (status = '확정'::text);
CREATE INDEX IF NOT EXISTS open_classes_date_idx ON public.open_classes USING btree (class_date, period, status);
CREATE UNIQUE INDEX IF NOT EXISTS open_classes_source_unique ON public.open_classes USING btree (source, source_key) WHERE (source_key <> ''::text);
CREATE INDEX IF NOT EXISTS timetables_teacher_idx ON public.timetables USING btree (teacher_id, weekday, period) WHERE active;
CREATE INDEX IF NOT EXISTS weekly_timetables_teacher_week_idx ON public.weekly_timetables USING btree (teacher_id, week_start, lesson_date, period);

-- 학교별 공개수업 마지막 날짜: app_settings의 open_class_final_date 값을 읽고, 없으면 기본값을 씁니다.
create or replace function public.open_class_final_date()
 returns date
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(
    (select case when s.setting_value ~ '^\d{4}-\d{2}-\d{2}$' then s.setting_value::date end
       from public.app_settings s where s.setting_key = 'open_class_final_date'),
    date '2026-11-30'
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_open_class_atomic(p_class_id uuid, p_admin_id uuid, p_date date, p_period integer, p_subject text, p_class_name text, p_room text, p_topic text DEFAULT ''::text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.open_classes%rowtype;
  v_observation record;
  v_old_summary text;
  v_new_summary text;
  v_observer_count integer := 0;
begin
  select * into v_class
  from public.open_classes
  where id = p_class_id
  for update;

  if not found or v_class.status <> '확정' or v_class.semester <> 2 then
    raise exception '변경할 확정 공개수업을 찾을 수 없습니다.';
  end if;
  if p_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception '지난 날짜로는 변경할 수 없습니다.';
  end if;
  if p_date > public.open_class_final_date() then
    raise exception '2학기 공개수업 일정은 %까지만 등록할 수 있습니다.', to_char(public.open_class_final_date(), 'FMMM"월" FMDD"일"');
  end if;
  if p_period < 1 or p_period > 8 then
    raise exception '교시는 1교시부터 8교시 사이로 선택해 주세요.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat(p_date, '|', p_period, '|', lower(btrim(p_room))), 0
  ));
  if exists (
    select 1 from public.open_classes c
    where c.id <> v_class.id
      and c.status = '확정'
      and c.class_date = p_date
      and c.period = p_period
      and lower(btrim(c.room)) = lower(btrim(p_room))
  ) then
    raise exception '같은 시간과 장소에 이미 다른 공개수업이 있습니다.';
  end if;

  v_old_summary := concat(v_class.class_date, ' ', v_class.period, '교시 · ', v_class.class_name, ' · ', v_class.room);
  v_new_summary := concat(p_date, ' ', p_period, '교시 · ', p_class_name, ' · ', p_room);

  update public.open_classes
  set class_date = p_date,
      weekday = case extract(isodow from p_date)
        when 1 then '월' when 2 then '화' when 3 then '수' when 4 then '목' when 5 then '금'
        when 6 then '토' else '일' end,
      period = p_period,
      subject = btrim(p_subject),
      class_name = btrim(p_class_name),
      room = btrim(p_room),
      topic = coalesce(btrim(p_topic), ''),
      processed_by = p_admin_id,
      processed_at = now(),
      admin_note = coalesce(nullif(btrim(p_note), ''), '관리자 직접 일정 변경')
  where id = v_class.id;

  for v_observation in
    select o.id, o.observer_id
    from public.observations o
    where o.class_id = v_class.id and o.status = '확정'
    for update
  loop
    v_observer_count := v_observer_count + 1;
    insert into public.notifications (
      teacher_id, notification_type, severity, title, message, class_id, observation_id,
      action_tab, dedupe_key, metadata, read_at, resolved_at, updated_at
    ) values (
      v_observation.observer_id,
      '일정변경',
      'warning',
      '참관 수업 일정이 변경되었습니다',
      concat(v_old_summary, '에서 ', v_new_summary, '으로 변경되었습니다. 참관 신청은 그대로 유지됩니다.'),
      v_class.id,
      v_observation.id,
      'observe',
      concat('admin-change:', v_class.id, ':', p_date, ':', p_period, ':observer:', v_observation.observer_id),
      jsonb_build_object('old', v_old_summary, 'new', v_new_summary, 'canceled', false, 'changed_by_admin', true),
      null,
      null,
      now()
    )
    on conflict (dedupe_key) do update set
      notification_type = excluded.notification_type,
      severity = excluded.severity,
      title = excluded.title,
      message = excluded.message,
      class_id = excluded.class_id,
      observation_id = excluded.observation_id,
      action_tab = excluded.action_tab,
      metadata = excluded.metadata,
      read_at = null,
      resolved_at = null,
      updated_at = now();
  end loop;

  return jsonb_build_object('class_id', v_class.id, 'observer_count', v_observer_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_observations_atomic(p_teacher_id uuid, p_class_ids uuid[])
 RETURNS TABLE(observation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phase text;
  v_class_id uuid;
  v_ids uuid[];
  v_class public.open_classes%rowtype;
  v_current_count integer;
  v_capacity_count integer;
  v_observation_id uuid;
begin
  select setting_value into v_phase from public.app_settings where setting_key = 'operation_phase';
  if coalesce(v_phase, '전체') not in ('참관신청', '전체') then
    raise exception '현재는 참관 신청 기간이 아닙니다.';
  end if;

  if not exists (select 1 from public.teachers where id = p_teacher_id and active and role <> '관리자') then
    raise exception '활성 교사를 찾을 수 없습니다.';
  end if;

  select array_agg(distinct requested_id order by requested_id)
    into v_ids
  from unnest(coalesce(p_class_ids, array[]::uuid[])) as requested_id
  where not exists (
    select 1 from public.observations o
    where o.class_id = requested_id and o.observer_id = p_teacher_id and o.status = '확정'
  );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '선택한 수업은 이미 신청되어 있습니다.';
  end if;

  select count(*) into v_current_count
  from public.observations
  where observer_id = p_teacher_id and status = '확정';
  if v_current_count + array_length(v_ids, 1) < 2 then
    raise exception '참관 신청은 현재 신청 횟수를 포함해 2회 이상 선택해야 합니다.';
  end if;

  perform 1 from public.open_classes where id = any(v_ids) order by id for update;

  foreach v_class_id in array v_ids loop
    select * into v_class from public.open_classes where id = v_class_id;
    if not found then raise exception '존재하지 않는 공개수업입니다.'; end if;
    if v_class.semester <> 2 or v_class.status <> '확정' then raise exception '확정된 2학기 수업만 신청할 수 있습니다.'; end if;
    if v_class.class_date < (now() at time zone 'Asia/Seoul')::date then raise exception '이미 지난 수업은 신청할 수 없습니다.'; end if;
    if v_class.teacher_id = p_teacher_id then raise exception '자신의 공개수업은 참관할 수 없습니다.'; end if;

    select count(*) into v_capacity_count from public.observations where class_id = v_class_id and status = '확정';
    if v_capacity_count >= v_class.capacity then raise exception '참관 정원이 모두 찬 수업이 포함되어 있습니다.'; end if;

    if exists (
      select 1 from public.timetables t
      where t.teacher_id = p_teacher_id and t.active and t.weekday = v_class.weekday and t.period = v_class.period
    ) then raise exception '본인의 수업 시간표와 겹치는 수업이 포함되어 있습니다.'; end if;

    if exists (
      select 1 from public.blocked_dates b
      where b.active and (b.teacher_id is null or b.teacher_id = p_teacher_id)
        and b.blocked_date = v_class.class_date and (b.period is null or b.period = v_class.period)
    ) then raise exception '신청 불가 일정과 겹치는 수업이 포함되어 있습니다.'; end if;

    if exists (
      select 1 from public.open_classes own_class
      where own_class.teacher_id = p_teacher_id and own_class.status in ('승인대기', '확정')
        and own_class.class_date = v_class.class_date and own_class.period = v_class.period
    ) then raise exception '본인의 공개수업 일정과 겹칩니다.'; end if;

    if exists (
      select 1 from public.observations o
      join public.open_classes c on c.id = o.class_id
      where o.observer_id = p_teacher_id and o.status = '확정'
        and c.class_date = v_class.class_date and c.period = v_class.period
    ) then raise exception '이미 신청한 다른 참관 일정과 시간이 겹칩니다.'; end if;
  end loop;

  foreach v_class_id in array v_ids loop
    v_observation_id := gen_random_uuid();
    insert into public.observations (id, class_id, observer_id, semester, source)
    values (v_observation_id, v_class_id, p_teacher_id, 2, '앱');
    observation_id := v_observation_id;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_observations_with_override_atomic(p_teacher_id uuid, p_class_ids uuid[], p_allow_timetable_conflict_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS TABLE(observation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phase text;
  v_class_id uuid;
  v_ids uuid[];
  v_class public.open_classes%rowtype;
  v_current_count integer;
  v_capacity_count integer;
  v_observation_id uuid;
  v_allow_timetable_conflict boolean;
begin
  select setting_value into v_phase from public.app_settings where setting_key = 'operation_phase';
  if coalesce(v_phase, '전체') not in ('참관신청', '전체') then
    raise exception '현재는 참관 신청 기간이 아닙니다.';
  end if;

  if not exists (select 1 from public.teachers where id = p_teacher_id and active and role <> '관리자') then
    raise exception '활성 교사를 찾을 수 없습니다.';
  end if;

  select array_agg(distinct requested_id order by requested_id)
    into v_ids
  from unnest(coalesce(p_class_ids, array[]::uuid[])) as requested_id
  where not exists (
    select 1 from public.observations o
    where o.class_id = requested_id and o.observer_id = p_teacher_id and o.status = '확정'
  );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '선택한 수업은 이미 신청되어 있습니다.';
  end if;

  select count(*) into v_current_count
  from public.observations
  where observer_id = p_teacher_id and status = '확정';
  if v_current_count + array_length(v_ids, 1) < 2 then
    raise exception '참관 신청은 현재 신청 횟수를 포함해 2회 이상 선택해야 합니다.';
  end if;

  perform 1 from public.open_classes where id = any(v_ids) order by id for update;

  foreach v_class_id in array v_ids loop
    select * into v_class from public.open_classes where id = v_class_id;
    if not found then raise exception '존재하지 않는 공개수업입니다.'; end if;
    if v_class.semester <> 2 or v_class.status <> '확정' then raise exception '확정된 2학기 수업만 신청할 수 있습니다.'; end if;
    if v_class.class_date < (now() at time zone 'Asia/Seoul')::date then raise exception '이미 지난 수업은 신청할 수 없습니다.'; end if;
    if v_class.teacher_id = p_teacher_id then raise exception '자신의 공개수업은 참관할 수 없습니다.'; end if;

    select count(*) into v_capacity_count from public.observations where class_id = v_class_id and status = '확정';
    if v_capacity_count >= v_class.capacity then raise exception '참관 정원이 모두 찬 수업이 포함되어 있습니다.'; end if;

    v_allow_timetable_conflict := v_class_id = any(coalesce(p_allow_timetable_conflict_ids, array[]::uuid[]));
    if not v_allow_timetable_conflict and (
      exists (
        select 1 from public.weekly_timetables wt
        where wt.teacher_id = p_teacher_id
          and wt.lesson_date = v_class.class_date
          and wt.period = v_class.period
      )
      or (
        not exists (
          select 1 from public.weekly_timetables wt
          where wt.teacher_id = p_teacher_id and wt.lesson_date = v_class.class_date
        )
        and exists (
          select 1 from public.timetables t
          where t.teacher_id = p_teacher_id and t.active
            and coalesce(t.open_class_eligible, true)
            and t.weekday = v_class.weekday and t.period = v_class.period
        )
      )
    ) then
      raise exception '본인의 수업 시간표와 겹치는 수업이 포함되어 있습니다.';
    end if;

    if exists (
      select 1 from public.blocked_dates b
      where b.active and (b.teacher_id is null or b.teacher_id = p_teacher_id)
        and b.blocked_date = v_class.class_date and (b.period is null or b.period = v_class.period)
    ) then raise exception '신청 불가 일정과 겹치는 수업이 포함되어 있습니다.'; end if;

    if exists (
      select 1 from public.open_classes own_class
      where own_class.teacher_id = p_teacher_id and own_class.status in ('승인대기', '확정')
        and own_class.class_date = v_class.class_date and own_class.period = v_class.period
        and own_class.id <> v_class_id
    ) then raise exception '본인의 공개수업 일정과 겹칩니다.'; end if;

    if exists (
      select 1 from public.observations o
      join public.open_classes c on c.id = o.class_id
      where o.observer_id = p_teacher_id and o.status = '확정'
        and c.class_date = v_class.class_date and c.period = v_class.period
        and o.class_id <> v_class_id
    ) then raise exception '이미 신청한 다른 참관 일정과 시간이 겹칩니다.'; end if;
  end loop;

  foreach v_class_id in array v_ids loop
    v_observation_id := gen_random_uuid();
    insert into public.observations (id, class_id, observer_id, semester, source)
    values (
      v_observation_id,
      v_class_id,
      p_teacher_id,
      2,
      case
        when v_class_id = any(coalesce(p_allow_timetable_conflict_ids, array[]::uuid[]))
          then '앱-시간표변경예정'
        else '앱'
      end
    );
    observation_id := v_observation_id;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_change_atomic(p_change_id uuid, p_admin_id uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_change public.change_requests%rowtype;
  v_class public.open_classes%rowtype;
  v_observation record;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_conflict boolean;
  v_conflict_reason text;
  v_affected_names text[] := array[]::text[];
  v_new_summary text;
  v_old_summary text;
begin
  select * into v_change
  from public.change_requests
  where id = p_change_id
  for update;

  if not found or v_change.status <> '승인대기' then
    raise exception '승인 대기 중인 변경 신청을 찾을 수 없습니다.';
  end if;

  select * into v_class
  from public.open_classes
  where id = v_change.class_id
  for update;

  if not found or v_class.status <> '확정' then
    raise exception '연결된 확정 공개수업을 찾을 수 없습니다.';
  end if;
  if v_class.class_date < v_today or v_change.requested_date < v_today then
    raise exception '이미 지난 수업 또는 지난 날짜로는 일정을 변경할 수 없습니다.';
  end if;
  if v_change.requested_date > public.open_class_final_date() then
    raise exception '공개수업 일정은 %까지 변경할 수 있습니다.', to_char(public.open_class_final_date(), 'FMMM"월" FMDD"일"');
  end if;
  if exists (
    select 1 from public.observations o
    where o.class_id = v_class.id and o.attendance in ('참석', '불참')
  ) then
    raise exception '참관 여부 확인이 시작된 수업은 일정을 변경할 수 없습니다.';
  end if;
  if v_change.requested_timetable_id is not null and not exists (
    select 1 from public.timetables t
    where t.id = v_change.requested_timetable_id
      and t.teacher_id = v_change.requester_id
      and t.active
      and t.open_class_eligible
      and t.weekday = v_change.requested_weekday
      and t.period = v_change.requested_period
      and btrim(t.class_name) = btrim(v_change.requested_class_name)
  ) then
    raise exception '변경 신청 후 시간표가 바뀌었습니다. 교사가 새 시간표로 다시 신청해야 합니다.';
  end if;
  if exists (
    select 1 from public.blocked_dates b
    where b.active
      and (b.teacher_id is null or b.teacher_id = v_change.requester_id)
      and b.blocked_date = v_change.requested_date
      and (b.period is null or b.period = v_change.requested_period)
  ) then
    raise exception '변경 희망 일정이 학사일정 또는 교사 제외 일정과 겹칩니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat(v_change.requested_date, '|', v_change.requested_period, '|', lower(btrim(v_change.requested_room))), 0
  ));
  if exists (
    select 1 from public.open_classes c
    where c.id <> v_class.id
      and c.status = '확정'
      and c.class_date = v_change.requested_date
      and c.period = v_change.requested_period
      and lower(btrim(c.room)) = lower(btrim(v_change.requested_room))
  ) then
    raise exception '변경 희망 일정의 장소가 다른 확정 공개수업과 겹칩니다.';
  end if;

  v_old_summary := concat(v_class.class_date, ' ', v_class.period, '교시 · ', v_class.class_name, ' · ', v_class.room);
  v_new_summary := concat(v_change.requested_date, ' ', v_change.requested_period, '교시 · ', v_change.requested_class_name, ' · ', v_change.requested_room);

  for v_observation in
    select o.*, t.name as observer_name
    from public.observations o
    join public.teachers t on t.id = o.observer_id
    where o.class_id = v_class.id and o.status = '확정'
    for update of o
  loop
    v_conflict := false;
    v_conflict_reason := '';

    if exists (
      select 1 from public.timetables tt
      where tt.teacher_id = v_observation.observer_id and tt.active
        and tt.weekday = v_change.requested_weekday and tt.period = v_change.requested_period
    ) then
      v_conflict := true; v_conflict_reason := '본인 수업 시간표와 겹칩니다.';
    elsif exists (
      select 1 from public.blocked_dates b
      where b.active and (b.teacher_id is null or b.teacher_id = v_observation.observer_id)
        and b.blocked_date = v_change.requested_date
        and (b.period is null or b.period = v_change.requested_period)
    ) then
      v_conflict := true; v_conflict_reason := '신청 불가 일정과 겹칩니다.';
    elsif exists (
      select 1 from public.open_classes c
      where c.id <> v_class.id and c.teacher_id = v_observation.observer_id
        and c.status in ('승인대기', '확정')
        and c.class_date = v_change.requested_date and c.period = v_change.requested_period
    ) then
      v_conflict := true; v_conflict_reason := '본인의 공개수업 일정과 겹칩니다.';
    elsif exists (
      select 1
      from public.observations other_o
      join public.open_classes other_c on other_c.id = other_o.class_id
      where other_o.id <> v_observation.id
        and other_o.observer_id = v_observation.observer_id
        and other_o.status = '확정'
        and other_c.id <> v_class.id
        and other_c.status = '확정'
        and other_c.class_date = v_change.requested_date
        and other_c.period = v_change.requested_period
    ) then
      v_conflict := true; v_conflict_reason := '다른 참관 일정과 겹칩니다.';
    end if;

    insert into public.notifications (
      teacher_id, notification_type, severity, title, message, class_id, observation_id,
      action_tab, dedupe_key, metadata, read_at, resolved_at, updated_at
    ) values (
      v_observation.observer_id,
      case when v_conflict then '참관취소' else '일정변경' end,
      case when v_conflict then 'danger' else 'warning' end,
      case when v_conflict then '참관 신청이 자동 취소되었습니다' else '참관 수업 일정이 변경되었습니다' end,
      case when v_conflict
        then concat(v_old_summary, '에서 ', v_new_summary, '으로 변경되어 참관 신청이 취소되었습니다. ', v_conflict_reason)
        else concat(v_old_summary, '에서 ', v_new_summary, '으로 변경되었습니다. 참관 신청은 그대로 유지됩니다.')
      end,
      v_class.id,
      v_observation.id,
      'observe',
      concat('change:', v_change.id, ':observer:', v_observation.observer_id),
      jsonb_build_object('old', v_old_summary, 'new', v_new_summary, 'canceled', v_conflict, 'reason', v_conflict_reason),
      null,
      null,
      now()
    )
    on conflict (dedupe_key) do update set
      notification_type = excluded.notification_type,
      severity = excluded.severity,
      title = excluded.title,
      message = excluded.message,
      class_id = excluded.class_id,
      observation_id = excluded.observation_id,
      action_tab = excluded.action_tab,
      metadata = excluded.metadata,
      read_at = null,
      resolved_at = null,
      updated_at = now();

    if v_conflict then
      update public.observations
      set status = '일정변경취소', canceled_at = now(), note = concat('공개수업 일정 변경으로 자동 취소: ', v_conflict_reason)
      where id = v_observation.id;
      v_affected_names := array_append(v_affected_names, v_observation.observer_name);
    end if;
  end loop;

  update public.open_classes
  set class_date = v_change.requested_date,
      weekday = v_change.requested_weekday,
      period = v_change.requested_period,
      class_name = v_change.requested_class_name,
      room = v_change.requested_room,
      subject = v_change.requested_subject
  where id = v_class.id;

  update public.change_requests
  set status = '승인', processed_by = p_admin_id, processed_at = now(),
      admin_note = coalesce(p_note, ''), affected_observers = array_to_string(v_affected_names, ', ')
  where id = v_change.id;

  return jsonb_build_object(
    'change_id', v_change.id,
    'affected_count', coalesce(array_length(v_affected_names, 1), 0),
    'affected_names', to_jsonb(v_affected_names)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_open_class_atomic(p_class_id uuid, p_admin_id uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_class public.open_classes%rowtype;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into v_class
  from public.open_classes
  where id = p_class_id
  for update;

  if not found or v_class.status <> '승인대기' then
    raise exception '승인 대기 중인 공개수업을 찾을 수 없습니다.';
  end if;
  if v_class.class_date < v_today then
    raise exception '지난 공개수업 일정은 승인할 수 없습니다.';
  end if;
  if coalesce(btrim(v_class.source), '') <> '직접입력' and not exists (
    select 1 from public.timetables t
    where t.teacher_id = v_class.teacher_id
      and t.active
      and t.open_class_eligible
      and t.weekday = v_class.weekday
      and t.period = v_class.period
      and btrim(t.class_name) = btrim(v_class.class_name)
  ) then
    raise exception '신청 후 시간표가 바뀌었습니다. 교사가 새 시간표로 신청을 수정해야 합니다.';
  end if;
  if exists (
    select 1 from public.blocked_dates b
    where b.active
      and (b.teacher_id is null or b.teacher_id = v_class.teacher_id)
      and b.blocked_date = v_class.class_date
      and (b.period is null or b.period = v_class.period)
  ) then
    raise exception '현재 학사일정 또는 교사 제외 일정과 겹쳐 승인할 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat(v_class.class_date, '|', v_class.period, '|', lower(btrim(v_class.room))), 0
  ));
  if exists (
    select 1 from public.open_classes c
    where c.id <> v_class.id
      and c.status = '확정'
      and c.class_date = v_class.class_date
      and c.period = v_class.period
      and lower(btrim(c.room)) = lower(btrim(v_class.room))
  ) then
    raise exception '같은 시간과 장소에 이미 확정된 공개수업이 있습니다.';
  end if;

  update public.open_classes
  set status = '확정', processed_by = p_admin_id, processed_at = now(), admin_note = coalesce(p_note, '')
  where id = v_class.id;

  return jsonb_build_object('class_id', v_class.id, 'status', '확정');
end;
$function$;

alter table public.teachers enable row level security;
alter table public.app_settings enable row level security;
alter table public.timetables enable row level security;
alter table public.weekly_timetables enable row level security;
alter table public.blocked_dates enable row level security;
alter table public.open_classes enable row level security;
alter table public.observations enable row level security;
alter table public.documents enable row level security;
alter table public.change_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- 보안: 위 함수들은 웹앱 서버(service_role)만 호출하도록 제한합니다.
revoke execute on function public.admin_update_open_class_atomic(uuid, uuid, date, integer, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.approve_change_atomic(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.approve_open_class_atomic(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_observations_with_override_atomic(uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.admin_update_open_class_atomic(uuid, uuid, date, integer, text, text, text, text, text) to service_role;
grant execute on function public.approve_change_atomic(uuid, uuid, text) to service_role;
grant execute on function public.approve_open_class_atomic(uuid, uuid, text) to service_role;
grant execute on function public.apply_observations_with_override_atomic(uuid, uuid[], uuid[]) to service_role;
revoke execute on function public.apply_observations_atomic(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.apply_observations_atomic(uuid, uuid[]) to service_role;
grant execute on function public.open_class_final_date() to service_role;

-- 제출 자료(지도안·협의록·참관록)와 공용 양식을 저장하는 비공개 저장소 (파일당 3MB)
insert into storage.buckets (id, name, public, file_size_limit)
values ('open-class-documents', 'open-class-documents', false, 3145728)
on conflict (id) do nothing;
