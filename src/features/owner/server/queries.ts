import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { markFolded } from "@/lib/folded-read";
import { resolveSettings } from "../resolve";
import { settingsRevOf } from "../settings-stamp";
import type { TenantSettings } from "../settings-types";
import type { SystemRole } from "@/lib/permissions";
import { storedPersonIds, withoutRetiredPeople, type RetiredPeople } from "../retired-people";
import { platformAccountIds } from "./platform-settings";
import { retiredPeopleEntries } from "./retired-lookup";

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
      const data = (settingsRes.data?.data ?? null) as unknown;
      // 설정에 오른 사람 중 퇴사가 확인된 사람(→ 역할) — **같은 캐시 항목 안에서** 함께 계산한다(리뷰 r1 F7 · B6: 창마다 셸이 다시 돌아도
      // 캐시에서 한 번에 나온다). 퇴사 처리(`cleanupPersonSettings`)가 이 태그를 비운다. 조회 실패는 null(모름)로 싣고 밖에서 다시 묻는다
      // — 설정 읽기 전체를 실패로 만들지 않는다.
      const ids = storedPersonIds(data);
      let retired: [string, SystemRole | null][] | null = [];
      if (ids.length > 0) {
        try {
          retired = await retiredPeopleEntries(ids, admin);
        } catch (e) {
          console.error("[owner/queries] 퇴사자 조회 실패(캐시 안) — 밖에서 다시 묻는다", e);
          retired = null;
        }
      }
      return { data, name: tenantRes.data?.name ?? "", retired };
    },
    // v4: 퇴사자 집합을 함께 싣는다(2026-11-10 — 옛 v3 항목과 섞지 않는다). v3: 설정별 역할 이관 후의 위임 권한을 배포 즉시 읽는다.
    ["tenant-settings-v4", tenantId],
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
): Promise<{ data: unknown; name: string; failed?: boolean; retired?: [string, SystemRole | null][] | null }> {
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
 * 서버 키 설정 읽기(`getTenantSettingsByTenantId` — 호출처가 많고 설정 행은 캐시 없이 읽는다)용 퇴사자 조회 — **설정 캐시와 같은 태그**로
 * 테넌트·명단별 캐시(B6). 퇴사 처리(`cleanupPersonSettings`)가 그 태그를 비워 바로 반영된다. 조회 실패는 캐시하지 않는다(던짐).
 */
const retiredPeopleCached = (tenantId: string, ids: readonly string[]) =>
  unstable_cache(
    async () => retiredPeopleEntries(ids),
    ["tenant-settings-retired-v2", tenantId, createHash("sha1").update([...ids].sort().join(",")).digest("hex")],
    { tags: [tenantSettingsTag(tenantId)], revalidate: 300 },
  )();

/**
 * 저장값에 오른 사람 중 퇴사가 확인된 사람(→ 역할). `cached` = 설정 캐시 항목이 함께 실어 온 값(없거나 그 안의 조회가 실패했으면 캐시 조회로 다시 묻는다).
 * 조회가 또 실패하면 빈 집합 = **거르지 않음** — 퇴사자는 로그인이 막혀 있어 본인 판정은 그대로 닫히고, 후보 목록(퇴원 승인자 · 데스크 담당)은
 * 저마다 재직자만 다시 고른다. 원장 2026-11-09 *"퇴사시 같이 사라지게"*.
 */
async function retiredIn(tenantId: string, stored: unknown, cached?: [string, SystemRole | null][] | null): Promise<RetiredPeople> {
  if (cached) return new Map(cached);
  const ids = storedPersonIds(stored);
  if (ids.length === 0) return new Map();
  try {
    return new Map(await retiredPeopleCached(tenantId, ids));
  } catch (e) {
    console.error("[owner/queries] 퇴사자 조회 실패 — 이번엔 거르지 않는다", e);
    return new Map();
  }
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
  const settings = resolveSettings(storedForResolve(raw), { name: raw.name });
  // 못 읽어 기본값으로 접은 설정엔 표식을 남긴다 — 화면은 종전 그대로 쓰고, 금액 조립만 `foldedReason`으로 보고 멈춘다.
  if (raw.failed) return markFolded(settings, "학원 설정을 읽지 못했습니다");
  // 퇴사자의 **주는 값**(개인별 기능 권한 명단 · 역할보다 더 주는 개인 메뉴 줄)을 거른다 — 그 권한을 판정하는 게이트·후보 목록이 이 값을 읽는다.
  // 좁히는 값(과목 범위 · 낮은 개인 줄)은 그대로(retired-people.ts 원칙). 퇴사자 집합은 캐시 항목이 함께 실어 온다(왕복 0).
  return withoutRetiredPeople(settings, await retiredIn(user.tenantId, raw.data, raw.retired));
});

/**
 * service_role 변형 — 비로그인(키오스크 등) 컨텍스트용. getTenantSettings는 getCurrentUser에
 * 의존해 RLS 컨텍스트가 없는 곳에선 못 쓰므로, tenantId를 받아 admin으로 직접 읽어 해석한다.
 * React cache 밖이라 호출당 조회 1회. 호출부에서 tenantId는 신뢰된 경로(쿠키 검증된 기기 등)로만.
 */
export async function getTenantSettingsByTenantId(tenantId: string, options?: { failOnReadError?: boolean }): Promise<TenantSettings> {
  const admin = createAdminClient();
  const [settingsRes, tenantRes] = await Promise.all([
    admin.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  if (settingsRes.error) console.error("[owner/queries] tenant_settings 조회 오류", settingsRes.error);
  // 시수처럼 읽기 성공이 필수인 소비처는 기본값으로 실패를 감추지 않는다.
  if (settingsRes.error && options?.failOnReadError) throw new Error("학원 설정을 확인하지 못했습니다");
  // 조회 실패는 침산 기본값으로 — storedForResolve와 같은 규약.
  const stored = settingsRes.error ? {} : (settingsRes.data?.data ?? null);
  // 퇴사자 거르기는 getTenantSettings와 같다(정기 처리의 수신자 — 업무 처리 현황 요약 등 — 도 퇴사자에게 가지 않게).
  return withoutRetiredPeople(resolveSettings(stored, { name: tenantRes.data?.name ?? "" }), await retiredIn(tenantId, stored));
}

/**
 * 편집 폼용 — **캐시를 거치지 않고** 지금 저장된 값을 읽는다. 못 읽으면 null(기본값으로 폼을 채우지 않는다).
 * 🔴 편집 폼의 초기값과 기준 token은 DB의 지금 값이어야 한다 — 위 캐시는 TTL이 300초라 스크립트·cron·시트 반영 뒤
 *    낡을 수 있고, 낡은 token은 "새로고침해도 계속 저장이 거절되는" 화면을 만든다.
 */
export async function getTenantSettingsForEdit(
  tenantId: string,
): Promise<{
  settings: TenantSettings;
  /** 읽은 섹션의 저장 순번 — 폼이 읽기와 저장의 선후를 가린다. 행·섹션이 아직 없으면 0(첫 저장보다 앞선 상태로 구별된다). */
  versions: { operations: number; permissions: number };
} | null> {
  const admin = createAdminClient();
  const [settingsRes, tenantRes] = await Promise.all([
    admin.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  if (settingsRes.error) {
    console.error("[owner/queries] tenant_settings 조회 오류(편집용)", settingsRes.error);
    return null;
  }
  const stored = settingsRes.data?.data as { operations?: unknown; permissions?: unknown } | null | undefined;
  return {
    settings: resolveSettings(settingsRes.data?.data ?? null, { name: tenantRes.data?.name ?? "" }),
    versions: { operations: settingsRevOf(stored?.operations), permissions: settingsRevOf(stored?.permissions) },
  };
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

/**
 * 계정의 시스템 역할 — '탭 및 메뉴 구성 → 강사뷰' 편집기가 개인별 메뉴 권한 중 **강사 계정 것만** 세는 데 쓴다(개인별 권한은 그 사람 역할의 칸만 고친다).
 * 조회 실패는 null — 호출부가 전부 센다(편집기가 메뉴를 더 보여 줄 뿐이다).
 */
export async function getUserSystemRoles(ids: readonly string[]): Promise<Record<string, string> | null> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  // 개인별 메뉴 권한은 스키마가 80줄로 묶는다 — `.in()` 한 번이면 된다(B3 기준 아래).
  const { data, error } = await supabase.from("users").select("id, system_role").in("id", [...new Set(ids)]);
  if (error) {
    console.error("[owner] 계정 역할 조회 실패 — 개인별 메뉴 권한을 전부 센다", error);
    return null;
  }
  return Object.fromEntries((data ?? []).map((u) => [String(u.id), String(u.system_role)]));
}

/** 역할·권한 면의 개인별 메뉴 권한 · 담당자 지정에서 고를 직원(재직 · 학생 제외). 어느 학원에서나 쓴다. 화면에 세우지 않는 계정은 뺀다. */
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
  const protectedIds = await platformAccountIds((data ?? []).map((u) => String(u.id)));
  return (data ?? []).filter((u) => !protectedIds.has(String(u.id))).map((u) => ({ id: String(u.id), name: String(u.display_name ?? "(이름 없음)"), role: String(u.system_role) }));
}
