import {
  MENU_ACCESS,
  MENU_KEYS,
  SYSTEM_ROLES,
  isPermissionLocked,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type PermissionOverride,
  type SystemRole,
} from "@/lib/permissions";

export const PERMISSION_ACCESS_CYCLE: readonly Access[] = ["full", "scoped", "readonly", "none"];
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
