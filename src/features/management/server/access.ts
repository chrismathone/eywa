import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";

export class ManagementAccessError extends Error {}

/**
 * 경영 분석의 문 — 학원 재무 자료라 **원장 역할만**(원장 2026-11-10 기본값 결정 + 복제본의 원장 전용 규칙).
 * 읽기 = 원장 + 경영 분석·수납·원생·직원 열람 권한. 쓰기(가져오기·대조 저장·AI 검토) = 그 위에 경영 분석·수납 쓰기 권한.
 * '다른 강사 뷰'(역할이 강사로 바뀐다)·운영 콘솔의 '지점 보기'는 거절한다. 저장 함수(s2_0070)가 '재직 중 원장'을 한 번 더 본다.
 */
export async function managementAccess(write = false) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.systemRole !== "master" || user.tenantView) throw new ManagementAccessError("경영 분석을 열람할 권한이 없습니다");
  const allowed = await Promise.all((["management", "billing", "students", "staff"] as const).map((k) => canAccessTenant(user.systemRole, k)));
  if (allowed.some((v) => !v)) throw new ManagementAccessError("경영 분석을 열람할 권한이 없습니다");
  if (write) {
    const writable = await Promise.all((["management", "billing"] as const).map((k) => canWriteTenant(user.systemRole, k)));
    if (writable.some((v) => !v)) throw new ManagementAccessError("경영 분석 자료를 처리할 권한이 없습니다");
  }
  return user;
}
