-- 0271a — LAB 자리 교시에 **'따로 수업(*LAB)' 표식**을 둔다
--
-- 원장(2026-09-17, 반 수정 폼 교시별 담당 편집기 + 통합뷰 반 카드 캡처와 함께):
-- *"랩실 옆에 토글키를 두고 토글하게 되면 LAB -> *LAB 밑줄 + 이탤릭체 + 가 되도록 변경해줘.
--  (따로 수업듣는 학생들 분리하기위한 조치)"*
--
-- 🔑 왜 라벨(`slot_teacher_label`)을 `*LAB`으로 바꾸지 않고 칸을 새로 두나: LAB 판정(`specialSlotLabel`)을
--    쓰는 곳이 시간표·출결·자리 출석부·강사 시트·시수(돈)·가져오기·SQL(0186a·0209a)까지 수십 곳이다.
--    라벨을 바꾸면 LAB이 '사람'이 되어 시수에 LAB 시간이 섞이고 강사뷰에 `*LAB` 강사 열이 생긴다.
--    칸을 따로 두면 그 소비처는 **한 곳도 안 바뀐다**.
-- 🔑 뜻은 **LAB 자리 교시에서만** 있다 — 다른 교시(강사·JJ)의 값은 앱이 읽지 않는다(저장도 false로 쓴다).
--    ⚠️ 그걸 CHECK로 강제하지 않는다: 시트 가져오기 RPC(0231a)가 기존 행의 라벨만 바꾸는 경로에서 이 칸을
--    모르면 제약에 걸려 **가져오기 전체가 실패**한다.
-- ⚠️ 1단계는 **표시만**이다 — 자리 출석부 명단·출결·시수는 이 칸을 안 본다.
-- ⚠️ 앱은 기존 `class_schedules` 조회에 이 칸을 **끼우지 않고** 켜진 행 id만 따로 읽는다(`lab-separate.ts`) —
--    적용 전에 배포돼도 시간표·반 수정이 산다([[#95]]). 그래도 순서는 SQL 먼저가 원칙이다.
-- ⚠️ `not null`은 0271b에서 푼다 — 옛 가져오기 되돌리기(`rollback_english_structure`)가 `jsonb_populate_record`로
--    이 칸이 없던 스냅샷을 되살리면 NULL이 들어가 되돌리기 전체가 실패한다.
--
-- 롤백: 스크립트·기억에만 둔다(본문에 붙이지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.class_schedules
  add column if not exists lab_separate boolean not null default false;

comment on column public.class_schedules.lab_separate is
  'LAB 자리 교시의 따로 수업(*LAB) 표식 — 표시 전용(0271a). LAB이 아닌 교시에선 의미 없음.';
