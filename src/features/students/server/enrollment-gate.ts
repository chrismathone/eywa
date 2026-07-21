import "server-only";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import type { SystemRole } from "@/lib/permissions";

/**
 * 학생 상세에서 **입학(등록)상담을 열람할 수 있는가** — 상담탭 카드와 타임라인 이벤트의 **공용 게이트**.
 *
 * ⚠️ 표면마다 조건을 다시 쓰면 한쪽만 조여지는 우회 구멍이 난다(#77) — 새 표면(요약·비서 응답 등)도
 * 반드시 이 함수를 거칠 것. UI 조건문은 게이트가 아니다.
 * ① `enrollment` 접근권한(원장·상담사 등)이 있으면 열람.
 * ② 권한이 없어도 **강사가 본인 담당 학생**이면 열람(담당 학생의 입학 배경까지는 봐야 지도가 된다).
 *    단 관리 상세(`/enrollment/[id]`)는 여전히 enrollment 게이트 — 그 링크 노출은 호출부가 따로 판단한다.
 */
export async function canSeeStudentEnrollment(
  systemRole: SystemRole,
  studentId: string,
): Promise<boolean> {
  if ((await accessLevelTenant(systemRole, "enrollment")) !== "none") return true;
  const scope = await effectiveTeacherScope(); // 강사(겸직-강사뷰 포함)면 담당 학생 id, 아니면 null
  return scope?.studentIds?.includes(studentId) ?? false;
}
