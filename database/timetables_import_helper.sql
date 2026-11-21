-- (선택) 컴시간을 쓰지 않는 학교용 기본 시간표 가져오기 도우미
-- 1) 이 파일의 1단계를 실행해 임시 테이블을 만듭니다.
-- 2) Supabase Table Editor에서 timetables_import 테이블을 열고 samples/timetables_sample.csv 형식의 파일을 가져옵니다(Import data from CSV).
-- 3) 2단계를 실행하면 교사 이름으로 teachers 테이블과 연결해 timetables에 넣습니다.
-- 4) 3단계로 임시 테이블을 지웁니다.

-- 1단계
create table if not exists public.timetables_import (
  teacher_name text not null,
  weekday text not null,
  period integer not null,
  class_name text not null,
  room text default '' not null,
  subject text default '' not null
);
alter table public.timetables_import enable row level security;

-- 2단계 (이름이 teachers와 정확히 같아야 연결됩니다)
insert into public.timetables (teacher_id, weekday, period, class_name, room, subject, active, open_class_eligible)
select t.id, btrim(i.weekday), i.period, btrim(i.class_name), btrim(i.room), btrim(i.subject), true, true
from public.timetables_import i
join public.teachers t on t.name = btrim(i.teacher_name) and t.active;

-- 연결되지 않은 이름 확인
select distinct i.teacher_name as "teachers에 없는 이름"
from public.timetables_import i
left join public.teachers t on t.name = btrim(i.teacher_name)
where t.id is null;

-- 3단계
-- drop table public.timetables_import;
