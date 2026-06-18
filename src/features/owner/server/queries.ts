import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveSettings } from "../resolve";
import type { TenantSettings } from "../settings-types";

/**
 * 현재 테넌트의 해석된 학원 설정(저장값 + DEFAULT_SETTINGS merge). React cache로 요청 내 중복 제거 —
 * 셸 레이아웃(브랜드)·콘솔·각 소비처가 같은 라운드트립을 공유. RLS로 자기 테넌트만 읽음.
 */
export const getTenantSettings = cache(async (): Promise<TenantSettings> => {
  const user = await getCurrentUser();
  if (!user) return resolveSettings(null, { name: "" });

  const supabase = await createClient();
  const [settingsRes, tenantRes] = await Promise.all([
    supabase.from("tenant_settings").select("data").eq("tenant_id", user.tenantId).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", user.tenantId).maybeSingle(),
  ]);

  return resolveSettings(settingsRes.data?.data ?? null, {
    name: tenantRes.data?.name ?? "",
  });
});

/**
 * service_role 변형 — 비로그인(키오스크 등) 컨텍스트용. getTenantSettings는 getCurrentUser에
 * 의존해 RLS 컨텍스트가 없는 곳에선 못 쓰므로, tenantId를 받아 admin으로 직접 읽어 해석한다.
 * React cache 밖이라 호출당 조회 1회. 호출부에서 tenantId는 신뢰된 경로(쿠키 검증된 기기 등)로만.
 */
export async function getTenantSettingsByTenantId(tenantId: string): Promise<TenantSettings> {
  const admin = createAdminClient();
  const [settingsRes, tenantRes] = await Promise.all([
    admin.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  return resolveSettings(settingsRes.data?.data ?? null, { name: tenantRes.data?.name ?? "" });
}

/** 저장된 마지막 수정 메타(콘솔 헤더 표시용). 없으면 null. */
export async function getSettingsMeta(): Promise<{ updatedAt: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_settings")
    .select("updated_at")
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  return data?.updated_at ? { updatedAt: data.updated_at } : null;
}
