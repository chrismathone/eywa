-- 수업보고서 평점(참고용) — 원장 2026-10-23 *"평점 열을 추가하고 우리가 가진 평점을 업로드하고 마우스 올리면
-- 이 평점에 대한 근거를 참고용으로 알 수 있게"*.
--
-- 🔑 값은 2026-10-22 원장 지시로 **오프라인 배치 1회**(Claude Haiku 5.5 medium + 코드 규칙, Codex와 대조)가 매긴 것이다 —
--    우리 앱이 보낸 수업보고서(07-14~10-22, 지점 침산) 5,256건. 기준 = "학부모가 받아봤을 때 좋은 감정을 느끼는가".
--    항목 다섯(따뜻함·개별성·아쉬운 점 전달·알기 쉬움·믿음) 0~5, 종합(points) = 해당 있는 항목 평균.
-- 🔴 앱은 AI를 부르지 않는다 — 이 표에 저장된 값만 보여 준다(새 보고서는 평점 없음 '—'). 행은 업로드 스크립트가 넣는다.
--
-- claim(클레임 위험) 뜻 — null = 위험 신호 없음:
--   confirmed   = 2단계 검증(Sonnet·Codex) 둘 다 클레임 위험이라 봄
--   needs_check = 둘이 엇갈림
--   cleared     = 1차는 걸렸지만 검증에서 풀림
--   flagged     = 1차만 걸리고 검증 안 함
-- items = [{"key":"warmth","label":"따뜻함","score":4,"note":"…"}, …] · score 0 = 해당 없음.
--
-- 🔴 RLS 정책 0개 = 의도적([[#92]] "의도적 제외는 마이그레이션에 적어라"): 선생님 보고서를 평가한 값이라 PostgREST 직결로
--    열지 않는다. 앱은 수업보고서 쓰기 권한(canWriteTenant 'lesson_reports')을 서버에서 다시 본 뒤
--    admin + tenant_id 필터로 읽는다([[#104]] — 정책 0개 표를 세션 클라이언트로 읽으면 에러 없이 0행).
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다 — 표가 없으면 목록은 평점 없이 그대로 뜬다([[#95]]).
-- 되돌리기 = scripts/_oneoff/revert-0450a-lesson-report-ratings.sql (본문에 붙이지 않는다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.lesson_report_ratings (
  report_id uuid primary key references public.lesson_reports (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  points numeric(3,2) not null check (points between 0 and 5),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  parent_feeling text,
  suggestion text,
  claim text check (claim in ('confirmed', 'needs_check', 'cleared', 'flagged')),
  claim_reason text,
  rubric text not null,
  model text not null,
  rated_on date not null,
  created_at timestamptz not null default now()
);
create index if not exists lesson_report_ratings_tenant_idx on public.lesson_report_ratings (tenant_id);

alter table public.lesson_report_ratings enable row level security;
-- 정책 0개(의도적, 위 머리 주석) — anon·authenticated엔 권한 자체를 주지 않는다.
revoke all on public.lesson_report_ratings from public, anon, authenticated;
grant select, insert, update, delete on public.lesson_report_ratings to service_role;

comment on table public.lesson_report_ratings is
  '수업보고서 평점(참고용). 2026-10-22 오프라인 배치 1회가 매긴 값 — 앱은 AI를 부르지 않고 저장값만 보여 준다. 정책 0개(의도적) — 수업보고서 쓰기 권한자만 앱(admin + tenant_id)으로 읽는다.';

commit;

notify pgrst, 'reload schema';
