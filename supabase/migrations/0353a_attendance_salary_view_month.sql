-- 0353a — '합계 및 실급여 보여주기' 스위치를 **달마다 따로** (원장 2026-10-07).
--
-- 원장: "이 버튼은 매월별 따로 저장되게. 9월에 보여주기 눌렀다고해서 10월에 보여주는건 아님."
--       "지금 9월에는 토글 on 해주고 10월은 토글 off"
--
-- 0352a는 선생님마다 한 줄이라 한 번 켜면 모든 달에 보였다. 달(`period`, YYYY-MM)을 더해 선생님 × 달 한 줄로 바꾼다.
--
-- 두 단계로 나눈다(앱보다 SQL이 먼저 나가도, 앱이 먼저 나가도 죽지 않게 — expand / contract):
--   · 이 파일(늘리기): 달 칸을 **기본값 '2026-09'**로 더하고(지금 켜 둔 줄 = 9월 켜짐 · 10월은 줄이 없어 꺼짐),
--     새 키(지점 · 선생님 · 달) 유니크 인덱스를 더한다. 옛 기본키(지점 · 선생님)는 아직 둔다 — 옛 앱의 저장이 그 키로 upsert한다.
--   · 0353b(줄이기): 새 앱이 나간 뒤 옛 기본키를 떼고 새 키를 기본키로, 달 기본값을 뗀다.
alter table public.attendance_salary_teacher_view
  add column if not exists period text not null default '2026-09'
  check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
create unique index if not exists attendance_salary_teacher_view_month_key
  on public.attendance_salary_teacher_view (tenant_id, teacher_id, period);
notify pgrst, 'reload schema';
