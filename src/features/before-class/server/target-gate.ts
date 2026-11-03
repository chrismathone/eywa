import "server-only";
import type { SystemRole } from "@/lib/permissions";
import { canManageTenant } from "@/lib/auth/perm-matrix";

/**
 * 비포클래스체크리스트 **반 넣고 빼기** 게이트 — 화면(버튼 보이기)과 서버 액션(쓰기)이 이 함수 하나를 쓴다([[#77]]).
 * 조건 = 이 메뉴 권한 '전체' + 수업 관리 권한 '전체'(원장 2026-11-03 *"비포클래스 반 넣고 빼고 하는 기능"*).
 * 체크만 하는 선생님(메뉴 '전체')은 반 목록을 바꾸지 못한다 — 어떤 반을 이 기능에 둘지는 수업을 관리하는 사람이 정한다.
 * '다른 강사 뷰'·지점 보기는 `accessLevelTenant`가 읽기로 낮춰 저절로 막힌다.
 */
export async function canManageBeforeClassTargets(role: SystemRole): Promise<boolean> {
  const [menu, classes] = await Promise.all([
    canManageTenant(role, "before_class_checklist"),
    canManageTenant(role, "classes"),
  ]);
  return menu && classes;
}
