import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActionAs } from "@/features/audit/server/log";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { videoHomeworkColumnReady } from "@/features/video-homework/server/assignments";
import { reportLineMode, submitLinkModeAllows, type SubmitLinkMode } from "../link-choice";
import { reportGetsVideoLink } from "../route";
import { videoLinkLastDay } from "../rules";
import { videoSubmitAvailability } from "./availability";
import { videoSubmitLinkColumn } from "./link-choice-db";
import { mintSubmitLink } from "./links";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// 단계(env)·테스트 학생 이름은 화면과 같이 쓰는 순수 모듈로 옮겼다(link-choice.ts) — 여기서는 다시 내보내기만 한다.
export { reportLineMode, TEST_STUDENT_NAME } from "../link-choice";
export type ReportLineMode = SubmitLinkMode;

/** 감사로그의 "누가" — 사람 없이 발송 PC가 부른다. */
export const REPORT_LINK_ACTOR = "수업보고서 발송(연동 PC)";

/**
 * 발송 PC 워커가 수업보고서를 ClassNote에 올리기 직전에 부른다 — 이 보고서에 '영상 제출' 줄을 붙일지 정하고, 붙이면
 * 그 학생 × 보고서 반의 **7일 링크(보고서일 기준)를 새로 만들어** 토큰 원문을 돌려준다(DB엔 해시만, 행에 보고서 번호).
 * 강사가 그 행에서 '영상 첨부 링크 넣기'를 켠 보고서만이다(0328a). 그 칸이 아직 없으면 10-01 규칙 그대로, 칸 유무를 못 물어봤으면 붙이지 않는다.
 * 붙이지 않으면 null — 워커는 줄 없이 보고서를 그대로 보낸다(🔴 이 함수의 어떤 실패도 발송을 막지 않는다).
 */
export async function reportVideoLinkToken(reportId: unknown, mode: ReportLineMode = reportLineMode()): Promise<string | null> {
  if (mode === "off" || typeof reportId !== "string" || !UUID_RE.test(reportId)) return null;
  const db = createAdminClient();
  const [homeworkReady, linkColumn] = await Promise.all([videoHomeworkColumnReady(db), videoSubmitLinkColumn(db)]);
  if (!homeworkReady || linkColumn === "unknown") return null;
  // 링크 넣기 값은 칸이 있을 때만 따로 읽는다(나란히, B4) — 한 select에 섞으면 칸이 없는 지점에서 보고서 조회가 통째로 실패한다.
  const [{ data: report, error }, choice] = await Promise.all([
    db.from("lesson_reports")
      .select("id,tenant_id,student_id,class_id,subject,report_date,video_homework,revoked_at,share_token")
      .eq("id", reportId).maybeSingle(),
    linkColumn === "ready"
      ? db.from("lesson_reports").select("video_submit_link").eq("id", reportId).maybeSingle()
      : Promise.resolve(null),
  ]);
  if (error || choice?.error || !report?.class_id || !report.student_id || !report.share_token || !YMD_RE.test(String(report.report_date))) return null;
  const tenantId = report.tenant_id as string;
  const [settings, classRes, studentRes] = await Promise.all([
    getTenantSettingsByTenantId(tenantId),
    db.from("classes").select("id,subject").eq("tenant_id", tenantId).eq("id", report.class_id as string).maybeSingle(),
    db.from("students").select("id,name,grade").eq("tenant_id", tenantId).eq("id", report.student_id as string).maybeSingle(),
  ]);
  if (classRes.error || studentRes.error || !classRes.data || !studentRes.data) return null;
  if (!submitLinkModeAllows(mode, studentRes.data.name as string | null)) return null;
  const eligible = reportGetsVideoLink({
    videoHomework: report.video_homework as boolean | null,
    submitLink: choice ? ((choice.data?.video_submit_link as boolean | null | undefined) ?? null) : "no_column",
    reportSubject: report.subject as string | null,
    revoked: !!report.revoked_at, classId: classRes.data.id as string, classSubject: classRes.data.subject as string | null,
    grade: studentRes.data.grade as string | null, policy: settings.report.videoHomeworkPolicy,
  });
  if (!eligible) return null;
  const availability = await videoSubmitAvailability(tenantId, settings, db);
  if (!availability.ok) {
    // 붙일 조건(강사가 링크 넣기를 켬 — 그 칸이 아직 없는 지점은 영상 과제 있음)은 통과했는데 못 붙인 경우다. 발송은 그대로 가므로 흔적을 남긴다(왜 안 붙었는지 되짚을 길).
    console.warn(JSON.stringify({ level: "warn", scope: "videoSubmit.reportLink.skipped", reportId, reason: availability.reason }));
    return null;
  }
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
