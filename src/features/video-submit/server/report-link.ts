import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { videoHomeworkColumnReady } from "@/features/video-homework/server/assignments";
import { videoHomeworkDueColumnReady } from "@/features/video-homework/server/report-due";
import { homeworkOpen } from "@/features/video-homework/due";
import { reportGetsVideoLink } from "../route";
import { siteAvailability } from "./site";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 단계(env)·테스트 학생 이름은 화면과 같이 쓰는 순수 모듈에 있다(link-choice.ts) — 여기서는 다시 내보내기만 한다(옛 호출부 호환).
export { reportLineMode, TEST_STUDENT_NAME } from "../link-choice";

/**
 * 발송 PC 워커가 수업보고서를 ClassNote에 올리기 직전에 부른다 — 이 보고서 글에 **올리기 사이트 안내 줄**(`영상첨부 : {주소}/v`)을 붙이나.
 * 원장 2026-10-03 *"영상숙제 체크하더라도 /v 링크를 안내"* · *"학생영상 개별링크는 더이상 생성하지않고 … 이제는 클래스노트 업로드 혹은
 * /v 링크로만 업로드"* — 학생마다 링크를 만들지 않는다(예전 `reportVideoLinkToken`은 거뒀다). 주소 하나를 안내하고, 학생이 번호·이름으로
 * 선생님이 낸 숙제를 골라 올린다.
 * 조건 = 영상 과제 있음 + 검사 대상 반(영어·취소·반 없음 제외 — `reportGetsVideoLink`. 강사가 행마다 켜던 '영상 첨부 링크 넣기'는 거둬서
 * 영상 과제 있음이면 붙인다) + **이 보고서의 지점**이 올리기 사이트를 쓸 수 있음(없는 주소를 안내하지 않게 — 지점마다 따로 본다).
 * 글의 주소는 지점과 무관하게 `/v` 그대로다(주소에 지점을 넣지 않는다 — 지점이 여럿이면 학생이 화면에서 고른다).
 * 숙제 마감(선생님이 고른 '다음 수업' 또는 보고서일 + 7일, due.ts)이 이미 지난 보고서(기한 지난 지정 발송·재발송)엔 붙이지 않는다 — 들어가도
 * 그 숙제는 목록에 없다.
 * 🔴 어떤 실패도 false(줄 없이 발송) — 이 판정이 보고서 발송을 막으면 안 된다. 쓰는 것이 없어 감사로그도 없다(링크를 만들지 않는다).
 */
export async function reportSiteLine(reportId: unknown): Promise<boolean> {
  if (typeof reportId !== "string" || !UUID_RE.test(reportId)) return false;
  const db = createAdminClient();
  const [ready, dueReady] = await Promise.all([videoHomeworkColumnReady(db), videoHomeworkDueColumnReady(db)]);
  if (!ready) return false;
  const { data, error } = await db.from("lesson_reports")
    .select(dueReady ? "id,tenant_id,student_id,class_id,subject,report_date,video_homework,revoked_at,video_homework_due"
      : "id,tenant_id,student_id,class_id,subject,report_date,video_homework,revoked_at")
    .eq("id", reportId).maybeSingle();
  // 마감 칸은 생성 타입에 아직 없다(#95 — 칸이 없어도 돈다) — 줄 모양을 여기 적는다.
  const report = data as unknown as { tenant_id: string; student_id: string | null; class_id: string | null; subject: string | null;
    report_date: string; video_homework: boolean | null; revoked_at: string | null; video_homework_due?: string | null } | null;
  if (error || !report?.class_id || !report.student_id || report.video_homework !== true) return false;
  if (!homeworkOpen(String(report.report_date), kstToday(), report.video_homework_due)) return false;
  const tenantId = report.tenant_id as string;
  const [settings, classRes, studentRes] = await Promise.all([
    getTenantSettingsByTenantId(tenantId),
    db.from("classes").select("id,subject").eq("tenant_id", tenantId).eq("id", report.class_id as string).maybeSingle(),
    db.from("students").select("id,grade").eq("tenant_id", tenantId).eq("id", report.student_id as string).maybeSingle(),
  ]);
  if (classRes.error || studentRes.error || !classRes.data || !studentRes.data) return false;
  const eligible = reportGetsVideoLink({
    videoHomework: true, submitLink: "no_column", reportSubject: report.subject as string | null,
    revoked: !!report.revoked_at, classId: classRes.data.id as string, classSubject: classRes.data.subject as string | null,
    grade: studentRes.data.grade as string | null, policy: settings.report.videoHomeworkPolicy,
  });
  if (!eligible) return false;
  // 🔴 **이 보고서의 지점**이 사이트를 쓸 수 있나 — 다른 지점이 쓴다고 주소를 안내하지 않는다(그 지점 학생은 거기서 숙제를 못 찾는다).
  const site = await siteAvailability(db, tenantId);
  if (!site.ok) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoSubmit.reportSiteLine.skipped", reportId, reason: site.reason }));
    return false;
  }
  return true;
}
