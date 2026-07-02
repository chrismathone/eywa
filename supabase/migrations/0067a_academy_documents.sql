-- 0067a_academy_documents.sql (손수 alpha)
-- "데이터베이스" 메뉴 — 학원 각종 서식(등록신청서·동의서·계약서 등) 저장소.
-- kind='file': 업로드 파일(경로는 media-storage 추상화, GCS/Supabase) / kind='text': 앱 내 작성·인쇄 가능 문서.
-- ⚠️ 향후(v2): kind='file' 업로드 시 AI OCR로 본문 추출 → ocr_text/metadata 컬럼 추가 + 검색 색인 예정(schema.ts 주석 참조).
-- enum도 여기서 생성 — 손수 alpha 전용 흐름(db:generate 금지)이라 drizzle이 안 만들어 준다.
do $$ begin
  create type academy_document_category as enum ('enrollment', 'billing', 'consultation', 'hr', 'class', 'other');
exception when duplicate_object then null;
end $$;

create table if not exists academy_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  category academy_document_category not null default 'other',
  kind text not null,                                  -- 'file' | 'text'
  description text,
  file_path text,
  file_name text,
  file_size integer,
  mime_type text,
  body text,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_documents_kind_check check (kind in ('file', 'text'))
);

create index if not exists academy_documents_tenant_category_idx
  on academy_documents (tenant_id, category, created_at);

alter table academy_documents enable row level security;

drop policy if exists academy_documents_tenant_isolation on academy_documents;
create policy academy_documents_tenant_isolation on academy_documents
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());
