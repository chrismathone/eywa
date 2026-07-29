-- 0155a — 🔴 수납 백업 테이블 익명 노출 차단 (2026-07-29 성능 감사 곁다리 발견)
--
-- 문제: public.invoices_bak_20260708 이 **RLS 비활성 + anon/authenticated 전권**으로 남아 있었다.
--       브라우저에 노출되는 공개 anon 키만으로
--         GET /rest/v1/invoices_bak_20260708
--       가 HTTP 206 + content-range 0-1/2002 로 **실제 수납 데이터를 반환**하는 것을 실증했다.
--       노출 내용 = injaewon 실데이터 2,002행(2026-03~07), 합계 ₩795,877,775,
--       student_id·카드사·현금영수증번호 포함. SELECT뿐 아니라 INSERT/UPDATE/DELETE/TRUNCATE 까지
--       anon 에 부여돼 있어 익명 파괴도 가능한 상태였다.
--
-- 원인: supabase/migrations 에 없는 **애드혹 생성물**(psql/대시보드에서 직접 만든 백업)이라
--       마이그레이션 리뷰 게이트를 통째로 우회했다. public 스키마의 새 테이블은 PostgREST가
--       자동으로 노출하고, Supabase 기본 grant가 anon/authenticated 에 붙는다.
--
-- 조치: 권한 회수 + RLS 활성. **정책은 만들지 않는다** — RLS on + 정책 0개 = 아무도 못 읽는다
--       (service_role 은 RLS 를 우회하므로 운영/복구 경로는 살아 있다).
--
-- ⚠️ DROP 하지 않는다: 2026-07-08 line_items 재구성 **이전의 유일한 백업**일 수 있어 보존 가치를
--    먼저 판단해야 한다. 판단이 끝나면 별도 마이그레이션으로 비공개 스키마 이관 또는 삭제할 것.
--
-- 📌 재발 방지: 백업/임시 테이블을 public 스키마에 만들지 말 것. 부득이하면 같은 트랜잭션에서
--    revoke + enable row level security 까지 함께 실행한다.

do $$
begin
  if to_regclass('public.invoices_bak_20260708') is null then
    raise notice '0155a: invoices_bak_20260708 이 없다 — 이미 정리됨(skip)';
    return;
  end if;

  revoke all privileges on table public.invoices_bak_20260708 from anon, authenticated;
  execute 'alter table public.invoices_bak_20260708 enable row level security';
  -- 소유자도 정책을 우회하지 못하게(백업 테이블이라 앱 경로가 없다). service_role 은 별개로 우회한다.
  execute 'alter table public.invoices_bak_20260708 force row level security';
  raise notice '0155a: invoices_bak_20260708 잠금 완료(권한 회수 + RLS 강제)';
end $$;
