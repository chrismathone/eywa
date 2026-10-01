"use server";

import { requireAccess } from "@/lib/auth/require-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/config/app-url";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentById, getStudentEnrollments } from "@/features/students/server/queries";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { videoLinkLastDay } from "../rules";
import { videoSubmitAvailability } from "./availability";
import { mintSubmitLink, revokeSubmitLinks } from "./links";

/**
 * 학생 상세 '숙제 영상' 탭의 **제출 링크 복사 · 링크 끊기** — 선생님·관리자가 받아서 학부모에게 보낸다(원장 2026-10-01 기본값).
 * 🔑 권한 = 그 학생을 **볼 수 있는 사람**(학생 상세와 같은 게이트 `getStudentById` — 강사는 담당 학생만). 학생 기록을 바꾸는 일이
 *    아니라 링크를 건네는 일이라 '수정' 권한까지는 요구하지 않는다(강사뷰에서도 쓴다).
 * 🔑 반 = 그 학생이 **지금 다니는** 반만(끝난 수강의 반으로는 만들지 않는다). 지점은 세션이 정하고 반·학생은 그 지점 조회에서 나온다.
 */
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(studentId: string, classId: string) {
  const user = await requireAccess("students");
  const deny = (error: string) => ({ ok: false as const, error });
  if (!UUID_RE.test(studentId) || !UUID_RE.test(classId)) return deny("학생 또는 반을 찾을 수 없습니다.");
  const student = await getStudentById(studentId);
  if (!student) return deny("이 학생의 링크를 만들 수 없습니다.");
  const today = kstToday();
  const enrollment = (await getStudentEnrollments(studentId))
    .find((e) => e.classId === classId && !isEnrollmentEndedOn(e.endDate, today, e.isTransferred));
  if (!enrollment) return deny("지금 다니는 반이 아닙니다.");
  const availability = await videoSubmitAvailability(user.tenantId, await getTenantSettings());
  if (!availability.ok) return deny("지금은 제출 링크를 쓸 수 없습니다.");
  return { ok: true as const, user, student, enrollment, today };
}

export async function issueVideoSubmitLink(studentId: string, classId: string): Promise<Result<{ url: string; lastDay: string }>> {
  const g = await gate(studentId, classId);
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const base = getAppUrl();
    const minted = await mintSubmitLink(createAdminClient(), {
      tenantId: g.user.tenantId, studentId, classId, origin: "manual", baseDate: g.today, createdBy: g.user.id,
    });
    const lastDay = videoLinkLastDay(g.today);
    await logAction({
      action: "lesson_report_video_link_issue", targetType: "student", targetLabel: `${g.student.name} · ${g.enrollment.className}`,
      metadata: { studentId, classId, origin: "manual", lastDay },
    });
    return { ok: true, url: `${base}/v/${minted.token}`, lastDay };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSubmit.issue", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, error: "제출 링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function revokeVideoSubmitLinks(studentId: string, classId: string): Promise<Result<{ revoked: number }>> {
  const g = await gate(studentId, classId);
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const revoked = await revokeSubmitLinks(createAdminClient(), { tenantId: g.user.tenantId, studentId, classId, userId: g.user.id });
    await logAction({
      action: "lesson_report_video_link_revoke", targetType: "student", targetLabel: `${g.student.name} · ${g.enrollment.className}`,
      metadata: { studentId, classId, revoked },
    });
    return { ok: true, revoked };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSubmit.revoke", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, error: "링크를 끊지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
