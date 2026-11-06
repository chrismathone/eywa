import {
  MENU_ACCESS,
  MENU_KEYS,
  SYSTEM_ROLES,
  isPermissionLocked,
  isScopedForbiddenRole,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type PermissionOverride,
  type SystemRole,
} from "@/lib/permissions";

export const PERMISSION_ACCESS_CYCLE: readonly Access[] = ["full", "scoped", "readonly", "none"];
export const permissionAccessOptions = (menu: MenuKey): readonly Access[] =>
  menu === "teacher_view" ? ["full", "readonly", "none"] : PERMISSION_ACCESS_CYCLE;
/**
 * 칸을 한 번 누를 때 **'담당'을 건너뛰는가** — 강사보다 낮은 직급(열람·아르바이트)의 칸에서 '전체' 다음이 '담당'이면 '읽기'로 건너뛴다.
 * 화면은 이걸로 건너뛴 까닭을 알린다(원장 2026-11-05 *"무조건적으로 안되게하지말고 알림메시지도 배선"* — `SCOPED_FORBIDDEN_MESSAGE`).
 */
export function cycleSkipsScoped(menu: MenuKey, role: SystemRole, current: Access): boolean {
  const natural = PERMISSION_ACCESS_CYCLE[(PERMISSION_ACCESS_CYCLE.indexOf(current) + 1) % PERMISSION_ACCESS_CYCLE.length];
  return natural === "scoped" && permissionAccessOptions(menu).includes("scoped") && isScopedForbiddenRole(role);
}
/** Skip forbidden values without changing the persisted permission policy. */
export function nextPermissionAccess(menu: MenuKey, role: SystemRole, current: Access): Access {
  for (let step = 1; step <= PERMISSION_ACCESS_CYCLE.length; step++) {
    const next = PERMISSION_ACCESS_CYCLE[(PERMISSION_ACCESS_CYCLE.indexOf(current) + step) % PERMISSION_ACCESS_CYCLE.length];
    if (!isPermissionLocked(menu, role, next)) return next;
  }
  return current;
}

/** 적용되는 표 → 코드 기본값과 다른 칸만 담은 저장 목록(sparse). 역할·권한 면의 저장 요청이 이 모양이다. */
export function sparseRoleOverrides(matrix: AccessMatrix): PermissionOverride[] {
  const out: PermissionOverride[] = [];
  for (const menu of MENU_KEYS) {
    for (const role of SYSTEM_ROLES) {
      if (matrix[menu][role] !== MENU_ACCESS[menu][role]) out.push({ menu, role, access: matrix[menu][role] });
    }
  }
  return out;
}
