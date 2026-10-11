"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { LAB_ELIGIBLE_KEYS } from "@/lib/laboratory/rule";
import type { MenuKey } from "@/lib/permissions";
import { logSuperAdminAction } from "./audit";

export type LaboratoryActionState = { error?: string; ok?: boolean } | undefined;

export async function toggleLaboratoryMenu(_previous: LaboratoryActionState, formData: FormData): Promise<LaboratoryActionState> {
  const actor = await requireSuperAdmin();
  const menu = String(formData.get("menu") ?? "");
  const enable = formData.get("enable") === "true";
  if (!LAB_ELIGIBLE_KEYS.has(menu as MenuKey)) return { error: "지원하지 않는 메뉴입니다" };
  const db = createAdminClient();
  const { error } = enable
    ? await db.from("lab_menu_assignments").upsert({ menu_key: menu }, { onConflict: "menu_key" })
    : await db.from("lab_menu_assignments").delete().eq("menu_key", menu);
  if (error) return { error: "실험실 메뉴를 저장하지 못했습니다. DB 설정을 확인해 주세요." };
  await logSuperAdminAction({ actorId: actor.id, actorEmail: actor.email, action: "toggle_laboratory_menu", metadata: { menu, enabled: enable } });
  revalidatePath("/super-admin/laboratory");
  revalidatePath("/", "layout");
  return { ok: true };
}
