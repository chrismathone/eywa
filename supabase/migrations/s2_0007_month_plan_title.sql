-- s2_0007 — 월간 계획서(MP) 제목을 그 달만 고친다 — 원장 2026-10-29
--
-- 원장: *"다음달 달력을 미리 적용해보고 싶어서 그런데, 이게 수업명과 연동되다보니 수업명 수정이 불가능한데 … 자동으로 현재 수업명을
-- 반영하는것을 디폴트로 하고, 디폴트일때는 계속 수업명과 연동되고, 수업명을 그냥 커스텀 수정할 수 있게 … 커스텀 된 값은 현재 수업명을
-- 따라 움직이지 않고, 수정된 값으로 고정되고, 다시 디폴트를 적용하기 전까지 계속 수정된값으로"* · 적용 범위 = **그 달만**(원장 선택).
--
-- 🔑 **새 표를 만들지 않는다**(꼬리말 0240a와 같은 길). `class_month_plan_cells`에 `col_kind = 'title'` 한 종류를 더한다 —
--    `plan_date` = 그 라벨월 1일 · body = 반이 고친 제목. **빈 값(또는 행 없음) = 기본(현재 수업명을 따른다)**.
--    저장 경로(`saveMonthPlanCells`)·게이트(EiE 반 · 쓰기 권한)·감사로그가 그대로 걸린다.
-- ⚠️ 미적용이면 읽기는 그대로(그런 행이 없으니 수업명) · 저장만 CHECK 위반으로 거절된다(화면은 한글 사유 · [[#95]]).
--
-- 되돌리기: scripts/_oneoff/revert-s2_0007-month-plan-title.sql
set local statement_timeout = '60s';

alter table public.class_month_plan_cells drop constraint if exists class_month_plan_cells_kind_ck;
alter table public.class_month_plan_cells
  add constraint class_month_plan_cells_kind_ck
  check (col_kind in ('in_class', 'homework', 'ebook', 'test', 'off', 'footer', 'title'));

notify pgrst, 'reload schema';
