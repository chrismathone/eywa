import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { removeObject } from "@/lib/storage/media-storage";
import { isTenantReportAttachmentPath } from "@/lib/storage/legacy-audio-path";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { notifyUsers } from "@/features/notifications/server/notify";
import { targetRequest, targetRequestPdf } from "./sync-server";
import type { BindingConfig } from "./sync-contract";
import {
  EXAM_REPORT_PDF_MAX, examReportAttachmentName, examReportNotice, isExpectedPdf, isSettled, parseExamReportDay, shouldNotify,
  type ExamReportItem, type StoredLink,
} from "./exam-report-plan";

/**
 * 오늘 수학 월말평가 성적표 PDF → 그 학생 그날 수학 보고서 첨부(0373a · 원장 2026-10-18 *"오늘 수학에 완성되면 pdf 첨부하는 방향으로"*).
 *
 * 결과 동기화(results-sync)가 끝난 뒤 같은 지점에서 돈다(1시간 cron · 채점 신호). 켜는 조건 = 지점 라이선스(부르는 쪽이 이미 본다)
 * ∧ 학원 설정 → 연동 → 오늘 수학 '월말평가 성적표 보고서 첨부'(`report.todaysMathReportPdf`).
 * 볼 날 = 기간 안에 오늘 수학 월말평가 결과가 있는 날 + 아직 못 붙인 성적표의 날(0373a 함수). 한 성적표마다:
 *   ① DB 함수를 경로 없이 불러 이 순간의 보고서 상태를 본다 → 붙일 수 있을 때만(needs_pdf) ② PDF를 받아 지문을 확인하고 저장소에 올린 뒤
 *   ③ 같은 함수를 경로와 함께 다시 부른다(그사이 보냈으면 안 붙고, 올린 파일은 지운다). 재채점이면 옛 PDF를 첨부에서 빼고 저장소에서 지운다.
 * 붙이지 못한 까닭(보고서 없음 · 이미 보냄 · 첨부 가득)은 그 보고서를 쓴 선생님(없으면 담임)에게 상태마다 한 번 알린다.
 * 🔴 보고서의 발송 상태 칸은 건드리지 않는다 — 안 보낸 보고서에만 붙으므로 되돌릴 것이 없고, 대기 중인 발송은 그대로 첨부와 함께 나간다.
 */
const BUCKET = "report-attachments";
const DAYS_PER_RUN = 10;
const isMissing = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST202";

export type ExamReportAttachResult = { status: "off" | "not_ready" | "done"; attached: number; notified: number; failed: number };

type AttachReply = { state: string; reportId: string | null; usedPath: boolean; replacedPath: string | null; recipientId: string | null; notifiedState: string | null };

async function callAttach(tenantId: string, item: ExamReportItem, path: string | null, size: number | null): Promise<AttachReply> {
  const { data, error } = await createAdminClient().rpc("todays_math_attach_exam_report", {
    p_tenant: tenantId, p_publication: item.publicationId, p_student: item.sourceStudentId, p_class: item.sourceClassId,
    p_date: item.testDate, p_source_test: item.sourceTestId, p_item_sha: item.sha256, p_pdf_sha: item.pdfSha256,
    p_path: path, p_name: path ? examReportAttachmentName(item.testDate) : null, p_size: size,
  });
  if (error) throw new Error(isMissing(error) ? "not_ready" : "attach_rpc_failed");
  return data as AttachReply;
}

async function attachOne(config: BindingConfig, item: ExamReportItem): Promise<AttachReply> {
  const tenantId = config.tenantId;
  const first = await callAttach(tenantId, item, null, null);
  if (first.state !== "needs_pdf") return first;
  const path = `/api/integrations/eywa/v2/exam-reports/${item.testDate}/${item.publicationId}/${encodeURIComponent(item.sourceStudentId)}`
    + `?bindingId=${config.bindingId}&sha256=${item.sha256}`;
  const bytes = await targetRequestPdf(config, path, EXAM_REPORT_PDF_MAX);
  if (!isExpectedPdf(bytes, item.pdfSha256)) throw new Error("exam_report_pdf_invalid");
  const objectPath = `${tenantId}/report-attachments/tm-exam-${randomUUID()}.pdf`;
  if (!isTenantReportAttachmentPath(objectPath, tenantId)) throw new Error("invalid_object_path");
  const { error: upErr } = await createAdminClient().storage.from(BUCKET)
    .upload(objectPath, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error("exam_report_upload_failed");
  let reply: AttachReply;
  try { reply = await callAttach(tenantId, item, objectPath, bytes.byteLength); }
  catch (e) { await removeObject(objectPath, { bucket: BUCKET }).catch(() => {}); throw e; }
  if (!reply.usedPath) await removeObject(objectPath, { bucket: BUCKET }).catch(() => {});
  if (reply.replacedPath && isTenantReportAttachmentPath(reply.replacedPath, tenantId))
    await removeObject(reply.replacedPath, { bucket: BUCKET }).catch(() => {});
  return reply;
}

async function notifyOnce(tenantId: string, item: ExamReportItem, reply: AttachReply): Promise<boolean> {
  if (!shouldNotify(reply.state, reply.notifiedState, item.testDate, kstToday()) || !reply.recipientId) return false;
  const admin = createAdminClient();
  const { data: student } = await admin.from("students").select("name").eq("tenant_id", tenantId).eq("id", item.sourceStudentId).maybeSingle();
  const { title, body } = examReportNotice(reply.state, (student?.name as string | undefined) ?? "", item.testDate);
  await notifyUsers([{
    tenantId, recipientId: reply.recipientId, type: "todays_math_exam_report", title, body,
    link: `/onescreen?date=${item.testDate}&class=${item.sourceClassId}&student=${item.sourceStudentId}`,
  }]);
  await admin.from("todays_math_exam_report_links").update({ notified_state: reply.state })
    .eq("tenant_id", tenantId).eq("publication_id", item.publicationId).eq("student_id", item.sourceStudentId);
  return true;
}

/** window = 결과 동기화와 같은 기간(results-sync `resultsWindow`) — 그보다 오래된 성적표는 다시 보지 않는다. */
export async function attachTodaysMathExamReports(config: BindingConfig, window: { from: string; to: string }): Promise<ExamReportAttachResult> {
  const tenantId = config.tenantId;
  const out: ExamReportAttachResult = { status: "done", attached: 0, notified: 0, failed: 0 };
  const settings = await getTenantSettingsByTenantId(tenantId);
  if (!settings.report.todaysMathReportPdf) return { ...out, status: "off" };
  const admin = createAdminClient();
  const { data: dates, error } = await admin.rpc("todays_math_exam_report_dates", { p_tenant: tenantId, p_from: window.from, p_to: window.to });
  if (isMissing(error)) return { ...out, status: "not_ready" };
  if (error) throw new Error("exam_report_dates_failed");
  for (const date of ((dates ?? []) as string[]).map((d) => String(d).slice(0, 10)).slice(0, DAYS_PER_RUN)) {
    try {
      const day = parseExamReportDay(
        await targetRequest(config, `/api/integrations/eywa/v2/exam-reports/${date}?bindingId=${config.bindingId}`, "GET"),
        config.bindingId, date,
      );
      if (!day.ready || day.items.length === 0) continue;
      const { data: links, error: linkErr } = await admin.from("todays_math_exam_report_links")
        .select("publication_id, student_id, item_sha256, state, notified_state").eq("tenant_id", tenantId).eq("test_date", date);
      if (linkErr) throw new Error("exam_report_links_failed");
      const byKey = new Map(((links ?? []) as StoredLink[]).map((l) => [`${l.publication_id}:${l.student_id}`, l]));
      for (const item of day.items) {
        if (isSettled(item, byKey.get(`${item.publicationId}:${item.sourceStudentId}`))) continue;
        try {
          const reply = await attachOne(config, item);
          if (reply.usedPath) out.attached++;
          if (await notifyOnce(tenantId, item, reply)) out.notified++;
        } catch (e) {
          if (e instanceof Error && e.message === "not_ready") return { ...out, status: "not_ready" };
          out.failed++;
          console.error("[todays-math-exam-report] 첨부 실패", tenantId, date, e instanceof Error ? e.message : "unknown");
        }
      }
    } catch (e) {
      out.failed++;
      console.error("[todays-math-exam-report] 날짜 확인 실패", tenantId, date, e instanceof Error ? e.message : "unknown");
    }
  }
  return out;
}
