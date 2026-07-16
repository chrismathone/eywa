-- 0114a_onescreen_student_order.sql (손수 alpha)
-- 원스크린 학생 표시 순서(강사×반 개인 설정) — edutrix '순서변경' 패리티(2026-07-16 단체작성 전수비교 감사 3-2).
-- 강사가 좌석·채점지 순서대로 학생을 재배열해 저장하면, 다음 작성 때 roster가 그 반 그룹 내부만 재배열해 로드한다
-- (반 시각순 등 상위 정렬 보존, 미등재 신규 학생은 기존 정렬대로 뒤 — src/features/onescreen/student-order.ts).
-- RLS는 tenant-isolation만, "본인(teacher) 행만" 스코프는 앱 레이어가 강제(order-actions.ts가 teacher_id를
-- 클라 입력이 아니라 effectiveTeacherId로 서버 파생 + 담당 반 소유 확인 — 0112a expenses.created_by와 동일 철학).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists onescreen_student_order (
  tenant_id uuid not null references tenants(id) on delete cascade,
  teacher_id uuid not null references users(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  student_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, teacher_id, class_id)
);

alter table onescreen_student_order enable row level security;

drop policy if exists onescreen_student_order_tenant_all on onescreen_student_order;
create policy onescreen_student_order_tenant_all on onescreen_student_order
  for all using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
