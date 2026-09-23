import "server-only";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { canViewStudentDetail } from "@/features/students/server/read-scope";

/**
 * 원생상담 쓰기의 **담당 범위** — 감사 S3(2026-09-23).
 *
 * 화면(목록·Stat)은 강사에게 `counselor_id = 나`인 상담만 보여 주는데 서버 액션은 id만 봐서,
 * 강사가 요청을 직접 보내면 남의 상담을 고치거나 지우거나 학생을 바꿔 달 수 있었다(#77).
 * 판정 대상은 원생상담 접근수준이 **scoped**인 사용자(=실 강사)뿐 — full(사무실)·겸직 관리자(실 역할 full)는 종전 그대로.
 * '다른 강사 뷰'는 쓰기 캡(readonly)이 이미 막는다.
 */
export async function scopedConsultationUserId(user: {
  id: string;
  systemRole: SystemRole;
}): Promise<string | null> {
  return (await accessLevelTenant(user.systemRole, "consultations")) === "scoped" ? user.id : null;
}

export const OUT_OF_SCOPE_CONSULTATION = "본인이 작성한 상담만 고칠 수 있습니다";
export const OUT_OF_SCOPE_STUDENT = "담당 학생의 상담만 기록할 수 있습니다";

/** 강사가 이 학생을 상담 대상으로 쓸 수 있는가 — 학생 상세 열람과 **같은 판정**(canViewStudentDetail). */
export async function canConsultStudent(studentId: string): Promise<boolean> {
  return canViewStudentDetail(studentId);
}
