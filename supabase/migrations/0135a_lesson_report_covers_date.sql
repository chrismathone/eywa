-- 0135a: 수업보고서에 **실제 수업일(covers_date)** — 미리/나중에 쓴 보고서를 그 수업 날짜로 귀속(원장 2026-07-22).
--
-- 배경: 시험대비처럼 **수업을 미리** 하고 보고서를 먼저 보내는 경우가 있다.
--   예) 7/19 수업분을 7/3에 미리 작성·발송 → 작성률은 report_date(7/3)로만 집계하므로
--       7/19에는 "미작성"으로 빨갛게 뜬다. 강사는 일을 다 했는데 억울하고, 관리자는 오해한다.
-- 해결: 보고서에 "이건 며칠 수업분"인지 날짜를 달면, 작성률이 **그 날짜로** 집계된다.
--
-- ⚠️ 의미는 **이동**이지 복사가 아니다 — covers_date가 있으면 그 보고서는 report_date가 아니라
--    covers_date에만 집계된다. 복사로 하면 보고서 1건이 두 날을 채워 작성률이 부풀고,
--    "실제로 두 번 수업했는가"를 화면이 구분할 수 없게 된다.
-- ⚠️ **내부 메타데이터 전용**(원장 확정): 학부모는 알 필요 없다 — ClassNote 발송 페이로드·
--    학부모용 보고서에는 절대 싣지 않는다. 작성률 집계와 내부 목록에서만 쓴다.
-- null = 기존 동작(report_date로 집계). 롤백 = drop column.

alter table public.lesson_reports
  add column if not exists covers_date date;

comment on column public.lesson_reports.covers_date is
  '실제 수업일 — 미리/나중에 쓴 보고서를 그 수업 날짜로 귀속시켜 작성률을 바로잡는다(0135a). '
  'null이면 report_date 사용. **이동**이지 복사 아님(한 보고서는 한 날짜에만 집계). '
  '⚠️ 내부 메타데이터 — 학부모 발송 페이로드에 넣지 말 것.';

-- 작성률은 (강사, 유효일) 집계라 covers_date로도 범위 조회를 한다.
create index if not exists lesson_reports_covers_date_idx
  on public.lesson_reports (tenant_id, covers_date)
  where covers_date is not null;
