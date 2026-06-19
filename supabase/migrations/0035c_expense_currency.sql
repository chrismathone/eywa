-- 0035c: 지출 통화 (손수 alpha)
-- ijw 패리티 — 지출결의서별 통화(원/달러/엔 등). 기본 KRW(기존 전건 원화). 합계는 통화별로 분리 집계.
-- expenses에 컬럼만 추가(무손실). drizzle 스냅샷 미반영(신규는 전부 손수 alpha — db:generate 금지).
alter table public.expenses add column if not exists currency text not null default 'KRW';
