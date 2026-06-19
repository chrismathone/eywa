-- 0035a: 지출결의서 필드 확장 (손수 alpha)
-- ijw 지출결의서 패리티 — 작성자 직위/은행명/계좌번호 + 다단계 결재(작성/원장/대표/집행자).
-- expenses 테이블에 컬럼만 추가(무손실). drizzle 스냅샷 미반영(신규는 전부 손수 alpha — db:generate 금지).
-- approval_checks jsonb 형태: {"author":{"checked":true,"date":"2026-06-19"},"director":{...},"ceo":{...},"executor":{...}}
alter table public.expenses add column if not exists position text;
alter table public.expenses add column if not exists bank_name text;
alter table public.expenses add column if not exists account_number text;
alter table public.expenses add column if not exists approval_checks jsonb not null default '{}'::jsonb;
