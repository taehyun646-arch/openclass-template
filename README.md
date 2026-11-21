# 수업공개·참관 관리 웹앱 (학교 설치용 템플릿)

학교 안에서 공개수업 신청, 참관 신청, 참관 확인, 지도안·협의록·참관록 제출을 한곳에서 관리하는 웹앱입니다.
이 저장소에는 어느 학교의 명단이나 시간표도 들어 있지 않습니다. 각 학교가 자기 계정에 직접 설치해서 씁니다.

먼저 써 보고 싶다면 체험용 데모를 열어 보세요: https://openclass-demo.vercel.app/
(가상 학교, 가상 교사 이름입니다. 바꾼 내용은 내 브라우저에만 저장됩니다. 관리자 코드: `demo1234`)

## 이 앱으로 할 수 있는 일

- 선생님: 본인 시간표에서 공개수업 신청, 다른 선생님 공개수업 참관 신청, 참관 여부 확인, 자료 제출
- 관리자: 공개수업 승인·일정 변경, 참관 정원 관리, 안내 메시지 문구 만들기, 제출 현황 확인, 엑셀 내려받기
- 로그인 첫 화면: 이번 주·다음 주 공개수업 일정, 월간 달력, 참관왕 순위(이름 마지막 글자는 가려서 표시)
- 컴시간 학교코드를 넣으면 교사 시간표를 매일 자동으로 가져옵니다.

현재 버전은 2학기 운영을 기준으로 만들어져 있습니다. 화면 문구와 집계 기준에 "2학기"가 들어 있습니다.

## 준비물 (모두 무료 계정으로 가능)

1. GitHub 계정: 코드를 올려 두는 곳
2. Supabase 계정: 명단, 시간표, 신청 기록을 저장하는 데이터베이스
3. Vercel 계정: 웹앱을 인터넷 주소로 띄워 주는 곳 (GitHub 계정으로 가입하면 편합니다)

## 설치 순서

### 1단계. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인하고 New project 를 누릅니다.
2. 이름은 자유롭게 정하고, Region 은 Northeast Asia (Seoul) 을 고릅니다. 데이터베이스 비밀번호는 따로 적어 둡니다.
3. 프로젝트가 만들어지면 왼쪽 메뉴의 SQL Editor 를 엽니다.
4. `database/schema.sql` 파일 내용을 전부 복사해 붙여 넣고 Run 을 누릅니다. (새 프로젝트에서 한 번만 실행합니다)
5. 새 쿼리 창에 `database/seed_settings.sql` 내용을 붙여 넣고, 학년도와 신청 기간 날짜를 학교에 맞게 고친 뒤 Run 을 누릅니다.

### 2단계. 교사 명단 넣기

1. `samples/teachers_sample.csv` 를 엑셀로 열어 형식을 확인합니다.
2. 같은 열 이름으로 우리 학교 명단 파일을 만듭니다. 열 설명:
   - `name`: 교사 이름 (컴시간 이름과 같게 적으면 시간표가 자동으로 연결됩니다)
   - `email`: 비워도 됩니다
   - `subject_group`: 교과 (국어, 수학, 영어 등)
   - `role`: `일반교사` 또는 `관리자` (관리자 행은 1개 넣어 두는 것을 권장합니다)
   - `second_semester_target`: 2학기 공개수업 대상이면 `true`, 아니면 `false`
   - `exclusion_reason`: 대상이 아닌 이유 (예: `1학기 공개 완료`, `순회교사`)
   - `active`: 재직 중이면 `true`
3. 엑셀에서 "CSV UTF-8" 형식으로 저장합니다.
4. Supabase 왼쪽 메뉴 Table Editor 에서 `teachers` 테이블을 열고 Insert > Import data from CSV 로 파일을 올립니다.

시간표는 두 가지 방법 중 하나를 고릅니다.

- 방법 A (권장): 컴시간 자동 연결. 5단계에서 `COMCIGAN_SCHOOL_CODE` 를 넣으면 배포 후 관리자 화면의 "지금 시간표 동기화" 버튼이나 매일 오전 9시 자동 작업으로 시간표를 가져옵니다. 이름이 연결되지 않은 교사는 관리자 화면에 따로 표시됩니다.
- 방법 B: 컴시간을 쓰지 않는 경우. `database/timetables_import_helper.sql` 안내대로 `samples/timetables_sample.csv` 형식의 시간표를 가져옵니다.

### 3단계. Supabase 연결 정보 복사

1. Supabase 왼쪽 아래 Project Settings 로 갑니다.
2. Data API (또는 API) 화면의 Project URL 을 복사합니다. 이것이 `SUPABASE_URL` 입니다.
3. API Keys 화면의 secret key (예전 화면에서는 service_role key) 를 복사합니다. 이것이 `SUPABASE_SECRET_KEY` 입니다.
4. secret key 는 데이터베이스 전체를 다룰 수 있는 열쇠입니다. 메신저, 문서, 스크린샷에 절대 남기지 마세요.

### 4단계. GitHub에 올리고 Vercel에 연결

1. 이 폴더를 GitHub 의 새 저장소로 올립니다. 저장소는 Private 로 만드는 것을 권장합니다.
   (배포해 준 선생님이 GitHub 템플릿 저장소를 공유했다면 Use this template 버튼으로 바로 복사해도 됩니다.)
2. https://vercel.com 에서 Add New > Project 를 누르고 방금 만든 저장소를 Import 합니다.
3. Framework Preset 은 Other 그대로 두면 됩니다. 아직 Deploy 를 누르지 말고 5단계 환경변수부터 넣습니다.

### 5단계. Vercel 환경변수 넣기

Import 화면의 Environment Variables (또는 배포 후 Settings > Environment Variables) 에 아래 값을 넣습니다. 이름 목록은 `.env.example` 에도 있습니다.

| 이름 | 넣을 값 | 필수 |
| --- | --- | --- |
| `SUPABASE_URL` | 3단계의 Project URL | 필수 |
| `SUPABASE_SECRET_KEY` | 3단계의 secret key | 필수 |
| `SESSION_SECRET` | 32자 이상 무작위 문자열 | 필수 |
| `ADMIN_PASSWORD` | 관리자 화면 비밀번호 (관리자 코드) | 필수 |
| `CRON_SECRET` | 32자 이상 무작위 문자열 | 필수 |
| `COMCIGAN_SCHOOL_CODE` | 컴시간 학교코드 숫자 | 컴시간 사용 시 |
| `COMCIGAN_AUTO_SYNC` | `off` 로 두면 자동 동기화 끄기 | 선택 |
| `APP_URL` | 안내 문구에 넣을 웹앱 주소 | 선택 |
| `MAINTENANCE_MODE` | `true` 면 점검 화면만 표시 | 선택 |
| `MAINTENANCE_MESSAGE` | 점검 화면 문구 | 선택 |

무작위 문자열은 비밀번호 관리 프로그램의 "비밀번호 생성" 기능으로 만들면 편합니다.
모두 넣은 뒤 Deploy 를 누릅니다. 환경변수를 나중에 바꿨다면 Deployments 에서 Redeploy 해야 적용됩니다.

### 6단계. 배포 후 관리자 설정

1. Vercel 이 알려 주는 주소 (예: `https://프로젝트이름.vercel.app`) 로 들어갑니다.
2. 첫 화면의 "관리자 로그인" 을 누르고 `ADMIN_PASSWORD` 로 로그인합니다.
3. 관리자 센터에서 다음을 차례로 설정합니다.
   - 운영 단계: 준비 > 공개수업신청 > 참관신청 순서로 바꿉니다.
   - 공개수업·참관 신청 기간
   - 교실 위치 관리 (예: `1-1` 은 `3층 본관`)
   - 공용 양식 자료실에 지도안·협의록·참관록 양식 올리기
   - 메신저 설정의 리마인드 고정 수신자 (교감, 연구부장 등)
   - 컴시간을 쓰면 "지금 시간표 동기화" 한 번 실행
4. 선생님 이름 하나로 들어가서 신청 화면이 잘 보이는지 확인합니다.

### 7단계. 학교마다 바꿔야 하는 값

| 바꿀 것 | 바꾸는 곳 |
| --- | --- |
| 앱 제목, 학년도, 학기, 참관 정원 | Supabase `app_settings` 의 `app_name`, `school_year`, `semester`, `capacity` |
| 신청 기간 | 관리자 센터 (또는 `app_settings`) |
| 공개수업 마지막 날짜 (기본 2026-11-30) | `app_settings` 의 `open_class_final_date` |
| 월간 달력 시작 달 | `app_settings` 의 `semester_start_date` |
| 학교 시험·단축수업 등 신청 불가 날짜 | `app_settings` 의 `academic_calendar_blocks` (JSON 배열) |
| 겨울방학 | `app_settings` 의 `winter_break` (예: `{"start":"2027-01-07","end":"2027-02-28"}`) |
| 교실 위치 | 관리자 센터 > 교실 위치 관리 |
| 컴시간 학교코드 | Vercel 환경변수 `COMCIGAN_SCHOOL_CODE` |
| 관리자 비밀번호 | Vercel 환경변수 `ADMIN_PASSWORD` |

공휴일(추석, 한글날, 성탄절 등 2026학년도 2학기)은 `api/index.js` 의 `ACADEMIC_CALENDAR_BLOCKS` 에 기본으로 들어 있습니다. 다음 학년도에는 이 목록을 새로 고쳐야 합니다.
`academic_calendar_blocks` 예시: `[{"date":"2026-10-14","reason":"정기시험"},{"date":"2026-10-28","periods":[6,7],"reason":"5교시 후 하교"}]`

## 개인정보 안내

- 이 앱의 데이터 (교사 이름, 교과, 시간표, 신청·참관 기록, 제출 파일) 는 설치한 학교의 Supabase 프로젝트에만 저장됩니다. 템플릿을 만든 사람이나 다른 학교는 볼 수 없습니다.
- 설치한 학교 (설치·운영한 선생님) 가 데이터 관리 책임을 집니다. 운영 전에 학교 내부 결재나 정보보호 담당자 확인을 받는 것을 권장합니다.
- 학생 개인정보는 넣지 않습니다. 이 앱은 교사 명단과 수업 시간표만 다룹니다.
- 웹앱 주소는 교내 메신저로만 공유하고, 블로그·SNS·외부 단체방에 올리지 마세요.
- 선생님 화면에서는 다른 선생님 이름의 마지막 글자를 가려서 보여 줍니다. 관리자 화면과 엑셀에는 전체 이름이 나옵니다.
- 학기가 끝나면 다음 순서로 정리합니다.
  1. 관리자 화면에서 엑셀 파일을 내려받아 학교 규정에 맞는 곳에 보관합니다.
  2. 필요하면 Supabase Storage 의 `open-class-documents` 에서 제출 파일을 내려받습니다.
  3. 보관이 끝나면 Supabase SQL Editor 에서 기록을 지웁니다. 예:
     `delete from public.notifications; delete from public.documents; delete from public.change_requests; delete from public.observations; delete from public.open_classes;`
  4. 제출 파일은 Storage 화면에서 폴더째 삭제합니다.
  5. 더 쓰지 않을 때는 Supabase 프로젝트와 Vercel 프로젝트를 통째로 삭제하면 모든 데이터가 함께 지워집니다.

## 보안 참고 (꼭 읽어 주세요)

- 현재 선생님 입장은 로그인 없이 이름을 고르는 방식입니다. 주소를 아는 사람은 누구나 첫 화면 일정을 볼 수 있고, 이름을 골라 그 선생님으로 신청할 수도 있습니다.
- 그래서 주소가 학교 밖으로 퍼지지 않게 관리하는 것이 가장 중요합니다. 주소가 외부에 알려졌다면 Vercel 에서 프로젝트 이름(주소)을 바꾸고 새 주소를 다시 안내하세요.
- 관리자 화면은 `ADMIN_PASSWORD` 로 보호됩니다. 비밀번호는 관리자만 알고, 정기적으로 바꿔 주세요.
- `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `CRON_SECRET` 은 Vercel 환경변수에만 넣고 코드나 문서에 적지 마세요.
- Supabase 의 모든 테이블은 RLS 가 켜져 있어 브라우저에서 데이터베이스에 직접 접근할 수 없습니다. 데이터는 웹앱 서버를 통해서만 오갑니다.

## 참고

- Vercel 무료 요금제(Hobby) 에서는 자동 시간표 동기화가 하루 한 번 (오전 9시 무렵) 실행됩니다. 낮에 바뀐 시간표는 관리자 화면에서 수동 동기화하세요.
- 코드를 고친 뒤 확인하려면 Node.js 20 이상에서 `npm install` 후 `npm test` 를 실행합니다.
- 라이선스: MIT (LICENSE 파일 참고)
