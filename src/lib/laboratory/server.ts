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
    // 🔴 배정 표가 유일한 원본이다 — 코드에서 메뉴를 끼워 넣지 말 것. 퇴원보고서·원생 기여도를 여기서 늘 실험실로 넣었더니
    //    운영 콘솔에서 꺼도('일반') 메뉴 카드에 실험실 마크와 잠금이 그대로 남았다(원장 2026-10-23). 원생 기여도는 0452a가 배정 행을 넣었다.
    return [...new Set<MenuKey>((data ?? []).map((row) => row.menu_key as MenuKey))].filter((key) => LAB_ELIGIBLE_KEYS.has(key));
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
