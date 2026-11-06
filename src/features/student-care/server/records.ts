import "server-only";
import { resolveSheetEvidence, sheetReferences } from "./sheet-evidence";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth/current-user";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { SENT_REPORT_OR } from "@/features/math-sheets/lib/sent-reports";
import { evidenceHref, type CareEvidenceInput } from "../model";

export const evidenceTable = (kind: CareEvidenceInput["kind"]) => kind === "consultation" ? "student_consultations" : "lesson_reports";
export const evidenceMenu = (kind: CareEvidenceInput["kind"]) => kind === "consultation" ? "consultations" : "lesson_reports";

/**
 * 증거 원본 확인 — `readAll`(신규생 관리 열람)이 아니면 **본인이 쓴 상담만**(약속 담당으로만 들어온 강사에게 원생상담 표의 지점 RLS가 다른 상담사의 기록까지 열어 준다).
 * 수업보고서는 실제로 나간 것만(회수·미발송 초안·미래 날짜 제외 — 수학 시트 증거·DB 함수와 같은 조건).
 */
export async function verifyEvidence(user: CurrentUser, studentId: string, evidence: CareEvidenceInput, readAll: boolean) {
  if (evidence.kind === "english_sheet" || evidence.kind === "math_sheet") {
    if (!(await resolveSheetEvidence(user, evidence.kind, evidence.recordId, studentId))) throw new Error("증거 원본의 진도·수강 기간·열람 권한을 확인하지 못했습니다");
    return;
  }
  if (!(await canAccessTenant(user.systemRole, evidenceMenu(evidence.kind)))) throw new Error("증거 원본을 열람할 권한이 없습니다");
  let query = (await createClient()).from(evidenceTable(evidence.kind)).select("id")
    .eq("tenant_id", user.tenantId).eq("student_id", studentId).eq("id", evidence.recordId);
  if (evidence.kind === "consultation" && !readAll) query = query.eq("counselor_id", user.id);
  if (evidence.kind === "lesson_report") query = query.is("revoked_at", null).lte("report_date", kstToday()).or(SENT_REPORT_OR);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("증거 원본을 확인하지 못했습니다. 같은 학생의 기록인지 확인해 주세요");
}

export async function careReferences(user: CurrentUser, studentId: string, canManage: boolean, readAll: boolean) {
  const client = await createClient();
  const [enrollment, consultation, report] = await Promise.all([
    canAccessTenant(user.systemRole, "enrollment"), canAccessTenant(user.systemRole, "consultations"), canAccessTenant(user.systemRole, "lesson_reports"),
  ]);
  const [sources, calls, reports, sheets] = await Promise.all([
    canManage && enrollment ? client.from("enrollment_consultations").select("id,parent_request,created_at").eq("tenant_id", user.tenantId).eq("student_id", studentId).order("created_at", { ascending: false }).limit(30) : null,
    // 담당으로만 들어온 계정은 본인이 쓴 상담만 · 수업보고서는 실제로 나간 것만(검증 `verifyEvidence`와 같은 조건).
    consultation ? (() => {
      const q = client.from("student_consultations").select("id,consulted_at,summary").eq("tenant_id", user.tenantId).eq("student_id", studentId);
      return (readAll ? q : q.eq("counselor_id", user.id)).order("consulted_at", { ascending: false }).limit(50);
    })() : null,
    report ? client.from("lesson_reports").select("id,report_date,progress").eq("tenant_id", user.tenantId).eq("student_id", studentId)
      .is("revoked_at", null).lte("report_date", kstToday()).or(SENT_REPORT_OR).order("report_date", { ascending: false }).limit(50) : null,
    sheetReferences(user, studentId),
  ]);
  const evidence = [
    ...sheets.evidence,
    ...(calls?.data ?? []).map((r) => ({ kind: "consultation" as const, id: String(r.id), label: `${kstDateOf(r.consulted_at) ?? "날짜 미정"} 상담 · ${String(r.summary ?? "").slice(0, 60)}`, href: evidenceHref("consultation", String(r.id)) })),
    ...(reports?.data ?? []).map((r) => ({ kind: "lesson_report" as const, id: String(r.id), label: `${r.report_date} 수업 · ${String(r.progress ?? "").slice(0, 60)}`, href: evidenceHref("lesson_report", String(r.id)) })),
  ];
  return {
    sources: (sources?.data ?? []).map((r) => ({ id: String(r.id), need: String(r.parent_request ?? ""), date: kstDateOf(r.created_at) ?? "날짜 미정" })),
    evidence, evidenceKinds: [ ...new Set(sheets.evidence.map((e) => e.kind)), consultation ? "consultation" : null, report ? "lesson_report" : null].filter(Boolean) as CareEvidenceInput["kind"][],
    warning: sources?.error || calls?.error || reports?.error || sheets.warning ? "일부 원본 기록을 불러오지 못했습니다. 새로 불러온 뒤 확인해 주세요." : null,
  };
}
