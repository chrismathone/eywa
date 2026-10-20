import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { SENT_REPORT_OR } from "@/features/math-sheets/lib/sent-reports";
import type { AnyReportLine } from "../book-plans";

/**
 * 교재 전체 목표 보조 조회 — **admin + `tenant_id` 명시 필터**. 게이트는 호출부가 먼저 통과시킨다.
 * 둘 다 실패해도 화면은 산다(목표 권 변경만 잠기거나, 다른 교재 칩만 빠진다).
 */

export type BookTargetStatus = "ok" | "missing-table" | "failed";

/** 다른 교재(수요일 개별심화 등)를 찾는 기간. */
const OTHER_BOOK_LOOKBACK_DAYS = 60;

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return (error.message ?? "").includes("math_book_targets") && /not find|does not exist|schema cache/i.test(error.message ?? "");
}

/** 학생 → { 시리즈 → 고른 목표 권 열쇠 }. */
export async function getMathBookTargets(
  tenantId: string,
  studentIds: string[],
): Promise<{ status: BookTargetStatus; byStudent: Map<string, Record<string, string>> }> {
  const byStudent = new Map<string, Record<string, string>>();
  if (studentIds.length === 0) return { status: "ok", byStudent };
  const admin = createAdminClient();
  try {
    const rows = await fetchInChunks<{ student_id: string; series: string; target_key: string }>(studentIds, (chunk) =>
      admin.from("math_book_targets").select("student_id, series, target_key").eq("tenant_id", tenantId).in("student_id", chunk),
    );
    for (const r of rows) byStudent.set(r.student_id, { ...byStudent.get(r.student_id), [r.series]: r.target_key });
    return { status: "ok", byStudent };
  } catch (e) {
    return { status: isMissingTable(e as { message?: string }) ? "missing-table" : "failed", byStudent };
  }
}

/**
 * 학생들의 최근 발송 보고서 — **모든 반**(수요일 개별심화 반 포함). 반 이름을 붙인다. 실패면 빈 맵(칩만 빠진다).
 */
export async function getRecentReportsAllClasses(tenantId: string, studentIds: string[]): Promise<Map<string, AnyReportLine[]>> {
  const out = new Map<string, AnyReportLine[]>();
  if (studentIds.length === 0) return out;
  const admin = createAdminClient();
  try {
    const rows = await fetchAllPagedInChunks<{ student_id: string; class_id: string | null; report_date: string; textbook: string | null; progress: string | null }>(
      studentIds,
      (chunk, from, to) =>
        admin
          .from("lesson_reports")
          .select("id, student_id, class_id, report_date, textbook, progress")
          .eq("tenant_id", tenantId)
          .in("student_id", chunk)
          .or(SENT_REPORT_OR)
          .is("revoked_at", null)
          .gte("report_date", addDays(kstToday(), -OTHER_BOOK_LOOKBACK_DAYS))
          .order("id", { ascending: true })
          .range(from, to),
    );
    const classIds = [...new Set(rows.map((r) => r.class_id).filter((x): x is string => !!x))];
    const classes = await fetchInChunks<{ id: string; class_name: string }>(classIds, (chunk) =>
      admin.from("classes").select("id, class_name").eq("tenant_id", tenantId).in("id", chunk),
    );
    const names = new Map(classes.map((c) => [c.id, c.class_name]));
    for (const r of rows) {
      const list = out.get(r.student_id) ?? [];
      list.push({ date: r.report_date, textbook: r.textbook, progress: r.progress, className: r.class_id ? names.get(r.class_id) ?? null : null });
      out.set(r.student_id, list);
    }
  } catch {
    return new Map();
  }
  return out;
}
