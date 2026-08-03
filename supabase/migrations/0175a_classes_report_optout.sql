-- 0174a — 반별 '수업보고서 미발송' 토글 (2026-08-03).
--
-- 배경(원장 2026-08-03): *"수업 설정에서 '수업보고서 미발송' 수업을 토글 할 수 있게. 랩실 수업이나
-- 이런 수업 등에서 토글을 켜서 수업보고서를 발송하지 않아도 되게"* + *"그럼 자동으로 수업보고서 발송에서
-- 반목록이 출력되지 않으므로 선생님이 헷갈릴 필요가 없는거지. 괜히 작성률도 0%로 오해받지않고"*
--
-- 즉 요구는 두 가지다: ① 보고서 작성·발송 화면의 **반 목록에서 사라진다** ② **작성률 분모에서 빠진다**.
--
-- 🔴 '숨김'이지 '차단'이 아니다. 이미 쓴 그 반의 보고서는 그대로 보이고 수정·발송도 된다 — 원장 표현이
--    "발송하지 **않아도 되게**"(의무 면제)이지 금지가 아니고, 차단으로 만들면 과거 이력이 잠긴다.
--    (저장·발송 게이트 saveLessonReport·saveAndQueueClassnote·sendClassnoteForUnsent는 일부러 안 건드렸다.)
--
-- 🔴 이름 폴백을 만들지 않는다. 형제 컬럼 `is_special`은 반 이름에 '특강'이 있으면 특강으로 보는 하위호환
--    폴백이 있지만, 여기엔 그런 이름 규칙이 없다(실측: 살아있는 반 107개 중 'LAB' 이름 0개). 만들면
--    반 이름을 고치는 순간 분류가 조용히 뒤집힌다. **판정은 이 컬럼 하나뿐이다.**
--
-- 🔴 배포 순서 = **이 마이그레이션이 코드보다 먼저**. 컬럼 없이 코드만 올라가면 report_optout을 select/
--    insert하는 경로(반 생성·수정, 로스터, 작성률, 출석부, 발송 콘솔)가 전부 PostgREST 42703으로 죽는다.
--    적용 확인:
--      select column_name from information_schema.columns
--       where table_name='classes' and column_name='report_optout';
--      notify pgrst, 'reload schema';
--
-- ⚠️ **의도적 비소비처**(#92 — 안 적힌 테이블은 닫힌 걸로 오인된다):
--    · 급여·시수 — payroll은 lesson_reports를 안 읽고 시수는 attendance_records RPC만 본다(참조 0건 실측).
--      이 컬럼은 돈 계산에 닿지 않는다(골든마스터 무관).
--    · `attendance_records` **쓰기** — 출결 파생은 읽기 시점이라 이 테이블을 오염시키지 않는다.
--      단 **파생 읽기**는 따라간다: 미발송 반은 '보고서 없음 = 결석' 규칙만 끄고(안 끄면 그 반의 지난
--      등원일이 전부 결석으로 뒤집힌다), 이미 있는 보고서로 붙는 '출석'은 그대로 둔다.
--    · ECS(영어 주간 시트) — lesson_reports를 전혀 안 쓰고 그 '작성률'은 주간 계획 채움률로 축이 다르다.
--    · 시간표 — 이 반은 시간표에 계속 보인다(수업은 실제로 있다). 숨기는 건 보고서 표면뿐.
--    · 반 공지(학부모 공지) — '수업보고서' 미발송이라 공지는 계속 보낼 수 있다.
--
-- ⚠️ 이 플래그는 `lesson_reports.class_id`가 있는 건에만 닿는다. 이관분은 99.9%가 class_id NULL이라
--    (0134a 실측 17,335/17,350) 그 반의 **과거 보고서는 목록·달력에 계속 보인다** — 이력 보존 관점에선 옳다.
--
-- 인덱스 없음: 소비처는 전부 이미 반 id 집합을 손에 쥐고 JS에서 거르거나 소량 select라, 부분 인덱스는
-- write 비용만 늘린다. RLS 변경 없음(classes의 tenant_isolation 그대로).
--
-- 롤백: alter table public.classes drop column if exists report_optout;
--       (코드가 먼저 내려가야 한다 — 반대로 하면 위 42703)

alter table public.classes
  add column if not exists report_optout boolean not null default false;

comment on column public.classes.report_optout is
  '수업보고서 미발송(0174a) — 랩실 등 보고서를 쓰지 않는 반. 보고서 작성/발송 화면의 반 목록과 작성률 분모에서 빠지고, 미작성 재촉 알림도 하지 않는다. 이미 작성된 보고서·시간표·급여·공지는 영향 없음. 판정 단일소스 = src/features/classes/report-optout.ts';
