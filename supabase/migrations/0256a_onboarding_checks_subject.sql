-- 0256a — 신규생 관리 체크를 **과목별로**
--
-- 원장 2026-09-10: *"신규생 관리에 '과목'도 붙여줘. 여러 과목이면 과목별로 행이 존재해야함."* →
-- 체크도 과목별로 따로 할지 물었더니 **"과목별로 따로"**.
--
-- 🔑 실측(2026-09-10, injaewon): 최근 90일 신규 31명 중 **9명이 수학+영어**다. 두 과목은 담당·전화하는
--    사람이 달라서 "사전 콜"이 과목마다 따로 있다. 학생 한 줄에 체크를 한 벌만 두면 수학 콜을 하는 순간
--    영어 콜까지 끝난 것처럼 보인다.
--
-- 🔴 **추가만 한다(expand)** — 컬럼 하나 + 유니크 교체. 앱은 이 SQL이 돌기 전에도 산다([[#95]]):
--    `subject`를 못 읽으면 전 기록을 과목 무관('')으로 보고, 쓰기도 옛 모양으로 떨어진다.
-- 🔴 **옛 기록은 과목 무관('')** 으로 남는다(지금 7행). 앱은 과목 칸 기록이 없으면 이 줄을 **그 학생의 모든
--    과목 행**에 비춘다 — 옛 체크가 사라지지도, 한 과목에만 붙지도 않는다.
-- 🔴 **부분 유니크(WHERE) 금지**([[#113]]) — 앱이 `on conflict (tenant_id, student_id, subject, item_key)`로
--    upsert한다. `subject`를 NOT NULL + 기본값 ''로 둔 것도 같은 이유다(NULL은 유니크에서 서로 안 겹쳐
--    같은 칸이 두 줄 생긴다).
set local statement_timeout = '60s';

alter table public.student_onboarding_checks
  add column if not exists subject text not null default '';

-- 과목 키 모양 — 학원설정 `subjects[].key`와 같은 글자(`math`·`english`·`subject_1`) 또는 ''(과목 무관).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'student_onboarding_checks_subject_fmt') then
    alter table public.student_onboarding_checks
      add constraint student_onboarding_checks_subject_fmt
      check (subject = '' or subject ~ '^[a-z][a-z0-9_]{0,31}$');
  end if;
end $$;

-- 유니크 교체: (학생, 항목) → (학생, 과목, 항목).
alter table public.student_onboarding_checks
  drop constraint if exists student_onboarding_checks_uniq;
alter table public.student_onboarding_checks
  add constraint student_onboarding_checks_uniq unique (tenant_id, student_id, subject, item_key);

comment on column public.student_onboarding_checks.subject is
  '과목 키(학원설정 subjects[].key). 빈 문자열 = 과목 무관(0256a 이전 기록) — 앱이 그 학생의 모든 과목 행에 비춘다.';

notify pgrst, 'reload schema';
