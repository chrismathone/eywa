-- 성적표 받기 **독촉 단계**(원장 2026-09-22) — 성적 칸마다 `1차 요청 · 2차 요청 · 받아서 확인`.
-- 점수와 같은 칸(학생·과목·년도·학기·시험)에 붙는다. 멱등.
--
-- 🔑 불리언이 아니라 **시각 + 누른 사람**이다 — "언제 독촉했나"가 이 기능의 쓸모고, 체크만 남기면
--    두 번째 독촉을 할지 판단할 근거가 사라진다. 화면은 체크박스로 보이고 마우스 오버로 날짜를 말한다.
-- 🔴 점수가 없어도 이 칸은 선다(아직 성적표를 못 받은 학생이 곧 독촉 대상이다) — 그래서 점수를 비울 때
--    **표식이 하나라도 있으면 행을 지우지 않는다**(write.ts).
-- ⚠️ 0283a(학기 축)가 먼저다. 적용 전에도 화면은 살고 체크박스만 잠긴다([[#95]]).
alter table public.student_grades
  add column if not exists ask1_at timestamptz,
  add column if not exists ask1_by uuid references public.users(id) on delete set null,
  add column if not exists ask2_at timestamptz,
  add column if not exists ask2_by uuid references public.users(id) on delete set null,
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.users(id) on delete set null;

-- 독촉 목록(아직 못 받은 칸)을 그 학기·시험 축으로 좁혀 읽는 자리.
create index if not exists grades_received_idx
  on public.student_grades (tenant_id, school_year, term, exam_slot, received_at);

notify pgrst, 'reload schema';
