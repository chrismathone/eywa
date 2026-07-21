import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveSettings } from "../resolve";
import type { TenantSettings } from "../settings-types";

/** owner 설정 캐시 무효화 태그(tenantId별). saveOwnerSection 저장 시 revalidateTag로 비운다. */
export function tenantSettingsTag(tenantId: string): string {
  return `tenant-settings:${tenantId}`;
}

/**
 * 테넌트 설정 raw(저장 jsonb + 학원명)를 tenantId별 `unstable_cache`로 캐싱 — 같은 테넌트의 모든
 * 요청(특히 창=iframe마다 셸 레이아웃이 재실행되는 멀티윈도우)이 DB 2쿼리를 공유한다. 캐시 안엔
 * 쿠키 미사용(admin client + 신뢰된 tenantId 키)이라 캐시 안전(getTenantSettingsByTenantId와 동일
 * service_role 패턴, .eq(tenant_id) 격리). DEFAULT merge(resolveSettings)는 캐시 밖에서 돌려 코드
 * 변경이 즉시 반영. 저장 시 saveOwnerSection이 `revalidateTag(tenantSettingsTag(tenantId))`로 무효화.
 */
export const loadTenantSettingsRaw = (tenantId: string) =>
  unstable_cache(
    async () => {
      const admin = createAdminClient();
      const [settingsRes, tenantRes] = await Promise.all([
        admin.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle(),
        admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
      ]);
      // 에러는 무음으로 삼키지 않는다(관측성) — DB 오류가 data=null로 둔갑해 기본값으로 떨어지면
      // (권한 override가 사라지는 fail-open) 진단이 안 됨. 동작은 관대(기본값)하되 로깅.
      if (settingsRes.error) console.error("[owner/queries] tenant_settings 조회 오류", settingsRes.error);
      if (tenantRes.error) console.error("[owner/queries] tenants 조회 오류", tenantRes.error);
      return { data: (settingsRes.data?.data ?? null) as unknown, name: tenantRes.data?.name ?? "" };
    },
    ["tenant-settings", tenantId],
    // 저장 시 updateTag/revalidatePath로 즉시 무효화. revalidate는 그게 다 실패할 때의 TTL 백스톱.
    { tags: [tenantSettingsTag(tenantId)], revalidate: 300 },
  )();

/**
 * 현재 테넌트의 해석된 학원 설정(저장값 + DEFAULT_SETTINGS merge). getCurrentUser로 tenantId 확인 후
 * tenantId별 캐시에서 raw를 읽어 resolveSettings. React cache로 요청 내 중복도 제거.
 */
export const getTenantSettings = cache(async (): Promise<TenantSettings> => {
  const user = await getCurrentUser();
  if (!user) return resolveSettings(null, { name: "" });
  const raw = await loadTenantSettingsRaw(user.tenantId);
  return resolveSettings(raw.data, { name: raw.name });
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
