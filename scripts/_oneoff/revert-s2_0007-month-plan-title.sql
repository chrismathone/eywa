-- s2_0007 되돌리기 — 반이 고친 계획서 제목(col_kind='title')을 지우고 CHECK를 옛 목록으로.
-- ⚠️ 지운 제목은 되살아나지 않는다 — 필요하면 먼저 `select * from class_month_plan_cells where col_kind='title'`로 떠 둔다.
set local statement_timeout = '60s';

delete from public.class_month_plan_cells where col_kind = 'title';

alter table public.class_month_plan_cells drop constraint if exists class_month_plan_cells_kind_ck;
alter table public.class_month_plan_cells
  add constraint class_month_plan_cells_kind_ck
  check (col_kind in ('in_class', 'homework', 'ebook', 'test', 'off', 'footer'));

notify pgrst, 'reload schema';
