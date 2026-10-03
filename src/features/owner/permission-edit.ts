import { isPermissionLocked, type Access, type MenuKey, type SystemRole } from "@/lib/permissions";

export const PERMISSION_ACCESS_CYCLE: readonly Access[] = ["full", "scoped", "readonly", "none"];
/** Skip forbidden values without changing the persisted permission policy. */
export function nextPermissionAccess(menu: MenuKey, role: SystemRole, current: Access): Access {
  for (let step = 1; step <= PERMISSION_ACCESS_CYCLE.length; step++) {
    const next = PERMISSION_ACCESS_CYCLE[(PERMISSION_ACCESS_CYCLE.indexOf(current) + step) % PERMISSION_ACCESS_CYCLE.length];
    if (!isPermissionLocked(menu, role, next)) return next;
  }
  return current;
}
