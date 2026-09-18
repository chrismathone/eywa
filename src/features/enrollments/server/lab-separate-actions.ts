"use server";

import { revalidatePath } from "next/cache";
import { toKoreanDbError } from "../db-errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { readEnglishTrack } from "@/features/classes/english-track";
import { isMissingColumnError } from "@/features/classes/server/lab-separate";

/**
 * 수강 한 건을 LAB **'따로 수업(*LAB)' 교시에 배정**하거나 푼다 — 0271b `enrollments.lab_separate`.
 *
 * 원장 2026-09-17 *"EiE 의 경우 토글 랩에 배정할 수 있게 따로 기능이 있어야겠어. '특정 요일만 등원' 이외에 하나 더"*
 * → 반 상세 학생 줄의 EiE 토글. 켠 학생은 LAB실 출석부에서 그 반의 *LAB 교시에만 선다(규칙 = seat/lab-split.ts).
 *
 * 🔴 게이트는 옆 칸 '등원 요일'(`updateEnrollmentsAttendanceBatch`)과 **같은 축**(classes full) — 화면도 같은
 *    판정(`canEditSchedule`)으로 토글을 연다(#77: 버튼은 보이는데 누르면 거절 방지). 열람 전용 '다른 강사 뷰'는
 *    `accessLevelTenant` 중앙 캡이 full을 readonly로 내려 여기서 막힌다.
 * 🔴 **켜는 것은 EiE 반에서만**(반 상세도 EiE 반에만 토글을 세운다). 끄는 것은 언제나 된다 — 반 구분이 바뀐 뒤
 *    남은 표식을 거둘 길이 있어야 한다.
 * 🔑 **즉시 적용(날짜 없음)** — 이력은 감사로그(`enrollment_lab_separate`)가 남긴다.
 * ⚠️ 0271b가 없는 DB에선 칸 없음 오류를 한글로 알린다(조용히 성공한 척하지 않는다).
 */
export async function setEnrollmentLabSeparate(
  enrollmentId: string,
  on: boolean,
): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes")))
    return { error: "따로 수업(*LAB) 배정은 관리자만 할 수 있습니다" };
  const id = String(enrollmentId ?? "").trim();
  if (!id) return { error: "수강 정보를 찾지 못했습니다" };

  const supabase = await createClient();
  // 임베드(classes(...))는 FK가 여럿이면 깨지므로([[#94]]) 두 번 나눠 읽는다 — 한 건이라 왕복 부담이 없다.
  const { data: enrollment, error: readErr } = await supabase
    .from("enrollments")
    .select("id, class_id, student_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { error: toKoreanDbError(readErr, "수강 정보를 불러오지 못했습니다") };
  if (!enrollment) return { error: "수강 정보를 찾지 못했습니다" };
  const classId = enrollment.class_id as string;

  if (on) {
    const { data: klass, error: classErr } = await supabase
      .from("classes")
      .select("subject, english_track")
      .eq("id", classId)
      .maybeSingle();
    if (classErr) return { error: toKoreanDbError(classErr, "반 정보를 불러오지 못했습니다") };
    const track = klass ? readEnglishTrack(klass as { english_track?: string | null }) : null;
    if (!klass || klass.subject !== "english" || track !== "eie")
      return { error: "따로 수업(*LAB) 배정은 EiE 반에서만 할 수 있습니다" };
  }

  const { data: updated, error } = await supabase
    .from("enrollments")
    .update({ lab_separate: on })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error))
      return { error: "따로 수업(*LAB) 배정 칸이 아직 없습니다 — 관리자에게 문의하세요(0271b 미적용)" };
    return { error: toKoreanDbError(error, "따로 수업(*LAB) 배정을 저장하지 못했습니다") };
  }
  // 매치 0행(남의 테넌트·삭제된 수강) = 아무것도 안 바뀜.
  if (!updated) return { error: "수강 정보를 찾지 못했습니다" };

  await logAction({
    action: "enrollment_lab_separate",
    targetType: "student",
    metadata: { enrollmentId: id, studentId: enrollment.student_id, classId, on },
  });
  revalidatePath(`/classes/${classId}`);
  return { ok: true };
}
