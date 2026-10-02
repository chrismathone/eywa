-- 0328a — 수업 보고서의 "영상 첨부 링크 넣기" (원장 2026-10-02 *"체크하면 '영상 첨부 링크 넣기' 토글이 하나 더 생기는걸로"*)
--
-- 원스크린에서 '영상 과제'를 켠 행에 뜨는 둘째 토글의 값이다. 발송 PC가 보고서를 ClassNote에 올리기 직전 앱에 묻고
-- (`/api/internal/video-submit-link`), 앱은 **이 값이 true일 때만** 영상 링크를 준다 — 글은 `보고서 : …/r/…` / `영상첨부 : …/v/…` 두 줄로 나간다.
--
-- 🔴 nullable이 의도다(기본값 금지): null = 고른 적 없음 → 붙이지 않는다. 기본값을 true로 두면 적용 순간
--    영상 과제가 있는 모든 보고서에 강사가 고르지 않은 링크가 붙는다.
-- 🔴 앱은 이 SQL 적용 전에도 돈다(#95) — 컬럼이 없으면 토글을 그리지 않고, 링크는 예전 규칙('영상 과제 있음'이면 붙임)대로 간다.
alter table public.lesson_reports
  add column if not exists video_submit_link boolean;

comment on column public.lesson_reports.video_submit_link is
  '보고서 글에 영상 제출 링크를 넣는다(true)/안 넣는다(false). null = 고른 적 없음(안 넣음). video_homework = true 일 때만 뜻이 있다.';

notify pgrst, 'reload schema';
