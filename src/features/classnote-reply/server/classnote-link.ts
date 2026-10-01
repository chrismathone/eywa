import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { currentClassIds, type EnrollmentRow } from "../reply-eligibility-rule";
import { confirmedStudentOf, resolveBoard, type ParentMessage } from "./reply-data";

/** 외부 이동은 현재 배정된 담임만. 관리자·부담임·교시 담당·위임은 자동 통과하지 않는다. */
export async function classnoteLinkForHomeroom(
  admin: ReturnType<typeof createAdminClient>, user: CurrentUser, message: ParentMessage,
): Promise<string | null> {
  try {
    const board = await resolveBoard(admin, user.tenantId, message.boardName);
    if (!board.keys.length) return null;
    let ids: string[];
    if (board.classId) ids = [board.classId];
    else {
      const student = await confirmedStudentOf(admin, user.tenantId, { classId: null, childId: message.childId });
      if (!student || (message.studentId && message.studentId !== student.studentId)) return null;
      const enrollments = await fetchAllPaged<EnrollmentRow>((from, to) => admin.from("enrollments")
        .select("class_id, start_date, end_date, is_transferred").eq("tenant_id", user.tenantId)
        .eq("student_id", student.studentId).order("id").range(from, to));
      ids = currentClassIds(enrollments, kstToday());
    }
    if (!ids.length) return null;
    // 학생 한 명의 현재 수강 반만 대조한다. 직급에 따른 우회는 없다.
    const { count, error } = await admin.from("classes").select("id", { count: "exact", head: true })
      .eq("tenant_id", user.tenantId).eq("teacher_id", user.id).eq("is_active", true)
      .in("subject", board.keys).in("id", ids);
    if (error || !count || !Number.isSafeInteger(message.classnotePostId) || message.classnotePostId <= 0) return null;
    const comment = message.source === "comment" && message.classnoteCommentId ? `?comment=${message.classnoteCommentId}` : "";
    return `https://www.classnote.com/service/report/${message.classnotePostId}${comment}`;
  } catch {
    return null; // 배정을 확인하지 못하면 이동 버튼을 숨긴다.
  }
}
