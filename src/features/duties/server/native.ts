import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isKoreanTeacherName } from "@/features/timetable/lib/teacher-label";

/**
 * 원어민은 업무 완성도 관리에서 뺀다(원장 2026-11-11 *"원어민은 관리에서 제외시킬것"*). 판정은 앱 공용 한 곳(`isKoreanTeacherName` — 이름에 한글이 없으면 원어민).
 * 이름이 빈 계정은 원어민으로 보지 않는다(모르는 것을 빼지 않는다).
 */
export const isNativeName = (name: string | null | undefined): boolean => !!name?.trim() && !isKoreanTeacherName(name);

/** 주어진 담당 가운데 원어민 id. */
export async function nativeOwnerIds(tenantId: string, ids: readonly string[]): Promise<Set<string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Set();
  const rows = await fetchInChunks<{ id: string; display_name: string | null }>(uniq, (chunk) => createAdminClient().from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk));
  return new Set(rows.filter((r) => isNativeName(r.display_name)).map((r) => r.id));
}
