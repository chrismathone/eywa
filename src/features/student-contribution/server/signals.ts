import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstDateOf } from "@/lib/date-kst";
import type { PositiveSignal } from "../model/participation";
import type { PositiveJudgment } from "../model/positive";
import { SIGNALS_TABLE } from "./store";

export type SignalSource = { id: string; source: "parent" | "teacher"; studentId: string; day: string; text: string; author: string | null; hash: string };
export type SignalRow = { id: string; source: "parent" | "teacher"; source_id: string; student_id: string; source_hash: string;
  occurred_on: string; author_label: string | null; classification: PositiveJudgment["classification"]; evidence: string;
  model_label: string | null; judged_at: string; cancelled_at: string | null; cancel_reason: string | null; rejudge_requested_at: string | null };
export const signalKey = (row: { source: string; id: string }) => `${row.source}:${row.id}`;
export function signalHash(source: Omit<SignalSource, "hash">) {
  return createHash("sha256").update(JSON.stringify([source.source, source.id, source.studentId, source.day, source.text, source.author])).digest("hex");
}
export async function loadSignalSources(db: SupabaseClient, tenant: string): Promise<SignalSource[]> {
  type Message = { id: string; student_id: string; content: string | null; posted_at: string | null; created_at: string };
  type Reply = { id: string; student_id: string; body: string | null; posted_at: string | null; created_at: string; author_label: string | null };
  const [messages, replies] = await Promise.all([
    fetchAllPaged<Message>((a, b) => db.from("classnote_parent_messages").select("id, student_id, content, posted_at, created_at")
      .eq("tenant_id", tenant).not("student_id", "is", null).eq("category", "none").not("classified_at", "is", null).order("id").range(a, b)),
    fetchAllPaged<Reply>((a, b) => db.from("classnote_parent_replies").select("id, student_id, body, posted_at, created_at, author_label")
      .eq("tenant_id", tenant).not("student_id", "is", null).eq("status", "success").order("id").range(a, b)),
  ]);
  const sources: Omit<SignalSource, "hash">[] = [
    ...messages.map((m) => ({ id: m.id, source: "parent" as const, studentId: m.student_id, day: kstDateOf(m.posted_at ?? m.created_at) ?? "", text: m.content ?? "", author: "학부모" })),
    ...replies.map((m) => ({ id: m.id, source: "teacher" as const, studentId: m.student_id, day: kstDateOf(m.posted_at ?? m.created_at) ?? "", text: m.body ?? "", author: m.author_label })),
  ];
  return sources.filter((s) => s.day).map((s) => ({ ...s, hash: signalHash(s) }));
}
export async function loadSignalRows(db: SupabaseClient, tenant: string) {
  return fetchAllPaged<SignalRow>((a, b) => db.from(SIGNALS_TABLE).select("id, source, source_id, student_id, source_hash, occurred_on, author_label, classification, evidence, model_label, judged_at, cancelled_at, cancel_reason, rejudge_requested_at")
    .eq("tenant_id", tenant).order("id").range(a, b));
}
export function currentSignals(rows: readonly SignalRow[], sources: readonly SignalSource[]): PositiveSignal[] {
  const hashes = new Map(sources.map((s) => [signalKey(s), s.hash]));
  return rows.map((r) => ({ id: r.id, studentId: r.student_id, day: r.occurred_on, source: r.source,
    observed: r.classification === "observed", cancelled: !!r.cancelled_at,
    sourceCurrent: hashes.get(`${r.source}:${r.source_id}`) === r.source_hash }));
}
