import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import type { DutyNote, DutyNoteAction } from "../notes";

/** 의무 id → 가장 최근 관리 기록(없으면 열쇠 없음). 표가 아직 없으면(#95) 빈 값 — 화면은 기록 없이 선다. */
export async function loadLatestNotes(tenantId: string, ids: readonly string[]): Promise<Record<string, DutyNote>> {
  if (!ids.length) return {};
  const admin = createAdminClient();
  let rows: { duty_id: string; action: DutyNoteAction; note: string; actor_id: string | null; created_at: string }[];
  try {
    // 기록은 덧붙이기만 해서 계속 는다 — 청크 안에서도 끝까지 읽는다(B2 · 자르면 최근 기록이 빠진다).
    rows = await fetchAllPagedInChunks([...ids], (chunk, from, to) => admin.from("duty_notes").select("duty_id,action,note,actor_id,created_at").eq("tenant_id", tenantId).in("duty_id", chunk).order("created_at").order("id").range(from, to));
  } catch (error) {
    if (/duty_notes/.test(String((error as Error)?.message ?? "")) && /does not exist|schema cache/.test(String((error as Error)?.message ?? ""))) return {};
    throw error;
  }
  const actors = [...new Set(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : [])))];
  const names = new Map((await fetchInChunks<{ id: string; display_name: string | null }>(actors, (chunk) => admin.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk))).map((u) => [u.id, u.display_name ?? ""]));
  const out: Record<string, DutyNote> = {};
  for (const r of rows) { const prev = out[r.duty_id]; if (!prev || prev.at <= r.created_at) out[r.duty_id] = { action: r.action, note: r.note, by: r.actor_id ? names.get(r.actor_id) ?? "" : "", at: r.created_at }; }
  return out;
}
