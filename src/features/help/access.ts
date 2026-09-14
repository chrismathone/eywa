import { canAccessTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole, MenuKey } from "@/lib/permissions";
import type { ShellView } from "@/lib/auth/view-mode";

/**
 * 이 사람이 이 링크로 **실제로 그 화면을 열 수 있나** — 도움말은 열 수 없는 화면을 링크하지 않는다.
 * 페이지 게이트와 같은 답(원스크린=뷰, 강사뷰=강사 행으로 한 번 더).
 */
export async function helpLinkOpens(
  menu: MenuKey | null,
  role: SystemRole,
  view: ShellView,
): Promise<boolean> {
  if (!menu) return true;
  if (menu === "teacher_onescreen") return view === "teacher";
  if (!(await canAccessTenant(role, menu))) return false;
  return view !== "teacher" || (await canAccessTenant("teacher", menu));
}
