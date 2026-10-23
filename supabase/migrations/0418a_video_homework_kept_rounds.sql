-- 영상 숙제 '옮겨 남긴 숙제' 표시(원장 2026-10-13 — 박한비 9/28·10/1 칸이 미확인으로 바꾸자 사라졌다).
--
-- 보고서에 '영상 과제' 표시가 없는 수업(표시는 2026-10-01부터 저장)은 검사 기록이 있어야만 장부에 칸으로 선다. 선생님이 그 칸을
-- 미확인으로 바꾸거나 영상을 반려하면 기록이 지워져 칸이 사라졌다. 앱이 지우기 전에 그 날짜를 따로 낸 숙제 표에 **옮겨 남긴 숙제**로
-- 한 줄 넣는다(`kept = true`, 앱 `keep-round.ts`).
-- 옮겨 남긴 숙제는 선생님이 낸 숙제가 아니다 — 칸·손 배정·올리기 사이트에서는 숙제로 서지만, 장부의 자동 짝은 뒷순위로만 주고 자동 판정 ·
-- 미제출 알림 · 강사의 '내 숙제' · 운영실 집계에서는 뺀다(앱 `extra-issues.ts`). 정식 숙제로 넣으면 가장 오래된 빈 숙제가 되어 다른 칸의
-- 영상을 가져가고 그 칸이 미수행으로 바뀌며 알림이 나간다(적대적 리뷰 2026-10-13).
--
-- 열 하나만 더한다(기본 false — 지금 있는 줄은 전부 선생님이 낸 숙제). 🔴 앱보다 먼저 적용한다(열이 없으면 앱의 따로 낸 숙제 조회가 실패한다 — [[#95]]). 되돌리기는 이 파일에 적지 않는다.
begin;
set local lock_timeout = '5s';
alter table public.video_homework_extra_issues add column if not exists kept boolean not null default false;
comment on column public.video_homework_extra_issues.kept is
  '검사 기록 칸에서 옮겨 남긴 숙제(미확인·반려 뒤에도 칸을 지킨다). 자동 판정·알림·강사 내 숙제에서 뺀다. 앱 keep-round.ts.';
commit;
notify pgrst,'reload schema';
