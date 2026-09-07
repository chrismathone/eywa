import type { Metadata } from "next";

import { MenuBoard } from "@/components/workspace/menu-board";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { canUseTeacherView } from "@/lib/auth/view-mode";

export const metadata: Metadata = { title: "메뉴" };

/**
 * 첫 화면 = **메뉴**(원장 2026-09-07: *"기본 화면인 운영실도 없애야지 그래야 버튼식이 가동되지"*).
 *
 * 🔴 **가벼운 화면이어야 한다** — 로그인마다 도는 자리라 여기서 업무 데이터를 조회하지 않는다
 *    (인수인계 §7 *"메뉴 허브 자체는 가벼운 목적지 목록"*). 권한 판정에 필요한 것만 읽는다.
 * 🔴 운영실은 이제 **메뉴 중 하나**다 — 첫 화면을 차지하지 않고, 왼쪽에서 누르면 그때 열린다.
 * ⚠️ 데스크톱에선 이 화면이 곧 작업면이라 캔버스가 덮지 않는다(workspace-canvas `isDesktopSurface`).
 *    창을 열면 그 위에 뜬다 — 메뉴로 돌아와도 창은 그대로다.
 */
export default async function MenuPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [permMatrix, canTeacherView] = await Promise.all([getUserPermMatrix(), canUseTeacherView()]);
  return (
    <MenuBoard
      systemRole={user.systemRole}
      permMatrix={permMatrix}
      canTeacherView={canTeacherView}
    />
  );
}
