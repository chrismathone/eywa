import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday, kstDateOf } from "@/lib/date-kst";

/**
 * 시안: '최신 기록 집계'(직접 누름)는 하루 1회(원장 2026-11-09). 그날 끝까지 마친 직접 집계가 있으면 그 시각을 돌려준다.
 * 끝까지 못 마친 집계(다음 집계에서 이어짐)는 세지 않는다 — 이어서 마치게 둔다. 밤 정기 집계(cron)는 세지 않는다.
 * 🔴 조회가 실패하면 **던진다**(B16) — 예전엔 null(= 오늘 아직 안 함)로 돌려 하루 1회 제한이 로그 없이 풀렸다.
 */
export async function manualRefreshDoneToday(tenantId: string): Promise<string | null> {
  const today = kstToday();
  const { data, error } = await createAdminClient().from("audit_logs").select("created_at, metadata")
    .eq("tenant_id", tenantId).eq("action", "student_contribution_refresh").gte("created_at", `${today}T00:00:00+09:00`)
    .order("created_at", { ascending: false }).limit(20);
  if (error) {
    console.error("[student-contribution] 오늘 집계 기록 조회 실패:", error);
    throw new Error("오늘 집계 기록을 확인하지 못했습니다 — 잠시 뒤 다시 눌러 주세요");
  }
  if (!data) return null;
  const done = data.find((r) => {
    const m = (r.metadata ?? {}) as { trigger?: string; complete?: boolean | string };
    return m.trigger === "manual" && (m.complete === true || m.complete === "true") && kstDateOf(r.created_at) === today;
  });
  return done ? new Date(done.created_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
}
