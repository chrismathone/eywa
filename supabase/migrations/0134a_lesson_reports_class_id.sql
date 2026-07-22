-- 0134a: 수업보고서 1건의 단위를 **과목 → 반(수업)** 으로 바꾼다.
--
-- 원장 확정(2026-07-22): "보고서 2건 가야지. 수강한 수업마다 1건씩."
--   같은 날 정규 수학 + 수학 특강을 들으면 학부모에게 보고서가 2건 간다(합치기 기각).
--   ⚠️ 학부모가 보는 화면에는 반이 나오지 않는다 — 반은 **내부 매핑 전용**이다.
--
-- 🔴 왜 지금인가 (실측 2026-07-22):
--  · 제약이 `(tenant_id, student_id, report_date, subject)`(0083a)라 정규 수학과 수학 특강이 **같은 키**다.
--    나중 보고서가 앞의 것을 조용히 덮어쓴다.
--  · 지금까지 안 터진 건 이관분 17,365행의 `subject`가 전부 NULL이라 제약이 무력화돼 있었기 때문이다
--    (Postgres 유니크에서 NULL은 서로 다른 값). eywa가 직접 쓴 33행은 subject가 채워져 있어 **앞으로 걸린다**.
--  · 특강 수학반 3개에 이미 **15명이 정규 수학반과 이중 등록** 상태다. 2026-07-21(화) 이성우 보고서 5건은
--    지금도 어느 반 것인지 판별할 수 없다(후보 반 2개).
--  · 영어 발송을 켜는 순간(영어→수학 이어듣기) 같은 문제가 재발한다 — 과목 단위로는 근본 해결이 안 된다.
--
-- 🔴 배포 순서(필수): **이 마이그레이션을 코드보다 먼저 적용한다.** 0133a와 같은 규약 —
--    앱이 `lesson_reports.class_id`를 select/insert 하므로 컬럼 없이 코드만 올라가면 보고서 저장·발송이 전멸한다.
--    적용 확인:
--      select column_name from information_schema.columns
--       where table_name='lesson_reports' and column_name in ('class_id','unit_key');
--      select indexname from pg_indexes where tablename='lesson_reports' and indexname like '%unit_key%';
--    PostgREST 스키마 캐시도 갱신:  notify pgrst, 'reload schema';
--
-- 롤백:
--   drop index if exists lesson_reports_student_date_unit_key;
--   create unique index lesson_reports_student_date_subject_key
--     on lesson_reports (tenant_id, student_id, report_date, subject);
--   alter table lesson_reports drop column if exists unit_key;
--   alter table lesson_reports drop column if exists class_id;
--   (롤백 전에 같은 (student,date,subject) 2행이 생겼는지 먼저 확인 — 있으면 유니크 재생성이 실패한다.)

-- ── 1. 반 참조 ──────────────────────────────────────────────────────────────
-- on delete set null: 반을 지워도 보고서(학부모에게 이미 나간 기록)는 남아야 한다.
alter table public.lesson_reports
  add column if not exists class_id uuid references public.classes(id) on delete set null;

comment on column public.lesson_reports.class_id is
  '이 보고서가 속한 반(수업). 학부모 화면엔 노출하지 않는 내부 매핑 — 같은 날 두 수업(정규+특강)의 보고서를 구분하는 단위다(0134a). 이관분·보강처럼 반을 특정할 수 없으면 NULL.';

-- 반 단위 조회(로스터 당일 행·시간표 hover)용.
create index if not exists lesson_reports_class_date_idx
  on public.lesson_reports (tenant_id, class_id, report_date);

-- ── 2. 백필 — 반을 **모호하지 않게** 특정할 수 있는 행만 ────────────────────
-- 대상: eywa가 직접 쓴 행만(이관분은 반 정보가 애초에 없고, 제약 밖이라 손댈 이유도 없다).
-- 후보 반 = 그 학생이 그 날짜에 수강 중 + 반 과목 = 보고서 과목 + 반 담당강사 이름 = 보고서 teacher_name
--           + 그 요일에 유효한 시간표가 있음.
-- ⚠️ 후보가 **정확히 1개일 때만** 채운다. 여러 개면 추측이 되고, 추측한 반은 곧 "덮어쓰기"로 돌아온다.
-- 실측(적용 전): 대상 31행 중 24행 확정 / 7행 NULL 유지(보강·테스트 학생) / 모호 0건.
-- ⚠️ 요일 판정에 to_char(...,'Dy')를 쓰지 않는다 — lc_time 로케일에 따라 값이 달라진다. dow 인덱스로 고정.
with cand as (
  select distinct lr.id as report_id, c.id as class_id
    from public.lesson_reports lr
    join public.enrollments e on e.student_id = lr.student_id
    join public.classes c on c.id = e.class_id and c.tenant_id = lr.tenant_id
    join public.users u on u.id = c.teacher_id
   where lr.source is distinct from 'edutrix_import'
     and lr.class_id is null
     and lr.subject is not null
     and lr.teacher_name is not null
     and c.subject = lr.subject
     and u.display_name = lr.teacher_name
     and (e.start_date is null or e.start_date <= lr.report_date)
     and (e.end_date is null or e.end_date >= lr.report_date)
     and exists (
       select 1
         from public.class_schedules sc
        where sc.class_id = c.id
          and sc.day_of_week::text
              = (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from lr.report_date)::int + 1]
          and (sc.valid_from is null or sc.valid_from <= lr.report_date)
          and (sc.valid_to is null or sc.valid_to >= lr.report_date)
     )
), uniq as (
  -- ⚠️ min(uuid)는 Postgres에 없다(집계 함수 미정의) → having count(*)=1로 이미 유일한 값을 array_agg로 집는다.
  select report_id, (array_agg(class_id))[1] as class_id
    from cand
   group by report_id
  having count(*) = 1
)
update public.lesson_reports lr
   set class_id = uniq.class_id
  from uniq
 where uniq.report_id = lr.id;

-- ── 3. 유일성 단위 = 반, 반이 없으면 과목 ──────────────────────────────────
-- 왜 **생성열**인가: 0083a가 이미 기록했듯 `.upsert(onConflict)`는 부분·표현식 인덱스를 타겟으로 잡지 못한다.
--   생성열은 평범한 컬럼이라 onConflict 문자열("…,unit_key")로 그대로 지정된다.
-- 왜 **coalesce**인가:
--   · 반이 있으면 반이 단위 → 정규/특강이 서로 안 덮는다.
--   · 반이 없고 과목만 있으면(보강·관리자 직접작성) 예전과 똑같이 과목이 단위 → 재저장이 같은 행을 갱신한다.
--   · 둘 다 없으면 NULL → NULLS DISTINCT라 **이관분 17,365행은 지금과 100% 동일하게 제약 밖**에 남는다.
--     (인덱스 생성이 안전한 이유이기도 하다 — 이관분끼리는 애초에 충돌 판정을 받지 않는다.)
-- ⚠️ 앱측 미러 = src/features/onescreen/report-unit.ts `reportUnitKey`. 한쪽만 바꾸면 규약이 갈라진다.
alter table public.lesson_reports
  add column if not exists unit_key text
  generated always as (coalesce(class_id::text, subject)) stored;

comment on column public.lesson_reports.unit_key is
  '보고서 1건의 유일성 단위(생성열) = 반 우선, 없으면 과목. 앱측 미러는 features/onescreen/report-unit.ts reportUnitKey. NULL(이관분)은 제약 밖(0134a).';

create unique index if not exists lesson_reports_student_date_unit_key
  on public.lesson_reports (tenant_id, student_id, report_date, unit_key);

-- ⚠️ **구 인덱스(lesson_reports_student_date_subject_key)는 여기서 지우지 않는다.**
--    마이그레이션은 코드보다 먼저 적용되므로, 그 사이 몇 분 동안은 **구 코드**가 돌면서
--    `on conflict (tenant_id,student_id,report_date,subject)`로 upsert한다. 여기서 인덱스를 지우면
--    그 구 코드의 보고서 저장이 "no unique or exclusion constraint matching" 에러로 전부 실패한다
--    (한창 수업 중인 시간대에 강사 화면이 통째로 멈춘다).
--    → 배포가 뜬 뒤 **0136a**로 지운다. 두 인덱스가 함께 사는 동안에도 신규 코드는 정상 동작한다
--      (구 인덱스는 같은 학생·날짜·과목 2행을 막지만, 그건 특강 보고서를 실제로 쓸 때만 부딪힌다).
