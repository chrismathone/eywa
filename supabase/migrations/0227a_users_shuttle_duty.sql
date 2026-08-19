-- 0227a: 직원 '셔틀 담당' 개인 토글 (users.shuttle_duty) — 2026-08-19 원장:
--   "셔틀 전용 권한을 만들어줘. 셔틀 선생님을 강사나 관리자 권한을 올리기엔 그렇고, 따로 토글시켜야겠어."
--
-- ■ 왜 역할이 아니라 토글인가
--   셔틀 선생님(주영미)은 역할이 viewer다. 등하원을 찍게 하려고 강사·관리자로 올리면 학생 기록·시간표
--   같은 **셔틀과 무관한 표면이 통째로 열린다**(강사 소급 퇴원 사고 이후 역할 승격은 더 조심한다).
--   '자리 출석부 담당'(0209a)과 같은 결 — 역할은 그대로 두고 그 화면만 여는 개인 토글이다.
--
-- ■ 이 토글이 여는 것 / 안 여는 것
--   여는 것 : 로그인 착지 = 오늘 등하원(/shuttle/today) · 셔틀 화면 열람 · 등하원(탑승/미탑승) 기록.
--   안 여는 것: **노선 편성 수정**(정류장·회차·배정 = 사무실 canWriteTenant("shuttle") 그대로) ·
--              출결/학생 레코드(셔틀은 "신호만" — 미탑승이 결석을 만들지 않는다) · 다른 메뉴 일체.
--
-- ■ 0225a에서 뭘 고치는 건가
--   최초 구현은 `attendance_alert_optin`(= 클래스노트 학부모 출결 연락 수신)을 '셔틀 체크'로 **겸용**했다.
--   한 체크박스가 "알림을 받는다"와 "등하원을 찍을 수 있다" 두 뜻을 갖고 있어, 알림만 끄면 기록 권한도
--   같이 사라지고 반대로 알림을 켜 주면 권한이 딸려 갔다. 원장 지시로 축을 분리한다.
--
-- ■ 백필
--   옛 게이트가 실제로 허용하던 계정만 옮긴다 — 사무실 역할(master/admin/manager)은 이미 편성 권한으로
--   기록할 수 있어 토글이 필요 없고, 켜면 **로그인 착지가 셔틀로 바뀌어** 사무실 업무가 방해된다.
--   2026-08-19 실측 대상 = 1명(주영미/viewer). 멱등(이미 true면 건드리지 않음).
--
-- ⚠️ 앱은 이 컬럼이 **없어도 돈다**(#95) — 조회 헬퍼가 컬럼 부재를 잡아 옛 표식으로 폴백하고,
--    직원 저장은 이 컬럼만 빼고 나머지를 저장한다. 배포가 SQL보다 앞서도 셔틀 기록이 멈추지 않는다.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table public.users add column if not exists shuttle_duty boolean not null default false;

comment on column public.users.shuttle_duty is
  '셔틀 담당(개인 토글) — 로그인 착지=오늘 등하원, 셔틀 열람 + 등하원 기록 허용. 노선 편성 수정은 불가(사무실 전용).';

update public.users
   set shuttle_duty = true
 where attendance_alert_optin = true
   and status = 'active'
   and system_role not in ('master', 'admin', 'manager')
   and shuttle_duty = false;
