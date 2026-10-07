-- 0355a — 반 × 달 '자리(JJ실·랩실) 몫을 수업 몫으로 돌리기' 조정값 (원장 2026-10-07).
--
-- 원장: "JJ가 한달에 정해진 횟수를 19/5 이렇게 강제로 정한다기보다 20/4 등 유도리있게"
--       "어떤반의 수업/JJ 비율을 19/5를 20/4로 변경할 수 있으면 가장 편할거같은데 · LAB도 마찬가지겠고"
--       "반별로 한번에 설정도 가능하고, 반 내에서 개별적으로도 설정 가능하게"
--
-- 영어 반의 등록 차수(= 실급여 상한)는 그 달 시간표에서 선생님 몫과 자리 몫(JJ실·랩실)으로 나뉜다(수업 19 / 자리 5).
-- 담당이 자리 수업을 대신한 달은 선생님이 실제로 더 가르쳤는데 몫은 시간표대로라 급여가 상한에 걸렸다. 이 표는 그 달 그 반에서
-- 자리 몫 가운데 몇 시수를 그 선생님 몫으로 돌릴지를 적는다 — 날짜를 고르지 않고, 출결 기록도 건드리지 않는다.
--
-- · `units` = 반 전체에 적용할 값(0.5 단위, 0 = 반 전체 조정 없음).
-- · `student_units` = 따로 정한 학생만 `{ 학생 id: 시수 }` — 있으면 그 학생은 반 전체 값 대신 이 값을 쓴다(0도 값이다).
-- · 서버 전용(0280a·0352a와 같은 규약) — 앱이 급여 비율 설정 권한 · 지점 · 그 반 담당 여부를 확인한 뒤 읽고 쓴다.
--   선생님 계정이 직접 읽거나 고칠 수 없다(제 급여 상한을 스스로 올릴 수 있게 된다).
-- ⚠️ 자리 몫보다 많이는 못 돌린다 — 앱이 학생마다 그 줄의 자리 계획 몫까지만 옮긴다(`withTakenSeatUnits`).
create table if not exists public.attendance_seat_share_adjust (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  teacher_id uuid not null references public.users(id) on delete cascade,
  units numeric(4,1) not null default 0 check (units >= 0 and units <= 60 and units * 2 = trunc(units * 2)),
  student_units jsonb not null default '{}'::jsonb check (jsonb_typeof(student_units) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, class_id, period, teacher_id)
);
alter table public.attendance_seat_share_adjust enable row level security;
revoke all on public.attendance_seat_share_adjust from anon, authenticated;
grant all on public.attendance_seat_share_adjust to service_role;
notify pgrst, 'reload schema';
