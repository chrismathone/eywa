import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";

/** 요청 취소 기록 — 사유(옛 취소·사유 없이 취소는 null) · 취소한 사람 · 시각(ISO). */
export type CancelNote = { reason: string | null; actorId: string | null; at: string };

/**
 * 취소된 보고서의 취소 기록(원장 2026-11-06 *"요청 취소시에 '사유' 입력할 수 있고 마우스 올리면 사유 확인가능하게"*) — 목록이 상태 칸에 싣는다.
 * 보고서 처리 이력(`withdrawal_report_events`)의 'cancel' 줄을 목록에 나온 보고서 id로 한 번에(100개씩 묶어 · 1,000줄씩 쪽으로) 읽는다 · 학원으로 거른다 ·
 * 한 보고서에 여러 줄이면 마지막 줄. 사유는 DB가 묶음의 모든 보고서 cancel 줄에 같은 글로 남긴다(s2_0032). 못 읽으면 던진다(부르는 쪽이 접는다).
 */
export async function loadCancelNotes(tenantId: string, reportIds: readonly string[]): Promise<Map<string, CancelNote>> {
  const ids = [...new Set(reportIds)];
  if (!ids.length) return new Map();
  type Row = { report_id: string; actor_id: string | null; comment: string | null; created_at: string };
  const db = createAdminClient();
  // 묶음(100개씩) × 쪽(1,000줄씩) — 쪽이 흔들리지 않게 시각 + id 순.
  const rows = await fetchAllPagedInChunks<Row>(ids, (chunk, from, to) =>
    db.from("withdrawal_report_events").select("report_id,actor_id,comment,created_at").eq("tenant_id", tenantId).eq("action", "cancel").in("report_id", chunk)
      .order("created_at").order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>);
  const out = new Map<string, CancelNote>();
  for (const r of rows) {
    const prev = out.get(String(r.report_id));
    if (prev && prev.at > r.created_at) continue;
    out.set(String(r.report_id), { reason: r.comment?.trim() || null, actorId: r.actor_id, at: r.created_at });
  }
  return out;
}
