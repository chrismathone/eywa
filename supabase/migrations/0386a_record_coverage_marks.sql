-- 0386a — 에이와 기록 범위의 **확정값**(원장 2026-10-20 '2026년 4월부터' · 적대 리뷰 같은 날).
--
-- '에이와 수강 기록이 갖춰진 달'(trust_from)은 최근 36개월 청구로 판정한다(`record-coverage.ts` `trustedFrom`). 청구가 시작된 달이
-- 창(36개월) 밖으로 밀려나면 판정의 출발점이 보이지 않아, 창의 첫 달을 시작으로 보고 안내가 달마다 밀린다(침산이면 2029-04부터
-- "2026년 5월부터" · "6월부터" …). 그래서 시작 달이 창 안에 **보이는 동안** 원생 매일 기록 cron이 판정값을 여기에 적어 두고, 시작이
-- 창 밖으로 나간 뒤에는 이 값을 쓴다(지난 사실은 바뀌지 않는다). 시작이 보이는 동안은 밤마다 다시 적는다(자료가 고쳐지면 따라간다).
--   tenant_id     지점 한 줄
--   billing_from  청구가 지점을 덮기 시작한 달(YYYY-MM)
--   trust_from    에이와 수강 기록이 갖춰진 첫 달(YYYY-MM) — null = 처음부터 갖춰져 자를 것이 없다(줄이 있으면 '판정됨')
-- 🔴 서버 전용(정책 0개 · 0381a·0385a와 같은 방식) — 앱은 관리 키 + tenant_id로 읽고, cron만 쓴다.
-- 배포 순서: 앱보다 먼저(#95) — 읽기 실패는 '확정값 없음'으로 넘어간다(화면은 안 죽는다).
-- 되돌리기: 이 표를 지운다(판정은 다시 창 안 청구로만 한다).

create table if not exists public.record_coverage_marks (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  billing_from text not null check (billing_from ~ '^\d{4}-\d{2}$'),
  trust_from text check (trust_from is null or trust_from ~ '^\d{4}-\d{2}$'),
  decided_at timestamptz not null default now()
);
comment on table public.record_coverage_marks is '에이와 기록 범위 확정값 — 청구 시작 달·수강 기록이 갖춰진 달(시작이 36개월 창 안에 보일 때 cron이 적는다). 0386a.';

alter table public.record_coverage_marks enable row level security;
revoke all on public.record_coverage_marks from public, anon, authenticated;
grant all on public.record_coverage_marks to service_role;
