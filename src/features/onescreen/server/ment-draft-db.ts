import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";

/**
 * 자동작성 원문(0370a `ment_ai_drafts`) — 선생님이 **고쳐 보낸** 멘트의 AI 원문을 보고서 한 건당 한 줄 남기고 읽는다.
 *
 * 왜 있나(원장 2026-10-16 *"선생님 멘트를 닮아가는등"* → *"한계를 수정할 수 있을까"*): 0214a는 "고쳤다/안 고쳤다"만 남겨
 * **무엇을 고쳤는지**는 배울 수 없었다. 말투 프로파일 빌드(./ment-style-build.ts)가 원문 ↔ 최종을 견줘 '늘 고치는 것'을 뽑는다.
 * 🔴 admin 전용(정책 0개 — 0262a와 같은 규약) → 모든 조회·쓰기에 tenant_id 명시.
 * 🔴 fail-soft([[#95]]): 표가 아직 없으면(0370a 미적용) 기록·조회 모두 조용히 건너뛴다.
 * 🔴 보고서 저장을 늦추지 않는다 — 호출부(saveLessonReport)는 응답 뒤(`after`)에 부른다.
 */

/** 원문 상한 — 멘트는 보통 수백 자다. 비정상 입력이 프롬프트를 불리지 않게. */
export const MENT_DRAFT_MAX_CHARS = 4000;

/** "ment_ai_drafts 표가 아직 없다" — 코드(42P01·PGRST205) 또는 표 이름 + 부재 문구(fetchInChunks가 감싼 메시지 포함). */
export function isMentDraftTableMissingError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const m = err.message ?? "";
  return m.includes("ment_ai_drafts") && /does not exist|schema cache|could not find/i.test(m);
}

/** 고쳐 보낸 멘트의 자동작성 원문을 남긴다(같은 보고서는 마지막 원문으로 갈아끼움). 실패는 로그만 — 저장은 이미 끝났다. */
export async function recordMentAiDraft(
  admin: SupabaseClient,
  row: { tenantId: string; reportId: string; teacherId: string | null; draft: string },
): Promise<void> {
  const draft = row.draft.trim().slice(0, MENT_DRAFT_MAX_CHARS);
  if (!draft) return;
  const { error } = await admin
    .from("ment_ai_drafts")
    .upsert(
      { report_id: row.reportId, tenant_id: row.tenantId, teacher_id: row.teacherId, ai_draft: draft, updated_at: new Date().toISOString() },
      { onConflict: "report_id" },
    );
  if (error && !isMentDraftTableMissingError(error))
    reportWarning("자동작성 원문 기록 실패", { scope: "recordMentAiDraft", reportId: row.reportId, message: error.message });
}

/** 보고서 id → 자동작성 원문. 표가 없거나 조회가 실패하면 빈 맵(프로파일은 원문 없이 종전대로 만든다). */
export async function loadMentAiDrafts(admin: SupabaseClient, tenantId: string, reportIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!reportIds.length) return out;
  try {
    const rows = await fetchInChunks<{ report_id: string; ai_draft: string }>([...reportIds], (chunk) =>
      admin.from("ment_ai_drafts").select("report_id, ai_draft").eq("tenant_id", tenantId).in("report_id", chunk),
    );
    for (const r of rows) out.set(r.report_id, r.ai_draft);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMentDraftTableMissingError({ message })) reportWarning("자동작성 원문 조회 실패", { scope: "loadMentAiDrafts", message });
  }
  return out;
}
