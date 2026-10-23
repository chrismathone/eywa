-- 업체리스트(inventory_vendors) 읽기 닫기 — 원장 2026-10-23 "해당 기능은 이승엽만 보이게".
--
-- 🔑 보는 사람은 학원 설정 '개인별 기능 권한 → 업체리스트'(permissions.specialAccess.vendorViewerIds)로 정한다.
--    그 판정은 앱(canViewVendorsNow)에만 있으므로, 테넌트 전원 select 정책을 남겨 두면 다른 직원이
--    PostgREST 직결로 읽을 수 있다([[#92]]·[[#77]]). 정책을 지워 세션 읽기를 0행으로 만들고(정책 0개 = 전부 거부, [[#104]])
--    앱은 게이트 통과 뒤 admin + tenant_id 필터로 읽는다. 쓰기는 원래부터 서버 액션(service_role) 전용이다.
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다(admin 읽기라 정책 유무와 무관, [[#95]]).
--
-- 롤백:
--   create policy inventory_vendors_tenant_read on public.inventory_vendors
--     for select using (tenant_id = public.auth_tenant_id());
set local statement_timeout = '60s';

drop policy if exists inventory_vendors_tenant_read on public.inventory_vendors;

comment on table public.inventory_vendors is
  '재고관리 업체리스트(거래처 연락처). 분류는 자유 텍스트. 읽기 정책 없음 — 지정한 사람만 앱(admin)으로 읽는다.';

notify pgrst, 'reload schema';
