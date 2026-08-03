-- 0171a — 보강(수업외) 보고서에 "어느 수업에서 한 보강인가" 앵커.
--
-- 배경(원장 제보 2026-08-03, 강사 2건):
--  ① "보강 추가한 학생이 **모든 수업**에서 보인다" — 보강 행은 class_id가 NULL이라 반 필터가 가를 수
--     없었고, 필터에서 통째로 사라지는 것을 막으려고 화면이 **모든 반 필터를 통과**시키고 있었다
--     (studentInClass의 isMakeup 우회, 2026-07-27).
--  ② "하은결 보강 보고서를 발송했는데 화면에서 찾을 수 없다" — 보강 행은 로스터(반 수강생)로 재구성되지
--     않는 **임시 클라 행**이라, 새로고침하면 발송한 행이 화면에서 사라졌다(DB엔 멀쩡히 있다).
--
-- 두 문제의 뿌리는 같다: 보강 보고서에 **소속(앵커)이 없다**.
--
-- 🔴 왜 class_id를 쓰지 않는가: `lesson_reports.unit_key`가 `coalesce(class_id::text, subject)` 생성열이고
--    `(tenant, student, report_date, unit_key)`가 유니크다(0134a). 보강에 class_id를 채우면 **같은 반의 정규
--    보고서와 같은 단위**가 되어 서로 덮어쓴다. 그래서 표시·필터 전용 앵커 컬럼을 따로 둔다.
--    ⚠️ 이 컬럼은 unit_key에 들어가지 않는다 — 넣지 말 것.
--
-- NULL = 앵커 없음(옛 보강 171건 전부 + '전체'에서 추가한 보강). 화면은 NULL을 "전체에서만 보임"으로 다룬다.

alter table public.lesson_reports
  add column if not exists makeup_class_id uuid references public.classes(id) on delete set null;

comment on column public.lesson_reports.makeup_class_id is
  '보강 보고서가 "어느 수업 시간에" 진행됐는지(표시·반 필터 앵커 전용). makeup=true일 때만 의미. '
  '⚠️ unit_key(=coalesce(class_id,subject))에 절대 넣지 말 것 — 정규 보고서와 단위가 겹쳐 서로 덮어쓴다.';

-- 로스터가 매일 "그날 내 보강 보고서"를 되살릴 때 쓰는 조회(테넌트+날짜+보강).
create index if not exists lesson_reports_makeup_by_date_idx
  on public.lesson_reports (tenant_id, report_date)
  where makeup;
