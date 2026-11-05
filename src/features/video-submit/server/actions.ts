"use server";

import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentById, getStudentEnrollments } from "@/features/students/server/queries";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { videoSubmitAvailability } from "./availability";
import { revokeSubmitLinks } from "./links";

/**
 * 학생 상세 '숙제 영상' 탭의 **링크 끊기** — 이미 나간 제출 링크(학생 상세에서 복사한 것·보고서에 붙었던 것·올리기 사이트가 만든 것)를 닫는다.
 * 🔴 학생마다 링크를 새로 만드는 길은 없다(원장 2026-10-03 *"학생영상 개별링크는 더이상 생성하지않고 … 이제는 클래스노트 업로드 혹은
 *    /v 링크로만 업로드"*) — '제출 링크 복사'(`issueVideoSubmitLink`)를 거뒀다. 이미 만든 링크는 만든 날 + 7일에 저절로 끝난다.
 * 🔑 권한 = 그 학생을 **볼 수 있는 사람**(학생 상세와 같은 게이트 `getStudentById` — 강사는 담당 학생만) **이면서**
 *    원생목록 **쓰기**(`canWriteTenant(role, "students")` — full|scoped). 🔴 `requireAccess`만으로는 읽기 권한도 통과해
 *    뷰어가 링크를 실제로 끊을 수 있었다(감사 2026-11-05). 화면 '링크 끊기'도 page.tsx가 같은 함수로 숨긴다.
 * 🔑 반 = 그 학생이 **지금 다니는** 반만. 지점은 세션이 정하고 반·학생은 그 지점 조회에서 나온다.
 */
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(studentId: string, classId: string) {
  const user = await requireAccess("students");
  const deny = (error: string) => ({ ok: false as const, error });
  if (!(await canWriteTenant(user.systemRole, "students"))) return deny("링크를 끊을 권한이 없습니다(원생목록 작성 권한 필요).");
  if (!UUID_RE.test(studentId) || !UUID_RE.test(classId)) return deny("학생 또는 반을 찾을 수 없습니다.");
  const student = await getStudentById(studentId);
  if (!student) return deny("이 학생의 링크를 다룰 수 없습니다.");
  const today = kstToday();
  const enrollment = (await getStudentEnrollments(studentId))
    .find((e) => e.classId === classId && !isEnrollmentEndedOn(e.endDate, today, e.isTransferred));
  if (!enrollment) return deny("지금 다니는 반이 아닙니다.");
  const availability = await videoSubmitAvailability(user.tenantId, await getTenantSettings());
  if (!availability.ok) return deny("지금은 제출 링크를 쓸 수 없습니다.");
  return { ok: true as const, user, student, enrollment, today };
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
