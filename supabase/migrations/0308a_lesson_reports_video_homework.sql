-- 0308a — 수업 보고서의 "오늘 영상 과제 있음/없음" (원장 2026-09-30 *"여기에 영상과제 있음 없음 체크할 수 있게 영상아이콘으로"*)
--
-- 강사가 원스크린(표·카드)에서 그 수업에 영상 과제를 냈는지 표시한다. 다음 수업의 '지난 수업 영상 숙제' ✓/✕ 검사는
-- 직전 보고서가 **없음(false)** 이면 뜨지 않는다.
--
-- 🔴 nullable이 의도다(기본값 false 금지): null = "모름"(이 기능 전의 보고서·다른 저장 경로) → 예전처럼 학원설정
--    정책대로 검사 칸을 띄운다. 기본값을 false로 두면 적용 순간 모든 옛 보고서가 '영상 과제 없음'이 되어
--    다음 날 검사 칸이 전부 사라진다.
-- 🔴 앱은 이 SQL 적용 전에도 돈다(#95) — 컬럼 유무를 probe하고 없으면 저장·조회에서 이 칸만 빠진다.
alter table public.lesson_reports
  add column if not exists video_homework boolean;

comment on column public.lesson_reports.video_homework is
  '오늘 영상 과제 있음(true)/없음(false). null = 모름(기능 이전·다른 저장 경로) — 다음 수업 영상 숙제 검사는 false일 때만 숨긴다.';

-- 원스크린·영상 제출 현황이 "학생 × 최근 날짜 × 값 있음"으로 찾는다 — 값이 있는 행만 담는 부분 인덱스.
create index if not exists lesson_reports_video_homework_idx
  on public.lesson_reports (tenant_id, student_id, report_date)
  where video_homework is not null;

notify pgrst, 'reload schema';
