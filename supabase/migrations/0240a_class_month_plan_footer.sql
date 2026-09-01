-- 0240a: EiE 월간 계획서(MP) — **반별 꼬리말**(2026-09-02).
--
-- 원장 2026-09-02: *"하단은 수정가능하게. 고정 멘트 아님. LE1 멘트는 이것이 맞음."*
-- 지금까지 꼬리말(슬로건 + Prep 안내)은 학원설정 `operations.subjects[].monthPlan` 하나였다 —
-- 즉 **모든 EiE 반이 같은 문구**였다. LE1 문구가 맞다는 말은 곧 다른 반은 다를 수 있다는 뜻이라,
-- 반 단위로 덮어쓸 자리가 필요하다.
--
-- 🔑 **새 표를 만들지 않는다.** 0239a `class_month_plan_cells`가 이미 (반·날짜·칸 종류) 격자를
--    담고 있고, 저장 경로(`saveMonthPlanCells`)·게이트·낙관적 저장이 전부 그 표에 걸려 있다.
--    꼬리말은 `col_kind = 'footer'` 한 종류를 더하는 것으로 끝난다 —
--    `plan_date`는 **그 달 1일**을 쓴다(꼬리말은 칸이 아니라 문서 아래 한 덩어리라 날짜 축이 없다.
--    조회가 이미 그 달 범위로 긁으므로 1일 행이 같이 딸려 온다).
--
-- 🔴 **세션 줄(`❤ 9월 세션 : …❤`)은 여기 담기지 않는다.** 그건 `operating_periods`가 해석한 날짜라
--    글자로 굳히면 세션이 바뀐 달에 거짓이 된다. 편집 대상은 그 아래(슬로건·Prep 안내)뿐이다.
--
-- ⚠️ 미적용이면 **읽기는 그대로**(그런 행이 없으니 학원설정 기본값이 나온다)이고, 저장만 CHECK 위반으로
--    거절된다 — 화면은 한글 사유를 띄우고 낙관적 값이 되돌아간다([[#95]] fail-soft).
-- 롤백: CHECK를 옛 목록으로 되돌리기 전에 `delete from class_month_plan_cells where col_kind='footer'`.

alter table class_month_plan_cells drop constraint if exists class_month_plan_cells_kind_ck;
alter table class_month_plan_cells
  add constraint class_month_plan_cells_kind_ck
  check (col_kind in ('in_class', 'homework', 'ebook', 'test', 'off', 'footer'));
