-- s2_0005 — 미룸·당김 표식의 출처(origin) — 원장 2026-10-28 *"작업해"*
--
-- 시간표 반 블록 옮기기((가)안)가 옮긴 뒤 **비는 회차**에 칸 미룸 표식(skip)을 쓴다(교재 계산이 옮긴 계획 줄과 어긋나지
-- 않게 · move-actions.ts). 그런데 '원래 계획'(baselineByCell — 달력 판정 칩 · 비교 모달 · 현황의 미작성/늦음)은 미룸을
-- 반영하지 않으므로, 그 회차가 '미작성', 그 뒤 칸이 책이 끝날 때까지 '1차수 늦음'으로 잡혔다(3차 적대 리뷰 2026-10-28).
-- 시간표가 바뀌어 회차가 빈 것은 강사가 밀린 것이 아니다 → 이동이 쓴 표식만 원래 계획에도 반영한다.
--
--   origin = 'manual'          강사가 누른 미룸·당김(종전 전부) — 원래 계획엔 반영하지 않는다.
--            'timetable_move'  반 블록 옮기기가 비는 회차에 쓴 칸 skip — 원래 계획에도 반영한다.
--
-- kind는 그대로 skip이라 일정 계산·릴레이·토글은 바뀌지 않는다(그 칸을 강사가 당김으로 풀면 표식이 지워져 원래 계획도
-- 그 회차를 다시 센다).
-- ⚠️ 앱은 이 칸이 **없어도 돈다**([[#95]]) — 읽기는 칸 없이 다시 읽고(전부 manual), 쓰기는 칸 없이 다시 쓴다. 적용 순서 무관.
-- 지난 데이터 채움 없음 — 반 옮기기는 이 기능 배포 전 운영에서 한 번도 저장되지 않았다(감사로그 class_schedule_move 0건).
--
-- 되돌리기: scripts/_oneoff/revert-s2_0005-lesson-shift-origin.sql
set local statement_timeout = '60s';

alter table public.class_lesson_shifts
  add column if not exists origin text not null default 'manual';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_lesson_shifts_origin_chk') then
    alter table public.class_lesson_shifts
      add constraint class_lesson_shifts_origin_chk check (origin in ('manual', 'timetable_move'));
  end if;
end $$;

comment on column public.class_lesson_shifts.origin is
  '표식 출처 — manual(강사) · timetable_move(반 블록 옮기기가 비는 회차에 쓴 칸 skip, 원래 계획에도 반영). s2_0005';

notify pgrst, 'reload schema';
