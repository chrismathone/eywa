"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";

export async function setDocumentFolderFavorite(key: string, favorite: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!(await canAccessTenant(user.systemRole, "documents"))) return { ok: false, error: "문서를 볼 권한이 없습니다." };
  if (!key || key.length > 100) return { ok: false, error: "폴더를 선택해 주세요." };
  const db = await createClient();
  const query = favorite
    ? db.from("document_folder_favorites").upsert({ tenant_id: user.tenantId, user_id: user.id, folder_key: key },
      { onConflict: "tenant_id,user_id,folder_key", ignoreDuplicates: true })
    : db.from("document_folder_favorites").delete()
      .eq("tenant_id", user.tenantId).eq("user_id", user.id).eq("folder_key", key);
  const { error } = await query;
  if (error) {
    if (error.message.includes("favorite_limit")) return { ok: false, error: "즐겨찾기는 최대 10개까지 가능합니다." };
    if (error.code === "23503") return { ok: false, error: "폴더를 찾을 수 없습니다. 새로고침해 주세요." };
    return { ok: false, error: "즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  revalidatePath("/documents");
  return { ok: true };
}
