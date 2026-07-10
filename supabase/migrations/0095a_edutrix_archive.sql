-- 0095a: Edutrix 은퇴 아카이브 — 원본 Supabase 전 테이블 raw 스냅샷 (은퇴 보험).
-- 배경(2026-07-10): Edutrix 완전 종료(Vercel·Supabase 소등) 결정. lesson_reports 운영 반영(풀 이력)과
-- 별개로, 원본을 무손실 보존해 "나중에 그 필드가 필요했는데" 시나리오를 차단한다(미매핑 189건·en_* 포함).
-- 접근: RLS 활성 + 정책 0개 = service_role 전용(앱 표면 없음 — 조회는 관리 스크립트로).
-- 적재: scripts/_edutrix_retire/archive-edutrix.cjs (멱등 upsert, 민감 필드 제거).

create table if not exists edutrix_archive (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_table text not null,
  source_id text not null,
  row jsonb not null,
  archived_at timestamptz not null default now(),
  unique (source_table, source_id)
);

alter table edutrix_archive enable row level security;

comment on table edutrix_archive is
  'Edutrix Supabase 원본 raw 스냅샷(은퇴 보험). 정책 0 = service_role 전용. profiles는 자격증명 필드 제거 후 적재.';
