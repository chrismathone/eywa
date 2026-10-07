-- 0352a — 월별 출석부 '합계 및 실급여 보여주기' = 선생님별 스위치 (원장 2026-10-07).
--
-- 원장: "권한자가 월별 출석부에서 해당 선생님의 실급여 보이기 토글을 on하면 실제 강사뷰의 강사가
--        출석부에서 합계 및 실급여를 볼 수 있게"
--
-- 그전엔 이 토글이 **누르는 사람의 보기 설정**(users.ui_prefs.attendance.showActualSalary)이라 선생님 화면엔
-- 아무 영향이 없었다. 이제 선생님마다 한 줄을 두고, 켜져 있으면 관리자 화면과 그 선생님 본인 출석부 양쪽에
-- 실급여 열·합계가 선다.
--
-- · 급여 비율(0280a attendance_salary_rates)과 **따로** 둔다 — 그 표는 비율이 저장된 사람만 줄이 있고
--   (없으면 계약 비율에서 채운다), 스위치만 켜려고 비율 줄을 만들면 계약 비율이 그 순간 값으로 굳는다.
-- · 서버 전용(0280a와 같은 규약) — 앱이 급여 비율 설정 권한 · 지점 · 프리랜서 여부를 확인한 뒤 읽고 쓴다.
--   선생님 계정이 직접 읽거나 고칠 수 없다(본인 계정의 보기 설정에 두면 스스로 켤 수 있다).
create table if not exists public.attendance_salary_teacher_view (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  visible boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, teacher_id)
);
alter table public.attendance_salary_teacher_view enable row level security;
revoke all on public.attendance_salary_teacher_view from anon, authenticated;
grant all on public.attendance_salary_teacher_view to service_role;
notify pgrst, 'reload schema';
