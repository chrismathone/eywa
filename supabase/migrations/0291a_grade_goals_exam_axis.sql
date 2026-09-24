-- 0291a — 시험 목표(grade_goals)를 **성적 칸 축**에 잇는다 (원장 2026-09-24 "제안대로 진행", codex 설계 합의 3라운드).
--
-- 왜: 목표는 자유 텍스트 시험명 + 과목으로 성적 한 행을 찾았다. 성적 입력은 시험명을 `중간고사`·`월말평가`처럼
--     **슬롯 라벨만** 저장하므로 해가 바뀌면 같은 이름이 여러 행이 되고(아무 행이나 붙음), `2026년 2학기 중간고사`라고
--     적은 목표는 영영 안 붙었다. 이제 목표도 성적 칸의 주인 축(과목·년도·학기·시험·월)을 저장해 **정확히 한 칸**과 잇는다.
-- 규약: 옛 행(축 없음)은 NULL로 남고 앱이 옛 이름 매칭으로 읽는다. 축이 채워진 목표는 이름 폴백을 절대 안 탄다.
-- 🔑 유니크는 **일반 인덱스**(부분 인덱스 금지 — gotchas #113). NULL 축인 옛 행끼리는 겹치지 않는다.
--    앱은 upsert를 쓰지 않는다 — 같은 칸에 목표가 있으면 **새 목표를 거절**한다(갱신 경로 없음 = 수정 경합 없음).
-- 의존: 0043a(grade_goals) · 0283a(student_grades.school_year/term/exam_slot) · 0288a(exam_month).
-- ⚠️ 적용 전에도 앱은 산다: 목표 조회는 옛 컬럼으로 재조회하고, 새 목표 저장만 한글 사유로 잠긴다([[#95]]).

begin;

alter table public.grade_goals
  add column if not exists school_year smallint,
  add column if not exists term smallint,
  add column if not exists exam_slot text,
  add column if not exists exam_month smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grade_goals_month_chk') then
    alter table public.grade_goals add constraint grade_goals_month_chk check (exam_month between 0 and 12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grade_goals_term_chk') then
    alter table public.grade_goals add constraint grade_goals_term_chk check (term is null or term in (1, 2));
  end if;
end $$;

-- 백필: 같은 테넌트·학생·과목·시험명의 성적이 **정확히 1행**이고 그 행의 년도·학기·시험이 모두 채워진 목표만.
-- (이름이 여러 행과 겹치는 목표는 어느 칸인지 모르므로 손대지 않는다 — 옛 이름 매칭 그대로 읽힌다.)
with m as (
  select g.id, min(s.school_year) as sy, min(s.term) as t, min(s.exam_slot) as sl, min(s.exam_month) as mo,
         count(*) as n, count(s.school_year) as n_sy, count(s.term) as n_t, count(s.exam_slot) as n_sl
  from public.grade_goals g
  join public.student_grades s
    on s.tenant_id = g.tenant_id and s.student_id = g.student_id and s.subject = g.subject and s.exam_name = g.exam_name
  where g.school_year is null
  group by g.id
)
update public.grade_goals g
   set school_year = m.sy, term = m.t, exam_slot = m.sl, exam_month = coalesce(m.mo, 0)
  from m
 where m.id = g.id and m.n = 1 and m.n_sy = 1 and m.n_t = 1 and m.n_sl = 1;

create unique index if not exists ux_grade_goals_cell
  on public.grade_goals (tenant_id, student_id, subject, school_year, term, exam_slot, exam_month);

commit;

-- 적용 확인(읽기만): 축이 붙은 목표 / 옛 이름 매칭으로 남는 목표
select count(*) filter (where school_year is not null) as with_axis,
       count(*) filter (where school_year is null) as name_only
  from public.grade_goals;
