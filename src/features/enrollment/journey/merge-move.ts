import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 신규 콜&상담 병합이 전화·방문·등록 기록(s2_0062)을 잃지 않게 — 진 쪽 상담이 지워지면 기록이 함께 지워진다(on delete cascade).
 * 기록 표는 서버 전용이라 병합 DB 함수(security invoker) 안에서 못 옮긴다 → admin + 지점 필터로 병합 **전에** 이긴 쪽 상담으로 옮기고,
 * 병합이 실패하면 되돌린다(약속·인계의 merge-move와 같은 결). 문서(document)·버전은 그대로 — 상담 연결만 바뀐다.
 * 표가 없으면(SQL 미적용) 옮길 것이 없다(#95).
 */
export type MovedJourney = { id: string; from: string };

const missing = (code?: string) => code === "42P01" || code === "PGRST205";

export async function moveJourneyToMergeWinner(tenantId: string, winnerId: string, loserIds: string[]): Promise<{ ok: true; moved: MovedJourney[] } | { ok: false }> {
  if (loserIds.length === 0) return { ok: true, moved: [] };
  const admin = createAdminClient();
  const rows = await admin.from("enrollment_journey_records").select("id,consultation_id").eq("tenant_id", tenantId).in("consultation_id", loserIds);
  if (rows.error) {
    if (missing(rows.error.code)) return { ok: true, moved: [] };
    logDbError(rows.error, "enrollment.journey.merge.read");
    return { ok: false };
  }
  const list = (rows.data ?? []) as { id: string; consultation_id: string }[];
  if (list.length === 0) return { ok: true, moved: [] };
  const up = await admin.from("enrollment_journey_records").update({ consultation_id: winnerId })
    .eq("tenant_id", tenantId).in("id", list.map((r) => r.id)).select("id");
  if (up.error || (up.data ?? []).length !== list.length) {
    if (up.error) logDbError(up.error, "enrollment.journey.merge.move");
    await revertJourneyMerge(tenantId, list.map((r) => ({ id: r.id, from: r.consultation_id })));
    return { ok: false };
  }
  return { ok: true, moved: list.map((r) => ({ id: r.id, from: r.consultation_id })) };
}

/** 상담 삭제 전 — 함께 지워질 전화·방문·등록 기록 수(감사로그용 · 못 세면 null). */
export async function countJourneyRecords(tenantId: string, consultationId: string): Promise<number | null> {
  const res = await createAdminClient().from("enrollment_journey_records").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("consultation_id", consultationId);
  return res.error ? null : (res.count ?? 0);
}

/** 병합 DB 함수가 실패했을 때 — 옮긴 기록을 원래 상담으로 되돌린다. */
export async function revertJourneyMerge(tenantId: string, moved: readonly MovedJourney[]): Promise<void> {
  if (moved.length === 0) return;
  const admin = createAdminClient();
  const byFrom = new Map<string, string[]>();
  for (const m of moved) byFrom.set(m.from, [...(byFrom.get(m.from) ?? []), m.id]);
  for (const [from, ids] of byFrom) {
    const res = await admin.from("enrollment_journey_records").update({ consultation_id: from }).eq("tenant_id", tenantId).in("id", ids);
    if (res.error) logDbError(res.error, "enrollment.journey.merge.revert", { consultationId: from });
  }
}
