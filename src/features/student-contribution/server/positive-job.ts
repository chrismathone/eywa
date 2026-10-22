import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/ai/generate";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { isFeatureLicensed } from "@/lib/license/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { contributionIdentity } from "../model/identity";
import { POSITIVE_PROMPT, positiveCandidate, positiveSignalSchema, observedPositive } from "../model/positive";
import { loadSignalRows, loadSignalSources, signalKey, type SignalSource } from "./signals";
import { SIGNALS_TABLE } from "./store";

/** cron만 호출한다. 화면·수동 재집계는 이 함수를 호출하지 않는다. 작업 lease는 refresh가 보유한다. */
export async function judgeStudentPositiveSignals(db: SupabaseClient, tenant: string, deadline: number) {
  if (!(await isFeatureLicensed(tenant, "ai_analysis"))) return { judged: 0, pending: true, failed: 0 };
  if (!process.env.ANTHROPIC_API_KEY_STUDENT_ONTOLOGY?.trim()) return { judged: 0, pending: true, failed: 0 };
  const [sources, saved, students] = await Promise.all([loadSignalSources(db, tenant), loadSignalRows(db, tenant),
    fetchAllPaged<{ id: string; notes: string | null; is_test: boolean }>((a, b) => db.from("students").select("id, notes, is_test")
      .eq("tenant_id", tenant).order("id").range(a, b))]);
  const canonical = contributionIdentity(students), test = new Set(students.filter((s) => s.is_test).map((s) => s.id));
  const known = new Set(students.map((s) => s.id));
  const done = new Map(saved.map((r) => [`${r.source}:${r.source_id}`, r]));
  const todo = sources.filter((s) => known.has(s.studentId) && !test.has(s.studentId) && !test.has(canonical(s.studentId)))
    .filter((s) => !done.has(signalKey(s)) || done.get(signalKey(s))?.rejudge_requested_at)
    .sort((a, b) => a.day.localeCompare(b.day) || signalKey(a).localeCompare(signalKey(b)));
  let judged = 0, failed = 0, aiCalls = 0;
  for (const source of todo) {
    if (Date.now() >= deadline || aiCalls >= 40) break;
    try {
      const candidate = positiveCandidate(source.text);
      let classification: "observed" | "unsupported_praise" | "thanks" | "other" = "other", evidence = "", model: string | null = null;
      if (candidate) {
        aiCalls++;
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), Math.max(1, Math.min(45_000, deadline - Date.now())));
        const response = await generateJSON<unknown>({ tier: "fast", provider: "anthropic", allowedProviders: ["anthropic"], reasoningEffort: "low", maxTokens: 1024, signal: abort.signal,
          meta: { feature: "student_positive_signal", tenantId: tenant }, system: POSITIVE_PROMPT,
          prompt: JSON.stringify({ source: source.source === "parent" ? "학부모 글" : "선생님 답글", text: excerpt(source) }) }).finally(() => clearTimeout(timer));
        const parsed = positiveSignalSchema.parse(response.data);
        classification = parsed.classification;
        evidence = source.text.includes(parsed.evidence.trim()) ? parsed.evidence.trim() : "";
        if (classification === "observed" && !observedPositive(source.text, parsed)) classification = "other";
        model = modelDisplayLabel(response.model);
      }
      const payload = { tenant_id: tenant, student_id: source.studentId, source: source.source, source_id: source.id,
        source_hash: source.hash, occurred_on: source.day, author_label: source.author, classification, evidence,
        method: candidate ? "ai" : "rule", model_label: model, judged_at: new Date().toISOString(), rejudge_requested_at: null };
      const previous = done.get(signalKey(source));
      // 저장된 글은 자동 재판정하지 않는다. 명시 요청은 취소 이력을 남긴 채 판정만 갱신한다.
      const query = previous ? db.from(SIGNALS_TABLE).update(payload).eq("tenant_id", tenant).eq("id", previous.id)
        .eq("rejudge_requested_at", previous.rejudge_requested_at!)
        : db.from(SIGNALS_TABLE).upsert(payload, { onConflict: "tenant_id,source,source_id", ignoreDuplicates: true });
      const { error } = await query;
      if (error) throw new Error(error.message);
      judged++;
    } catch (error) {
      failed++;
      console.error("[student-positive] 판정 실패", source.id, error instanceof Error ? error.message : "알 수 없는 오류");
    }
  }
  return { judged, pending: judged < todo.length, failed };
}
function excerpt(source: SignalSource) {
  if (source.text.length <= 6000) return source.text;
  const index = source.text.search(/태도|열심|좋아졌|늘었|집중|습관|노력|성적|스스로|꾸준|향상|자신감/);
  return source.text.slice(Math.max(0, index - 500), Math.max(0, index - 500) + 6000);
}
