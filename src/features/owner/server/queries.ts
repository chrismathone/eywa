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

/** 설정 행을 못 읽음 — 캐시 안에서 던져 **실패를 캐시하지 않는다**(학원명은 읽었으면 싣는다). */
class TenantSettingsReadError extends Error {
  constructor(readonly tenantName: string) {
    super("tenant_settings read failed");
  }
}

const loadTenantSettingsRawCached = (tenantId: string) =>
  unstable_cache(
    async () => {
      const admin = createAdminClient();
      const [settingsRes, tenantRes] = await Promise.all([
        admin.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle(),
        admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
      ]);
      // 에러는 무음으로 삼키지 않는다(관측성) — DB 오류가 data=null로 둔갑해 기본값으로 떨어지면
      // (권한 override가 사라지는 fail-open) 진단이 안 됨. 동작은 관대(기본값)하되 로깅.
      if (tenantRes.error) console.error("[owner/queries] tenants 조회 오류", tenantRes.error);
      if (settingsRes.error) {
        console.error("[owner/queries] tenant_settings 조회 오류", settingsRes.error);
        // 🔴 실패는 캐시하지 않는다(적대 리뷰 2026-09-22) — 종전엔 실패 결과도 300초 캐시돼 그동안 저장값(권한 조정 등)이
        //    사라진 채였다. 던지면 unstable_cache가 저장하지 않고 다음 요청이 다시 읽는다.
        throw new TenantSettingsReadError(tenantRes.data?.name ?? "");
      }
      return { data: (settingsRes.data?.data ?? null) as unknown, name: tenantRes.data?.name ?? "" };
    },
    // 키에 v2 — 이 작업 전(옛 코드)의 항목과 모양을 섞지 않는다(배포 직후 한 번 새로 읽을 뿐이다).
    ["tenant-settings-v2", tenantId],
    // 저장 시 updateTag/revalidatePath로 즉시 무효화. revalidate는 그게 다 실패할 때의 TTL 백스톱.
    { tags: [tenantSettingsTag(tenantId)], revalidate: 300 },
  )();

/**
 * 테넌트 설정 raw(저장 jsonb + 학원명)를 tenantId별 `unstable_cache`로 캐싱 — 같은 테넌트의 모든
 * 요청(특히 창=iframe마다 셸 레이아웃이 재실행되는 멀티윈도우)이 DB 2쿼리를 공유한다. 캐시 안엔
 * 쿠키 미사용(admin client + 신뢰된 tenantId 키)이라 캐시 안전(getTenantSettingsByTenantId와 동일
 * service_role 패턴, .eq(tenant_id) 격리). DEFAULT merge(resolveSettings)는 캐시 밖에서 돌려 코드
 * 변경이 즉시 반영. 저장 시 saveOwnerSection이 `revalidateTag(tenantSettingsTag(tenantId))`로 무효화.
 */
export async function loadTenantSettingsRaw(
  tenantId: string,
): Promise<{ data: unknown; name: string; failed?: boolean }> {
  try {
    return await loadTenantSettingsRawCached(tenantId);
  } catch (e) {
    // 예상 밖 오류(서비스 키 누락 등)는 종전처럼 그대로 던진다 — 조용히 기본값으로 바꾸지 않는다.
    if (!(e instanceof TenantSettingsReadError)) throw e;
    // '행 없음'과 '못 읽음'은 다른 사실이다 — 못 읽음은 `failed`로 싣고, 소비처는 storedForResolve로 침산 기본값을 받는다.
    return { data: null, name: e.tenantName, failed: true };
  }
}

/**
 * raw → resolveSettings에 넘길 저장값. **조회가 실패했으면 빈 객체**(= 침산 기본값)로 넘긴다 — 새 학원이 실패 순간
 * 침산 규칙을 잠깐 받는 쪽이, 침산이 규칙을 잃는 쪽보다 낫다. 실패 때의 동작은 이 작업 전과 같다(원장 2026-09-22).
 * (일반판은 `preset: "generic"` 표식이 있어야만 켜지므로 null도 침산으로 풀린다 — 이 함수는 그 규칙에 기대지 않는 이중 안전.)
 */
export function storedForResolve(raw: { data: unknown; failed?: boolean }): unknown {
  return raw.failed ? {} : raw.data;
}

/**
 * 현재 테넌트의 해석된 학원 설정(저장값 + DEFAULT_SETTINGS merge). getCurrentUser로 tenantId 확인 후
 * tenantId별 캐시에서 raw를 읽어 resolveSettings. React cache로 요청 내 중복도 제거.
 */
export const getTenantSettings = cache(async (): Promise<TenantSettings> => {
  const user = await getCurrentUser();
  // 로그인 전(학원을 모른다) = 이 작업 전과 같은 침산 기본값(`{}`). null이면 일반판으로 읽힌다(preset.ts).
  if (!user) return resolveSettings({}, { name: "" });
  const raw = await loadTenantSettingsRaw(user.tenantId);
  return resolveSettings(storedForResolve(raw), { name: raw.name });
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
  if (settingsRes.error) console.error("[owner/queries] tenant_settings 조회 오류", settingsRes.error);
  // 조회 실패는 침산 기본값으로 — storedForResolve와 같은 규약.
  const stored = settingsRes.error ? {} : (settingsRes.data?.data ?? null);
  return resolveSettings(stored, { name: tenantRes.data?.name ?? "" });
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

/**
 * 개인 예외(permissions.userOverrides) 표시용 이름 매핑 — 역할·권한 면에서 userId를 사람 이름으로.
 * ids는 스키마상 최대 80개(권한 예외 규모)라 단일 .in()으로 충분(B3 청크 임계 미만). RLS가 테넌트 격리.
 */
export async function getUserDisplayNames(ids: readonly string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name")
    .in("id", [...new Set(ids)]);
  return Object.fromEntries((data ?? []).map((u) => [u.id as string, (u.display_name as string) ?? ""]));
}

/** 일반판 권한 설정에서 선택할 현재 지점의 재직 직원. 호출처는 원장 전용 설정 면이다. */
export async function getPermissionStaffOptions(): Promise<{ id: string; name: string; role: string }[]> {
  const viewer = await getCurrentUser();
  if (!viewer || viewer.systemRole !== "master") return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, display_name, system_role")
    .eq("tenant_id", viewer.tenantId)
    .neq("status", "inactive")
    .neq("system_role", "student")
    .order("display_name")
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: String(u.id), name: String(u.display_name ?? "(이름 없음)"), role: String(u.system_role) }));
}
