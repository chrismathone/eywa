import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isPilotTitle, parseLevelRows, parsePilotNotes } from "@/features/onescreen/pilot-notes";
import type { ReportLevel } from "../items";
import { checkKey, type ReportDayLevels } from "../types";

/**
 * 보고서 시안(원장 2026-10-28)의 '수업 태도'·'이해도' 줄 = 그날 그 학생에게 **이미 쓴 수업보고서**의 수업 평가 표에서 읽는다.
 * 새로 판정하지 않는다 — 글이 표 형식이 아니거나 보고서가 없으면 그 줄은 '평가 없음'으로 둔다(표를 지어내지 않는다).
 * 체크리스트 반과 **같은 과목** 보고서만(영어·JJ 보고서도 '수업 태도' 줄이 있다). 같은 날 여럿이면 값이 있는 것 중 마지막에 쓴 것.
 */
export async function loadReportLevels(
  tenantId: string, studentIds: string[], subject: string, from: string, to: string,
): Promise<Record<string, ReportDayLevels>> {
  const admin = createAdminClient();
  const rows = await fetchInChunks(studentIds, (ids) =>
    admin.from("lesson_reports")
      .select("student_id, report_date, notes, created_at")
      .eq("tenant_id", tenantId).eq("subject", subject).in("student_id", ids).gte("report_date", from).lte("report_date", to)
      .is("revoked_at", null).order("created_at", { ascending: true }));
  const out: Record<string, ReportDayLevels> = {};
  for (const r of rows) {
    const sec = parsePilotNotes(r.notes as string | null)?.find((s) => isPilotTitle(s.title, "levels"));
    const levels = sec ? parseLevelRows(sec.body) : null;
    if (!levels) continue;
    const pick = (word: string) => (levels.find((l) => l.label.includes(word))?.level ?? null) as ReportLevel | null;
    const attitude = pick("태도");
    const understanding = pick("이해도");
    if (!attitude && !understanding) continue;
    const key = checkKey(r.student_id as string, r.report_date as string);
    const prev = out[key];
    out[key] = { attitude: attitude ?? prev?.attitude ?? null, understanding: understanding ?? prev?.understanding ?? null };
  }
  return out;
}
