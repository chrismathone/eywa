import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

/** Newest personal shortcuts first; deleted folders disappear through the database FK. */
export async function getDocumentFolderFavorites(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const db = await createClient();
  const { data, error } = await db.from("document_folder_favorites")
    .select("folder_key")
    .eq("tenant_id", user.tenantId)
    .eq("user_id", user.id)
    .order("added_at", { ascending: false })
    .order("folder_key", { ascending: true })
    .limit(10);
  if (error) {
    console.error("[documents/favorite-queries] 폴더 즐겨찾기 조회 실패", error);
    return [];
  }
  return (data ?? []).map((row) => row.folder_key);
}
