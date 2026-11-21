-- 처음 설치할 때 한 번 실행하는 기본 설정값입니다. schema.sql 실행 후 이어서 실행하세요.
-- 날짜와 이름은 학교에 맞게 바꾼 뒤 실행하거나, 설치 후 관리자 센터에서 바꿀 수 있습니다.
-- 이미 값이 있으면 덮어쓰지 않습니다.

insert into public.app_settings (setting_key, setting_value, description) values
  ('app_name', '2학기 수업공개·참관 관리', '화면 제목과 엑셀 작성자 이름'),
  ('school_year', '2026', '학년도'),
  ('semester', '2', '운영 학기'),
  ('capacity', '4', '공개수업 1건당 기본 참관 정원'),
  ('max_file_mb', '3', '제출 파일 최대 크기(MB)'),
  ('operation_phase', '준비', '준비/공개수업신청/참관신청/수업진행/전체'),
  ('open_application_start', '2026-08-26', '공개수업 신청 시작일'),
  ('open_application_deadline', '2026-08-28', '공개수업 신청 마감일'),
  ('observation_application_start', '2026-08-31', '참관 신청 시작일'),
  ('observation_application_deadline', '2026-09-04', '참관 신청 마감일'),
  ('semester_start_date', '2026-09-01', '월간 일정 달력 시작일'),
  ('open_class_final_date', '2026-11-30', '공개수업을 등록·변경할 수 있는 마지막 날짜'),
  ('app_url', '', '안내 문구에 넣을 웹앱 주소(비우면 Vercel 주소 자동 사용)'),
  ('room_locations', '{}', '교실 위치표(JSON). 관리자 센터 > 교실 위치 관리에서 수정'),
  ('academic_calendar_blocks', '[]', '학교 학사일정(JSON 배열). 예: [{"date":"2026-10-14","reason":"정기시험"}]'),
  ('winter_break', '', '겨울방학(JSON). 예: {"start":"2027-01-07","end":"2027-02-28"}'),
  ('timetable_manual_lock', 'false', 'true면 컴시간 자동 동기화를 멈춤'),
  ('reminder_fixed_recipients', '', '수업 리마인드에 항상 넣을 받는 사람(쉼표 구분)'),
  ('public_messenger_messages', '[]', '로그인 화면 메신저 보관함')
on conflict (setting_key) do nothing;
