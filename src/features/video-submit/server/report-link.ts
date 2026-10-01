import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActionAs } from "@/features/audit/server/log";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { videoHomeworkColumnReady } from "@/features/video-homework/server/assignments";
import { reportGetsVideoLink } from "../route";
import { videoLinkLastDay } from "../rules";
import { videoSubmitAvailability } from "./availability";
import { mintSubmitLink } from "./links";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 보고서 글에 붙일 줄을 켜는 단계 — Vercel env `VIDEO_SUBMIT_REPORT_LINE`.
 *  · `on`   = 조건(reportGetsVideoLink)을 통과한 모든 보고서.
 *  · `test` = 테스트 학생 '학원이'의 보고서만(실 학부모 글은 그대로 — 학원이 보드에서 끝-끝 확인용).
 *  · 그 밖(없음) = 붙이지 않는다. 🔴 학부모에게 나가는 글이 바뀌는 일이라 기본은 꺼짐이다.
 */
export type ReportLineMode = "off" | "test" | "on";
export function reportLineMode(env: Record<string, string | undefined> = process.env): ReportLineMode {
  const raw = env.VIDEO_SUBMIT_REPORT_LINE?.trim().toLowerCase();
  return raw === "on" || raw === "test" ? raw : "off";
}
export const TEST_STUDENT_NAME = "학원이";

/** 감사로그의 "누가" — 사람 없이 발송 PC가 부른다. */
export const REPORT_LINK_ACTOR = "수업보고서 발송(연동 PC)";

/**
 * 발송 PC 워커가 수업보고서를 ClassNote에 올리기 직전에 부른다 — 이 보고서에 '영상 제출' 줄을 붙일지 정하고, 붙이면
 * 그 학생 × 보고서 반의 **7일 링크(보고서일 기준)를 새로 만들어** 토큰 원문을 돌려준다(DB엔 해시만, 행에 보고서 번호).
 * 붙이지 않으면 null — 워커는 줄 없이 보고서를 그대로 보낸다(🔴 이 함수의 어떤 실패도 발송을 막지 않는다).
 */
export async function reportVideoLinkToken(reportId: unknown, mode: ReportLineMode = reportLineMode()): Promise<string | null> {
  if (mode === "off" || typeof reportId !== "string" || !UUID_RE.test(reportId)) return null;
  const db = createAdminClient();
  if (!(await videoHomeworkColumnReady(db))) return null;
  const { data: report, error } = await db.from("lesson_reports")
    .select("id,tenant_id,student_id,class_id,subject,report_date,video_homework,revoked_at,share_token")
    .eq("id", reportId).maybeSingle();
  if (error || !report?.class_id || !report.student_id || !report.share_token || !YMD_RE.test(String(report.report_date))) return null;
  const tenantId = report.tenant_id as string;
  const [settings, classRes, studentRes] = await Promise.all([
    getTenantSettingsByTenantId(tenantId),
    db.from("classes").select("id,subject").eq("tenant_id", tenantId).eq("id", report.class_id as string).maybeSingle(),
    db.from("students").select("id,name,grade").eq("tenant_id", tenantId).eq("id", report.student_id as string).maybeSingle(),
  ]);
  if (classRes.error || studentRes.error || !classRes.data || !studentRes.data) return null;
  if (mode === "test" && String(studentRes.data.name ?? "").trim() !== TEST_STUDENT_NAME) return null;
  const eligible = reportGetsVideoLink({
    videoHomework: report.video_homework as boolean | null, reportSubject: report.subject as string | null,
    revoked: !!report.revoked_at, classId: classRes.data.id as string, classSubject: classRes.data.subject as string | null,
    grade: studentRes.data.grade as string | null, policy: settings.report.videoHomeworkPolicy,
  });
  if (!eligible) return null;
  if (!(await videoSubmitAvailability(tenantId, settings, db)).ok) return null;
  const baseDate = String(report.report_date);
  const minted = await mintSubmitLink(db, {
    tenantId, studentId: report.student_id as string, classId: report.class_id as string,
    origin: "report", baseDate, reportId, reportShareToken: report.share_token as string,
  });
  await logActionAs({ tenantId, actorName: REPORT_LINK_ACTOR }, {
    action: "lesson_report_video_link_issue", targetType: "student", targetLabel: String(studentRes.data.name ?? "학생"),
    metadata: { studentId: report.student_id, classId: report.class_id, origin: "report", reportId, lastDay: videoLinkLastDay(baseDate) },
  });
  return minted.token;
}
