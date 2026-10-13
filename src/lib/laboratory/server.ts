import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { LAB_ELIGIBLE_KEYS, LAB_ELIGIBLE_MENUS } from "./rule";
import type { MenuKey } from "@/lib/permissions";

/** The platform chooses menus; each academy separately opts in. */
export const getLaboratoryMenus = cache(async (): Promise<MenuKey[]> => {
  try {
    const { data, error } = await createAdminClient().from("lab_menu_assignments").select("menu_key");
    if (error) throw error;
    // Withdrawal reports remain experimental even before their assignment migration is applied.
    return [...new Set<MenuKey>(["withdrawal_reports", ...(data ?? []).map((row) => row.menu_key as MenuKey)])]
      .filter((key) => LAB_ELIGIBLE_KEYS.has(key));
  } catch (error) {
    // Unknown assignments cannot be treated as public. Retry on the next request.
    console.error("[laboratory] 메뉴 목록 조회 실패", error);
    return LAB_ELIGIBLE_MENUS.map((item) => item.key);
  }
});

export async function isLaboratoryMenuAvailable(tenantId: string, menu: MenuKey): Promise<boolean> {
  const assigned = await getLaboratoryMenus();
  return !assigned.includes(menu) || await isFeatureOptedIn(tenantId, "laboratory");
}
