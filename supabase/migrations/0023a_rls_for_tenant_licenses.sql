-- tenant_licenses: RLS
-- super_admin이 모든 tenant license 관리(select/write는 service_role).
-- academy 측은 자기 tenant license를 read만 (기능 게이팅용 — 선택적 사용).

ALTER TABLE public.tenant_licenses ENABLE ROW LEVEL SECURITY;

-- super_admin: 전체 select (service_role로 write — 정책 없음)
DROP POLICY IF EXISTS tenant_licenses_super_admin_select ON public.tenant_licenses;
CREATE POLICY tenant_licenses_super_admin_select ON public.tenant_licenses
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- academy: 자기 tenant license read
DROP POLICY IF EXISTS tenant_licenses_own_tenant_select ON public.tenant_licenses;
CREATE POLICY tenant_licenses_own_tenant_select ON public.tenant_licenses
  FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id());

-- updated_at 트리거
DROP TRIGGER IF EXISTS tenant_licenses_set_updated_at ON public.tenant_licenses;
CREATE TRIGGER tenant_licenses_set_updated_at
  BEFORE UPDATE ON public.tenant_licenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
