"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { kstDateOf, kstLocalToIso } from "@/lib/date-kst";
import { classOptionsFor, type ClassOptionsResult } from "./class-save";
import { canConsultStudent, scopedConsultationUserId } from "./write-scope";

/**
 * 상담 폼의 '반' 칸 — 학생·상담사·일시·과목이 정해지면 그날의 반 선택지와 자동 판정을 돌려준다(저장과 같은 함수).
 * 게이트 = 원생상담을 볼 수 있는 사람 + 강사는 담당 학생만(쓰기 범위와 같은 판정, write-scope.ts).
 * @param consultedAt 폼의 `datetime-local` 값(KST 벽시계) — 서버(UTC)가 그대로 읽으면 날짜가 밀리므로 KST로 푼다.
 */
export async function getConsultationClassOptions(input: {
  studentId: string;
  consultedAt: string;
  counselorId: string | null;
  subject: string | null;
}): Promise<ClassOptionsResult | { error: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "consultations");
  if (level === "none") return { error: "원생상담 권한이 없습니다" };
  const studentId = String(input.studentId ?? "").trim();
  if (!studentId) return { supported: true, options: [], auto: { classId: null, reason: "no_enrollment", reasonLabel: "" } };
  if ((await scopedConsultationUserId(user)) && !(await canConsultStudent(studentId))) {
    return { error: "담당 학생의 반만 볼 수 있습니다" };
  }
  const date = kstDateOf(kstLocalToIso(input.consultedAt)) ?? "";
  // 상담사 칸의 빈 값 = '본인'(저장과 같은 규칙 — actions.ts `input.counselorId ?? user.id`).
  const counselorId = String(input.counselorId ?? "").trim() || user.id;
  const subject = String(input.subject ?? "").trim() || null;
  try {
    return await classOptionsFor({ studentId, date, counselorId, subject });
  } catch (e) {
    console.error("[consultations] 반 선택지 조회 실패:", e instanceof Error ? e.message : e);
    return { error: "반 목록을 불러오지 못했습니다" };
  }
}
