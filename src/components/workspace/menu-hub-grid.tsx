"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { recordMenuVisit } from "@/features/nav/server/visit-actions";
import { hubDestinationForPath, type HubDest } from "@/lib/menu-hub";
import { navItemByKey, navPresentation } from "@/lib/navigation";
import { useWindowMode } from "./use-window-mode";
import { useMenuHub } from "./menu-hub-store";
import { useShowDesktop } from "./use-show-desktop";
import { useWindowStore } from "./window-store";
import { openMenuWindow } from "./open-menu-window";
import { windowIdForHref } from "./window-link";
import { useNavigationSettings } from "@/features/owner/navigation-context";

/**
 * 업무군 패널·검색에서 메뉴를 여는 공통 경로. 대시보드는 배경으로, 업무는 창으로 연다.
 */

/**
 * 메뉴 하나를 연다.
 * · 데스크톱 = 플로팅 창(Shift = 같은 화면 하나 더) · 운영실처럼 셸 본문이 작업면인 메뉴는 배경 이동.
 * · 모바일·창 시스템이 없는 곳 = 그냥 라우트 이동(창이 없으니 그게 자연스럽다).
 * 🔴 방문 기록은 **여는 순간** 남긴다(왼쪽 '자주 방문한 메뉴'의 재료) — 실패해도 여는 동작을 막지 않는다.
 */
export function useOpenMenu(): (dest: HubDest, shift?: boolean) => void {
  const router = useRouter();
  const isDesktop = useWindowMode(); // 창 모드가 아니면 그냥 이동(아래 router.push)
  const showDesktop = useShowDesktop();
  const closeHub = useMenuHub((s) => s.close);

  return useCallback(
    (dest: HubDest, shift = false) => {
      void recordMenuVisit(dest.menuKey);
      // 업무를 고르면 메뉴를 닫아 대시보드를 배경으로 유지한다.
      closeHub();
      const item = navItemByKey(dest.menuKey);
      if (!isDesktop) {
        router.push(dest.href);
        return;
      }
      // 시안: 권한만 빌린 목적지(홍보·마케팅 등 — 대시보드 권한)는 그 메뉴의 바탕 화면이 아니라 자기 창으로 연다.
      if (item && item.href === dest.href && navPresentation(item) === "desktop") {
        // 배경 자체를 보여 달라는 뜻이라 허브는 **닫는다**(배경에 남으면 그 배경을 가린다).
        closeHub();
        showDesktop();
        return;
      }
      // 🔴 창 id는 **창 링크·알림 벨·딥링크와 같은 함수**로 정한다 — 경로로 갈리는 면(오늘 출결·셔틀 면)을 여기선
      //    부모 창, 링크에선 따로 된 창으로 열어 같은 화면이 두 벌 떴다(2026-09-11 전수검사). 면 = 부모 창(원장 결정).
      const params = { id: windowIdForHref(dest.href)?.id ?? dest.menuKey, title: hubDestinationForPath(dest.href)?.label ?? dest.label, href: dest.href };
      if (shift) {
        useWindowStore.getState().openNewInstance("route", params);
        return;
      }
      // 🔴 **이미 보고 있는 메뉴를 다시 고르면 첫 화면으로 되돌린다** (원장 2026-09-10:
      //    *"회의록을 작성 완료하고 분석 끝난 상태에서 다시 메뉴에서 회의록을 누르면 기존 화면이 유지됨"*).
      //    종전엔 `store.open()`만 불러 **포커스만** 했다 — 드릴인은 창 iframe 안에서 일어나
      //    `params.href`가 루트 그대로라 아무 데도 안 갔다. 사이드바 줄엔 있던 규칙이 여기엔 없어서,
      //    메뉴 판을 거치는 목적지(= 업무군 안 전부)가 같은 증상이었다. 판정은 `openMenuWindow` 한 곳.
      openMenuWindow(params);
    },
    [closeHub, isDesktop, router, showDesktop],
  );
}

/**
 * 메뉴 버튼 격자 — 넓은 화면 3열, 좁아지면 2열·1열.
 * 버튼은 원장 지시로 1.5배(2026-09-07) — 메뉴 화면은 **고르는 화면**이라 밀도보다 크기가 먼저다.
 */
export function HubGrid({
  dests,
  onGo,
}: {
  dests: HubDest[];
  onGo: (d: HubDest, shift: boolean) => void;
}) {
  const { laboratoryMenus = [] } = useNavigationSettings();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {dests.map((d) => (
        // 🔴 세로 여백도 **채움 70%**를 따른다(원장 2026-09-08 "이런거는 왜 70% 채움이 안되어잇지?") —
        // 높이를 정하는 것은 64px 아이콘 판이라 64 ÷ 0.7 ≈ 91 → 위아래 14px. py-5(20px)면 61.5%라 헐거웠다.
        <button
          key={d.href}
          type="button"
          onClick={(e) => onGo(d, e.shiftKey)}
          className="bg-card shadow-card hover:bg-bg-soft relative flex items-center gap-4 rounded-xl px-5 py-3.5 text-left transition"
        >
          {/* 🔴 판 배경은 버튼 hover(`hover:bg-bg-soft`)와 **다른 값**이어야 한다 — 같으면 마우스를 올릴 때 판이 사라진다. */}
          <span className="bg-primary-soft text-primary flex size-16 shrink-0 items-center justify-center rounded-xl">
            <MenuGlyph name={d.icon} size={38} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground block break-words text-2xl font-bold">{d.label}</span>
            {d.desc ? <span className="text-text-dim mt-0.5 block truncate text-sm">{d.desc}</span> : null}
          </span>
          <EyIcon name="arrowRight" size={20} className="text-text-faint shrink-0" />
          {laboratoryMenus.includes(d.menuKey) && <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary-soft text-primary" title="실험실 기능"><EyIcon name="flask" size={14} aria-label="실험실 기능" /></span>}
        </button>
      ))}
    </div>
  );
}
