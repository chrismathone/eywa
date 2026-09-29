import { canAccessTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole, MenuKey } from "@/lib/permissions";
import type { ShellView } from "@/lib/auth/view-mode";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureLicensed } from "@/lib/license/server";

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

/**
 * 설명서 한 권을 이 사람에게 보여 주나 — 메뉴 게이트(`helpLinkOpens`, 꺼진 모듈은 캡으로 막힘) + **메뉴가 없는 스위치**.
 * '창 사용법'은 창 모드 라이선스가 꺼진 지점엔 없다(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
 */
export async function helpManualOpens(
  manual: { slug: string; menuKey: MenuKey | null },
  role: SystemRole,
  view: ShellView,
): Promise<boolean> {
  if (!(await helpLinkOpens(manual.menuKey, role, view))) return false;
  if (manual.slug === "workspace") {
    const user = await getCurrentUser();
    return user ? isFeatureLicensed(user.tenantId, "window_mode") : true;
  }
  return true;
}
