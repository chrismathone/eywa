import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday, kstDateOf } from "@/lib/date-kst";

/**
 * 시안: '최신 기록 집계'(직접 누름)는 하루 1회(원장 2026-11-09). 그날 끝까지 마친 직접 집계가 있으면 그 시각을 돌려준다.
 * 끝까지 못 마친 집계(다음 집계에서 이어짐)는 세지 않는다 — 이어서 마치게 둔다. 밤 정기 집계(cron)는 세지 않는다.
 */
export async function manualRefreshDoneToday(tenantId: string): Promise<string | null> {
  const today = kstToday();
  const { data, error } = await createAdminClient().from("audit_logs").select("created_at, metadata")
    .eq("tenant_id", tenantId).eq("action", "student_contribution_refresh").gte("created_at", `${today}T00:00:00+09:00`)
    .order("created_at", { ascending: false }).limit(20);
  if (error || !data) return null;
  const done = data.find((r) => {
    const m = (r.metadata ?? {}) as { trigger?: string; complete?: boolean | string };
    return m.trigger === "manual" && (m.complete === true || m.complete === "true") && kstDateOf(r.created_at) === today;
  });
  return done ? new Date(done.created_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
}
