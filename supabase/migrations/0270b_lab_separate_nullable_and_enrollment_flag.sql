-- 0270b — 0270a 후속: ① `class_schedules.lab_separate`의 not null을 푼다 ② 수강에 '*LAB 교시 배정' 칸을 둔다
--
-- ① 적대적 리뷰(2026-09-17): 옛 영어 시간표 가져오기 되돌리기(`rollback_english_structure`)는
--    `insert … select r.* from jsonb_populate_record(null::class_schedules, rec)`로 행을 되살린다. 0270a 전에 찍힌
--    스냅샷엔 `lab_separate` 키가 없어 **NULL**이 들어가고, not null에 걸려 되돌리기 **전체가 실패**한다.
--    앱은 이 칸을 `.eq(true)`로만 읽고 쓸 때는 늘 true/false를 명시하므로 NULL = 꺼짐으로 충분하다.
--
-- ② 원장(2026-09-17): *"EiE 의 경우 토글 랩에 배정할 수 있게 따로 기능이 있어야겠어. '특정 요일만 등원' 이외에 하나 더"*
--    → 반 상세 학생 줄 열 순서 *"요일 / EiE토글 / 수강기간 / 수강 종료"* · *"EiE 수업이 아니면 EiE 토글은 없어도"*.
--    고른 규칙: 켠 학생은 **LAB실 출석부의 *LAB 교시에만** 서고 같은 반의 일반 LAB 교시에선 빠진다(끈 학생은 반대) ·
--    **즉시 적용(날짜 없음)** — 이력은 감사로그.
--    🔴 not null을 걸지 않는다(①과 같은 이유 — 되살리기 경로가 이 칸을 모를 수 있다). NULL = 꺼짐.
--
-- ⚠️ 앱은 두 칸 모두 기존 select에 끼우지 않고 따로·fail-soft로 읽는다([[#95]]).
-- 롤백: 스크립트·기억에만 둔다(본문에 붙이지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.class_schedules
  alter column lab_separate drop not null;

alter table public.enrollments
  add column if not exists lab_separate boolean default false;

comment on column public.enrollments.lab_separate is
  '이 수강생을 반의 따로 수업(*LAB) 교시에 배정 — LAB실 출석부에서 *LAB 교시에만 선다(0270b). NULL = 꺼짐.';

-- 칸 추가 직후 API 스키마 캐시가 늦으면 insert 본문의 새 키가 PGRST204로 거절된다 — 바로 다시 읽게 한다.
notify pgrst, 'reload schema';
