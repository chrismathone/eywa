"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { findNavItem, navPresentation } from "@/lib/navigation";
import { useWindowStore } from "./window-store";
import { windowIdForHref } from "./window-link";

/**
 * 라우트가 **자기 제목을 달았을 때만** 붙는 접미사(`export const metadata = { title: "학생 상세 — eywa" }`).
 * 루트 레이아웃 기본값은 `eywa — {학원명} 학원관리`라 이 접미사로 끝나지 않는다 → "페이지가 제목을
 * 안 달았다"를 구분할 수 있다(그때는 메뉴 라벨로 떨어진다).
 */
const OWN_TITLE_SUFFIX = " — eywa";

/** 문서 제목에서 라우트가 직접 단 부분만. 루트 기본값이면 null(못 믿는 제목). */
function ownPageTitle(documentTitle: string): string | null {
  const raw = documentTitle.trim();
  if (!raw.endsWith(OWN_TITLE_SUFFIX)) return null;
  return raw.slice(0, -OWN_TITLE_SUFFIX.length).trim() || null;
}

/**
 * 주소를 직접 열었을 때(딥링크) 그 자리에 띄울 창.
 *
 * 데스크톱 셸에선 캔버스가 `/dashboard`를 뺀 **모든 라우트의 main을 불투명하게 덮는다**
 * (workspace-canvas의 "빈 데스크톱 바탕"). 그래서 메뉴·링크(WindowLink)를 거치지 않고 주소창·외부
 * 링크·북마크로 들어오면 **페이지는 정상 렌더됐는데 화면은 "열린 창이 없어요"** 였다
 * (원장 제보 2026-09-01, `/students/<id>` 링크 — [[#86]]의 딥링크판).
 *
 * 🔑 창 id·제목은 **WindowLink와 같은 규약**(`windowIdForHref`)이다 — 갈리면 사이드바에서 연 창과
 *    주소로 연 창이 **서로를 못 알아보고 두 벌**이 된다(같은 화면이 두 개 뜬다).
 * 🔴 `presentation:"desktop"`(운영실)은 **main 자체가 작업면**이라 창으로 열지 않는다 — 열면 배경과
 *    창에 같은 화면이 겹치고, 스토어가 그 창을 레거시로 보고 지운다(`isLegacyDashboardWindow`).
 * ⚠️ 메뉴에 없는 라우트(`/kiosk-settings`·하부탭 전용 `/mcs` 등)도 **경로 그대로 id**로 연다 —
 *    안 열면 그 주소는 지금처럼 빈 바탕이다. 이 id는 사이드바 하부탭이 쓰는 `windowId("route", menuKey)`와
 *    같은 모양이라(`/mcs` → `mcs`) 하부탭으로 연 창과도 한 벌로 합쳐진다.
 */
export function deepLinkWindow(
  pathname: string,
  documentTitle: string,
): { id: string; title: string } | null {
  const path = (pathname.split("?")[0] ?? "").split("#")[0];
  if (!path.startsWith("/") || path === "/" || path === "/menu") return null;
  // 🔴 프로토콜 상대 경로(`//evil.com`·`/\evil.com`)는 **상대 URL로 쓰면 남의 origin**이 된다 —
  //    iframe src에 그대로 실리면 eywa 창틀 안에 남의 사이트가 뜨는 피싱 경로가 열린다.
  //    (그런 주소는 라우트가 없어 404지만 **셸은 그대로 렌더된다** — 훅은 돌아간다.)
  if (path.startsWith("//") || path.startsWith("/\\")) return null;

  const item = findNavItem(path);
  if (item && item.href === path && navPresentation(item) === "desktop") return null;

  const resolved = windowIdForHref(path);
  // 메뉴 루트(= 사이드바를 누른 것과 같은 화면)면 사이드바와 **같은 제목**을 쓴다 — 문서 제목을
  // 쓰면 "학생목록"이 "학생 목록"으로 갈려 같은 창의 이름이 진입 경로마다 달라진다.
  if (resolved && item && item.href === path) {
    return { id: resolved.id, title: resolved.navLabel ?? item.label };
  }
  return {
    id: resolved?.id ?? path.replace(/^\//, ""),
    // 상세 라우트에서 메뉴 라벨(`학생목록`)은 거짓말이라 문서 제목(`학생 상세`)을 먼저 쓴다.
    title: ownPageTitle(documentTitle) ?? resolved?.navLabel ?? "보기",
  };
}

/**
 * 딥링크로 들어온 라우트를 **플로팅 창으로 자동으로 연다**(원장 지시 2026-09-01).
 *
 * `enabled`는 캔버스가 실제로 main을 덮는 조건과 같아야 한다(데스크톱 + 작업면 아님) — 안 덮는
 * 화면에서 열면 배경과 창이 겹친다. iframe 안에서는 `useIsDesktop`이 false라 enabled가 안 선다.
 *
 * 🔴 **영속 창 복원(rehydrate)이 끝난 뒤에 연다** — 먼저 열면 복원이 그 창을 덮어써 사라지거나,
 *    이미 떠 있던 같은 창을 못 보고 두 벌이 된다. `open()`은 같은 id가 이미 있으면 **포커스+href
 *    갱신**이라 중복 창을 만들지 않는다.
 * ⚠️ 주소는 그대로 둔다(이동 0). 배경 라우트는 어차피 덮여 있고, 새로고침하면 같은 창이 다시 열린다.
 * ⚠️ 창을 닫으면 다시 열리지 않는다 — 이 효과는 경로가 바뀔 때만 돈다.
 * ⚠️ 여기서 주는 제목은 **첫 제목**일 뿐이다 — 창이 뜨면 RouteWindow가 iframe의 document.title을
 *    관찰해 타이틀바를 스스로 갱신한다(스트리밍 중이라 제목이 아직 없어도 곧 제자리를 찾는다).
 */
export function useDeepLinkWindow(enabled: boolean) {
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    const target = deepLinkWindow(pathname, document.title);
    if (!target) return;
    const openIt = () => {
      // 쿼리까지 실어야 필터·탭이 붙은 링크가 그대로 열린다(경로만 열면 남의 화면이 된다).
      // 🔴 경로는 **위에서 검사한 그 경로**를 쓴다(location에서 다시 읽지 않는다) — 창 id와 창이 실제로
      //    여는 주소가 갈리면 "사이드바에서 그 메뉴를 눌렀는데 다른 화면인 창이 뜬다"가 된다.
      // 🔴 해시는 **일부러 뺀다** — withEmbed가 `?`로만 쪼개서 `/x#f` + embed=1이 `/x#f?embed=1`이 되고,
      //    그러면 embed 파라미터가 프래그먼트 안으로 들어가 창 안에 **풀 셸(사이드바)이 통째로** 뜬다.
      const href = `${pathname.split("?")[0].split("#")[0]}${window.location.search}`;
      useWindowStore.getState().open("route", { id: target.id, title: target.title, href });
    };
    if (useWindowStore.persist.hasHydrated()) {
      openIt();
      return;
    }
    return useWindowStore.persist.onFinishHydration(openIt);
  }, [enabled, pathname]);
}
