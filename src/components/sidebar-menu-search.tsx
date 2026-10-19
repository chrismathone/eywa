"use client";

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOpenMenu } from "@/components/workspace/menu-hub-grid";
import { groupHubSearch, type HubSearchEntry } from "@/lib/menu-hub";

/**
 * 사이드바 **메뉴 검색**(원장 2026-10-19 *"좌측 메뉴에서 메뉴 검색하는 검색창 — 기존 디자인과 가시성·편의성을
 * 해치지 않는 선에서"* → 같은 날 *"숨길수도있고 지금처럼 펼쳐지게도"* · *"클릭하면 수업) 수업목록·시간표 / 원생) 원생목록
 * 등등 지도처럼 촤라락 펼쳐지게 + 검색기능"*).
 *
 * 🔑 칸을 누르면 사이드바 오른쪽에 **메뉴 지도**(`sidebar-menu-map.tsx`)가 펼쳐진다 — 업무군마다 그 안의 메뉴를
 *    여러 열로 늘어놓아 한눈에 보고, 치는 대로 걸러진다. 사이드바 목록 자체는 건드리지 않는다(눈에 익은 자리 그대로).
 * 🔴 찾는 목록·매칭은 검색 팰릿(Shift+F)과 **같은 함수**(`hubSearchEntries`·`matchHubSearch`) — 한쪽에서만 찾히는
 *    화면이 생기지 않게. 여는 방법도 메뉴 판·팰릿과 같은 `useOpenMenu`(창/배경 판정·방문 기록 한 곳).
 * 📌 칸 숨김은 계정 설정(`users.ui_prefs.nav.searchHidden`) — 숨기면 첫 묶음 머리 오른쪽의 돋보기로 다시 편다.
 * 📌 접힌 레일(52px)엔 칸을 세울 자리가 없다 — 돋보기 하나로 팰릿을 연다.
 */

type SearchState = {
  q: string;
  active: number;
  open: boolean;
  setQ: (q: string) => void;
  setActive: (i: number) => void;
  setOpen: () => void;
  close: () => void;
};

/** 입력칸(사이드바)과 지도(오른쪽 패널)가 떨어져 있어 상태를 한 곳에 둔다. */
export const useSidebarSearch = create<SearchState>((set) => ({
  q: "",
  active: 0,
  open: false,
  // 검색어가 바뀌면 고른 줄은 맨 위로 — effect로 되돌리지 않는다(set-state-in-effect).
  setQ: (q) => set({ q, active: 0, open: true }),
  setActive: (active) => set({ active }),
  setOpen: () => set({ open: true }),
  close: () => set({ q: "", active: 0, open: false }),
}));

/** 지도·칸 둘 다 이 표식 안 — 이 밖을 누르면 지도를 닫는다. */
export const SEARCH_ZONE_ATTR = "data-sidebar-menu-search";

export function openCommandPalette() {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}

/** 지금 검색어로 묶은 지도 — 칸(키보드)과 지도(그림)가 같은 순서를 본다. */
export function useMenuMap(entries: readonly HubSearchEntry[]) {
  const q = useSidebarSearch((s) => s.q);
  return useMemo(() => groupHubSearch(entries, q), [entries, q]);
}

/** 입력칸 — 펼침이면 검색칸, 접힘이면 돋보기(팰릿 열기). */
export function SidebarSearchBox({
  entries,
  expanded,
  onHide,
}: {
  entries: readonly HubSearchEntry[];
  expanded: boolean;
  onHide: () => void;
}) {
  const { q, active, open, setQ, setActive, setOpen, close } = useSidebarSearch();
  const { flat } = useMenuMap(entries);
  const openMenu = useOpenMenu();
  const inputRef = useRef<HTMLInputElement>(null);

  // 지도 밖을 누르면 닫는다(칸·지도 둘 다 SEARCH_ZONE_ATTR 안). 열려 있을 때만 듣는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[${SEARCH_ZONE_ATTR}]`)) close();
    };
    // 🔴 창(iframe) 안을 누르면 그 pointerdown은 이 문서에 안 온다 — 대신 이 문서가 포커스를 잃으니 그때 닫는다.
    const onBlur = () => close();
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, close]);

  if (!expanded) {
    return (
      <div className="flex shrink-0 justify-center pt-2.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={openCommandPalette}
                aria-label="검색"
                className="text-text-dim hover:bg-bg-soft hover:text-foreground flex size-9 items-center justify-center rounded-[9px] transition-colors"
              >
                <EyIcon name="search" size={18} />
              </button>
            }
          />
          <TooltipContent side="right">검색 · Shift+F</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && flat.length) {
      e.preventDefault();
      setActive(Math.min(active + 1, flat.length - 1));
    } else if (e.key === "ArrowUp" && flat.length) {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && open && flat[active]) {
      e.preventDefault();
      openMenu(flat[active].dest, e.shiftKey);
      close();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      close();
      inputRef.current?.blur();
    }
  }

  return (
    <div className="shrink-0 px-2 pt-2.5" {...{ [SEARCH_ZONE_ATTR]: "" }}>
      {/* 하얀 칸 + 구조선 테두리(팔레트 v4) — 메뉴 줄(h-9)보다 한 단계 낮은 h-8로 "줄"이 아니라 "칸"으로 읽히게. */}
      <div className="border-line bg-card text-text-dim focus-within:border-primary focus-within:ring-primary/20 flex h-8 items-center gap-1.5 rounded-lg border pr-1 pl-2 focus-within:ring-2">
        <EyIcon name="search" size={16} className="shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={setOpen}
          onClick={setOpen}
          onKeyDown={onKeyDown}
          placeholder="메뉴 검색"
          aria-label="메뉴 검색"
          role="combobox"
          aria-expanded={open}
          aria-controls="sidebar-menu-map"
          autoComplete="off"
          spellCheck={false}
          className="text-foreground placeholder:text-text-faint min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="검색어 지우기" className="hover:text-foreground flex size-6 shrink-0 items-center justify-center">
            <EyIcon name="close" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            close();
            onHide();
          }}
          aria-label="메뉴 검색 숨기기"
          title="메뉴 검색 숨기기"
          className="hover:bg-bg-soft hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md"
        >
          <EyIcon name="chevronUp" size={14} />
        </button>
      </div>
    </div>
  );
}

/** 숨긴 칸을 다시 펴는 돋보기 — 첫 묶음 머리(자주 방문한 메뉴) 오른쪽 끝에 선다. 자리를 새로 차지하지 않는다. */
export function SidebarSearchShowButton({ onShow }: { onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label="메뉴 검색 보이기"
      title="메뉴 검색 보이기"
      className="text-text-dim hover:bg-bg-soft hover:text-foreground flex size-6 items-center justify-center rounded-md"
    >
      <EyIcon name="search" size={14} />
    </button>
  );
}
