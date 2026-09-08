"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { EyIcon } from "@/components/icons/eywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { recordMenuVisit } from "@/features/nav/server/visit-actions";
import type { HubDest } from "@/lib/menu-hub";
import { navItemByKey, navPresentation } from "@/lib/navigation";
import { useIsDesktop } from "./use-is-desktop";
import { useMenuHub } from "./menu-hub-store";
import { useShowDesktop } from "./use-show-desktop";
import { useWindowStore } from "./window-store";

/**
 * 메뉴 버튼 격자 + **메뉴를 여는 단 하나의 방법** — 첫 화면(menu-board)과 업무군 허브(menu-hub-panel)가
 * 같은 것을 쓴다. 🔴 두 벌로 만들면 한쪽만 고쳐진다(창으로 열지 라우트로 갈지, 방문 기록, 운영실 예외).
 */

/**
 * 메뉴 하나를 연다.
 * · 데스크톱 = 플로팅 창(Shift = 같은 화면 하나 더) · 운영실처럼 셸 본문이 작업면인 메뉴는 배경 이동.
 * · 모바일·창 시스템이 없는 곳 = 그냥 라우트 이동(창이 없으니 그게 자연스럽다).
 * 🔴 방문 기록은 **여는 순간** 남긴다(왼쪽 '자주 방문한 메뉴'의 재료) — 실패해도 여는 동작을 막지 않는다.
 */
export function useOpenMenu(): (dest: HubDest, shift?: boolean) => void {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const showDesktop = useShowDesktop();
  const closeHub = useMenuHub((s) => s.close);

  return useCallback(
    (dest: HubDest, shift = false) => {
      void recordMenuVisit(dest.menuKey);
      closeHub();
      const item = navItemByKey(dest.menuKey);
      if (!isDesktop) {
        router.push(dest.href);
        return;
      }
      if (item && navPresentation(item) === "desktop") {
        showDesktop();
        return;
      }
      const store = useWindowStore.getState();
      const params = { id: dest.menuKey, title: dest.label, href: dest.href };
      if (shift) store.openNewInstance("route", params);
      else store.open("route", params);
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
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {dests.map((d) => (
        // 🔴 세로 여백도 **채움 70%**를 따른다(원장 2026-09-08 "이런거는 왜 70% 채움이 안되어잇지?") —
        // 높이를 정하는 것은 64px 아이콘 판이라 64 ÷ 0.7 ≈ 91 → 위아래 14px. py-5(20px)면 61.5%라 헐거웠다.
        <button
          key={d.href}
          type="button"
          onClick={(e) => onGo(d, e.shiftKey)}
          className="bg-card shadow-card hover:bg-bg-soft flex items-center gap-4 rounded-xl px-5 py-3.5 text-left transition"
        >
          {/* 🔴 판 배경은 버튼 hover(`hover:bg-bg-soft`)와 **다른 값**이어야 한다 — 같으면 마우스를 올릴 때 판이 사라진다. */}
          <span className="bg-primary-soft text-primary flex size-16 shrink-0 items-center justify-center rounded-xl">
            <MenuGlyph name={d.icon} size={38} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground block truncate text-2xl font-bold">{d.label}</span>
            {d.desc ? <span className="text-text-dim mt-0.5 block truncate text-sm">{d.desc}</span> : null}
          </span>
          <EyIcon name="arrowRight" size={20} className="text-text-faint shrink-0" />
        </button>
      ))}
    </div>
  );
}
