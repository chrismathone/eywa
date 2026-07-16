-- 0112a_expenses_created_by.sql (손수 alpha)
-- 지출결의서를 강사도 작성(제출)할 수 있게 되면서, "본인 작성분만" 스코프를 이름 문자열(author)이 아니라
-- 작성자 user id로 확정한다(동명이인 누수 방지). textbook_orders와 동일하게 RLS는 tenant-isolation만 유지하고
-- (사무실은 전건 열람) 강사 own-only 스코프는 앱 레이어(expense-actions/queries의 created_by 대조)가 강제한다.
-- 기존 행(사무실이 만든 결의서·ijw 임포트본)은 created_by=NULL → 강사 목록엔 안 뜨고 사무실 /billing엔 그대로.
alter table public.expenses
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists expenses_tenant_creator_idx on public.expenses (tenant_id, created_by);
