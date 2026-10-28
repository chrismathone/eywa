"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import { sanitizePayload } from "../write-timing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 200;

/** "표가 아직 없다"(s2_0001 미적용) — 기록을 조용히 건너뛴다([[#95]]: 앱이 SQL보다 먼저 나가도 아무것도 깨지지 않게). */
function tableMissing(err: { code?: string | null; message?: string | null }): boolean {
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return (err.message ?? "").includes("lesson_report_write_timings");
}

/**
 * 원스크린 작성 시간 기록(write-timing.ts)을 남긴다 — 저장·발송이 끝난 보고서만, 이 지점 보고서만.
 * 표는 서버 전용(정책 0개)이라 admin으로 쓰고 tenant_id를 직접 건다. best-effort — 무엇이 실패해도 화면엔 아무 일도 없다.
 */
export async function recordReportWriteTimings(items: { reportId: string; timing: unknown }[]): Promise<void> {
  try {
    if (!Array.isArray(items) || items.length === 0) return;
    const user = await getCurrentUser({ teacherView: true });
    if (!user) return;
    if (await readonlyTeacherViewError()) return; // '다른 강사 뷰'·지점 보기는 기록하지 않는다(본인 작성이 아니다)
    const clean = items
      .slice(0, MAX_ITEMS)
      .map((it) => ({ reportId: typeof it?.reportId === "string" && UUID.test(it.reportId) ? it.reportId : null, t: sanitizePayload(it?.timing) }))
      .filter((it): it is { reportId: string; t: NonNullable<ReturnType<typeof sanitizePayload>> } => !!it.reportId && !!it.t);
    if (!clean.length) return;
    const admin = createAdminClient();
    const reports = await fetchInChunks([...new Set(clean.map((c) => c.reportId))], (chunk) =>
      admin.from("lesson_reports").select("id, report_date, subject").eq("tenant_id", user.tenantId).in("id", chunk),
    );
    const byId = new Map(reports.map((r) => [r.id as string, r]));
    const rows = clean
      .filter((c) => byId.has(c.reportId))
      .map((c) => {
        const r = byId.get(c.reportId)!;
        return {
          tenant_id: user.tenantId,
          report_id: c.reportId,
          teacher_id: user.id,
          report_date: r.report_date,
          subject: r.subject,
          send_view: c.t.sendView,
          send_mode: c.t.sendMode,
          queued: c.t.queued,
          started_at: c.t.startedAt,
          total_ms: c.t.totalMs,
          active_ms: c.t.activeMs,
          edits_card: c.t.editsCard,
          edits_grid: c.t.editsGrid,
          fields: c.t.fields,
        };
      });
    if (!rows.length) return;
    const { error } = await admin.from("lesson_report_write_timings").insert(rows);
    if (error && !tableMissing(error))
      reportWarning("작성 시간 기록 실패", { scope: "recordReportWriteTimings", count: rows.length, message: error.message });
  } catch (e) {
    reportWarning("작성 시간 기록 실패", { scope: "recordReportWriteTimings", message: e instanceof Error ? e.message : String(e) });
  }
}
