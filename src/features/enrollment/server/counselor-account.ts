import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 상담자 이름(글자) → 같은 지점의 재직 직원 계정 — 표시 이름이 **정확히 같은 사람이 딱 한 명**일 때만(동명이인·빈칸·모르는 이름 = null).
 * 판정은 [`counselorAccountPatch`](../counselor-account.ts)가 한다. 조회가 실패하면 null(저장은 막지 않는다 — 계정은 그대로 둔다).
 */
export async function resolveCounselorAccount(client: SupabaseClient, tenantId: string, name: unknown): Promise<string | null> {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return null;
  try {
    const { data, error } = await client.from("users").select("id").eq("tenant_id", tenantId).eq("status", "active").eq("display_name", n).limit(2);
    if (error || !data || data.length !== 1) return null;
    return (data[0] as { id: string }).id;
  } catch {
    return null;
  }
}
