-- super_admin_audit_logs: RLS
-- super_admin만 select(전체 — multi-tenant 운영 추적이 본질). write는 service_role 전용.

ALTER TABLE public.super_admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sa_audit_super_admin_select ON public.super_admin_audit_logs;
CREATE POLICY sa_audit_super_admin_select ON public.super_admin_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- write 정책 없음 → authenticated INSERT/UPDATE/DELETE 거부. service_role(createAdminClient)만 기록.
