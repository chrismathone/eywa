-- 0086a: 학부모 공개 보고서(/r/[token]) 조회 로그 — 부모가 링크를 몇 번 열었는지 기록.
-- 강사 원스크린 보고서 카드에 "N회 열람" 배지로 표시(share_link_views count).
--
-- RLS = select-only(테넌트 멤버 read). 공개 /r 페이지의 insert는 service_role(admin client)이 RLS bypass로 통과
-- (0058a/0073a/0084a 패턴 — write 정책 없음 = 직접연결/service_role만). ip_hash는 원본 IP 미저장(0048a intake 관례).
create table if not exists share_link_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lesson_report_id uuid not null references lesson_reports(id) on delete cascade,
  ip_hash text,                 -- sha256(ip + ':' + tenant_id), 원본 IP 미저장(PII 회피, 0048a)
  user_agent text,
  viewed_at timestamptz not null default now()
);

create index if not exists share_link_views_report_idx on share_link_views (lesson_report_id, viewed_at);
create index if not exists share_link_views_tenant_idx on share_link_views (tenant_id, viewed_at);

alter table share_link_views enable row level security;

-- 테넌트 멤버는 자기 테넌트 조회로그 read. 공개 /r insert는 service_role bypass(정책 없음).
drop policy if exists share_link_views_tenant_read on share_link_views;
create policy share_link_views_tenant_read on share_link_views
  for select using (tenant_id = auth_tenant_id());
