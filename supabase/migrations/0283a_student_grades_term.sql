-- 성적 입력표(원장 2026-09-22) — 시험을 따로 등록하지 않고 `년도·학기·과목·반·시험 칸`으로 바로 적는다.
-- student_grades에 학기 축 3개(school_year·term·exam_slot)와 입력 맥락(class_id)을 더한다. 멱등.
--
-- (번호 이력: 0281a -> 0282a -> 0283a. 같은 날 다른 작업이 앞 번호를 먼저 가져가 두 번 밀렸다.
--  내용은 2026-09-22에 원장이 이미 적용했다 — 이 파일을 다시 돌려도 안전하다.)
--
-- 🔑 한 칸의 주인은 **(학생, 과목, 년도, 학기, 시험 칸)**이다 — 학교 시험 성적이라 반이 둘이어도 성적은 하나.
--    그래서 class_id는 유니크 축에 **안 들어간다**(어느 반 화면에서 적었는지를 남기는 값일 뿐).
-- 🔴 부분 유니크(WHERE)를 쓰지 않는다([[#113]]) — 옛 자유 입력 행은 새 컬럼이 NULL이라 어차피 서로 안 겹치고,
--    술어를 붙이면 `upsert(onConflict)`가 42P10으로 전건 실패한다.
-- ⚠️ 적용 전에도 화면은 산다(조회 fail-soft + 입력 잠금, [[#95]]) — 적용해야 저장이 열린다.
alter table public.student_grades
  add column if not exists school_year int,
  add column if not exists term smallint,
  add column if not exists exam_slot text,
  add column if not exists class_id uuid references public.classes(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_grades_term_chk') then
    alter table public.student_grades
      add constraint student_grades_term_chk check (term is null or term in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'student_grades_slot_chk') then
    alter table public.student_grades
      add constraint student_grades_slot_chk
      check (exam_slot is null or exam_slot in ('listening', 'midterm', 'final'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'student_grades_year_chk') then
    alter table public.student_grades
      add constraint student_grades_year_chk
      check (school_year is null or (school_year between 2000 and 2100));
  end if;
end $$;

-- 같은 학생의 같은 시험 칸은 한 행뿐 — upsert가 이 인덱스로 추론한다.
create unique index if not exists ux_grades_term_slot
  on public.student_grades (tenant_id, student_id, subject, school_year, term, exam_slot);

-- 격자 한 판 조회(학기 × 과목 × 시험 칸)의 축.
create index if not exists grades_term_slot_idx
  on public.student_grades (tenant_id, subject, school_year, term, exam_slot);

create index if not exists grades_class_idx on public.student_grades (class_id);

notify pgrst, 'reload schema';
