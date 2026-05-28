-- super_admins: RLS 정책 + helper 함수
--
-- 모델: SaaS 제공자 전용 레이어. 일반 tenant 사용자와 직교 (academy master와 별개 차원).
-- 본인 row만 select 가능. write는 service_role 전용 (정책 없음 → authenticated 거부).

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admins_self_select ON public.super_admins;
CREATE POLICY super_admins_self_select ON public.super_admins
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- helper: 임의 uid가 super_admin인지 확인. SECURITY DEFINER로 RLS 우회 (본인 외 조회 가능)
CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.super_admins WHERE id = uid)
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
