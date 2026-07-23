-- 0146a — 계정 귀속 화면 설정(users.ui_prefs jsonb)
--
-- 원장 지시(2026-07-23): "뷰 설정은 각자 계정에 개별 귀속되어 다음에도 계속 같은 뷰로 볼 수 있게."
-- 지금까지 시간표 표시 선호는 **쿠키(기기 기억)**라 PC를 바꾸면 초기화됐다. 계정에 붙여 어느 기기에서든
-- 같은 뷰가 되게 한다. 쿠키는 폴백으로 남겨 전환 시 기존 설정이 유실되지 않는다(코드: page.tsx).
--
-- 구조: 화면별 네임스페이스 1단 — { "timetable": { grades, hideEmptyDays, collapseEmptyPeriods } }.
-- 다른 화면 설정이 생기면 형제 키로 추가하고, 저장은 **그 키만 병합**한다(tenant_settings 섹션 머지와
-- 같은 규약 — 한 화면 저장이 다른 화면 설정을 지우면 안 된다).
--
-- 소비: /timetable 서버 컴포넌트가 본인 행을 읽어 첫 렌더에 반영(깜빡임 없음).
-- 쓰기: saveTimetableViewPrefs(본인 행만, admin client + (id,tenant_id) 스코프 — 0104a와 동일 규약).
-- RLS 무변경: 읽기는 본인 users 행 self-select(기존 정책), 쓰기는 service_role.
--
-- ⚠️ 여기에 학년 목록을 하드코딩하지 않는다 — 학년은 학원설정(operations.gradeLevels)이 단일 소스라
-- 저장값은 그 라벨 문자열의 부분집합일 뿐이다. 설정에서 학년이 바뀌면 앱이 교집합으로 처리한다.

alter table public.users
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;

comment on column public.users.ui_prefs is
  '계정 귀속 화면 설정. 화면별 네임스페이스 1단({"timetable":{...}}). 저장은 해당 키만 병합.';
