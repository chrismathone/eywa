"use client";

import { useMemo, useRef } from "react";
import { create } from "zustand";

import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";
import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOpenMenu } from "@/components/workspace/menu-hub-grid";
import { matchHubSearch, type HubSearchEntry } from "@/lib/menu-hub";

/**
 * 사이드바 **메뉴 검색**(원장 2026-10-19 *"좌측 메뉴에서 메뉴 검색하는 검색창 — 기존 디자인과 가시성·편의성을
 * 해치지 않는 선에서"*).
 *
 * 🔑 왼쪽엔 업무군만 서고 메뉴는 그 안 판에 있어서, 이름을 알아도 어느 업무군인지 모르면 두세 번 눌러야 했다.
 *    여기에 이름을 치면 **업무군을 건너뛰고** 그 메뉴가 바로 줄로 선다(타자 즉시 — 서버 왕복 없음).
 * 🔴 찾는 목록·매칭은 검색 팰릿(Shift+F)과 **같은 함수**(`hubSearchEntries`·`matchHubSearch`) — 한쪽에서만
 *    찾히는 화면이 생기지 않게. 여는 방법도 메뉴 판·팰릿과 같은 `useOpenMenu`(창/배경 판정·방문 기록 한 곳).
 * 📌 메뉴만 찾는다 — 학생·수업 같은 데이터는 팰릿 몫이라, 결과가 없을 때 그쪽으로 넘기는 버튼을 둔다.
 * 📌 접힌 레일(52px)엔 입력칸을 세울 자리가 없다 — 돋보기 하나로 팰릿을 연다.
 */

type SearchState = {
  q: string;
  active: number;
  setQ: (q: string) => void;
  setActive: (i: number) => void;
};

/** 입력칸(브랜드 줄 아래)과 결과(메뉴 자리)가 떨어져 있어 상태를 한 곳에 둔다. */
export const useSidebarSearch = create<SearchState>((set) => ({
  q: "",
  active: 0,
  // 검색어가 바뀌면 고른 줄은 맨 위로 — effect로 되돌리지 않는다(set-state-in-effect).
  setQ: (q) => set({ q, active: 0 }),
  setActive: (active) => set({ active }),
}));

function openPalette() {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}

function useResults(entries: readonly HubSearchEntry[]) {
  const q = useSidebarSearch((s) => s.q);
  return useMemo(() => matchHubSearch(entries, q), [entries, q]);
}

/** 입력칸 — 펼침이면 검색칸, 접힘이면 돋보기(팰릿 열기). */
export function SidebarSearchBox({ entries, expanded }: { entries: readonly HubSearchEntry[]; expanded: boolean }) {
  const { q, active, setQ, setActive } = useSidebarSearch();
  const results = useResults(entries);
  const openMenu = useOpenMenu();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!expanded) {
    return (
      <div className="flex shrink-0 justify-center pt-2.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={openPalette}
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
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setActive(Math.min(active + 1, results.length - 1));
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      openMenu(results[active].dest, e.shiftKey);
      setQ("");
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setQ("");
      inputRef.current?.blur();
    }
  }

  return (
    <div className="shrink-0 px-2 pt-2.5">
      {/* 하얀 칸 + 구조선 테두리(팔레트 v4) — 메뉴 줄(h-9)보다 한 단계 낮은 h-8로 "줄"이 아니라 "칸"으로 읽히게. */}
      <label className="border-line bg-card text-text-dim focus-within:border-primary focus-within:ring-primary/20 flex h-8 items-center gap-1.5 rounded-lg border px-2 focus-within:ring-2">
        <EyIcon name="search" size={16} className="shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메뉴 검색"
          aria-label="메뉴 검색"
          role="combobox"
          aria-expanded={q.trim() !== ""}
          aria-controls="sidebar-menu-search-results"
          autoComplete="off"
          spellCheck={false}
          className="text-foreground placeholder:text-text-faint min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="검색어 지우기" className="hover:text-foreground shrink-0">
            <EyIcon name="close" size={14} />
          </button>
        ) : null}
      </label>
    </div>
  );
}

/** 결과 — 메뉴 자리에 선다(검색 중엔 업무군 목록 대신). */
export function SidebarSearchResults({ entries }: { entries: readonly HubSearchEntry[] }) {
  const { q, active, setQ, setActive } = useSidebarSearch();
  const results = useResults(entries);
  const openMenu = useOpenMenu();

  if (results.length === 0) {
    return (
      <div className="text-text-dim px-4 py-2 text-sm leading-snug">
        <p className="break-keep">&lsquo;{q.trim()}&rsquo; 메뉴가 없습니다.</p>
        <button type="button" onClick={openPalette} className="text-primary mt-1.5 block text-left text-sm font-bold hover:underline">
          학생·수업까지 찾기 (Shift+F)
        </button>
      </div>
    );
  }

  return (
    <ul id="sidebar-menu-search-results" role="listbox" aria-label="메뉴 검색 결과" className="flex flex-col gap-1">
      {results.map((r, i) => (
        <li key={r.dest.href} role="option" aria-selected={i === active}>
          <button
            type="button"
            onClick={(e) => {
              openMenu(r.dest, e.shiftKey);
              setQ("");
            }}
            onMouseEnter={() => setActive(i)}
            title={`${r.group} › ${r.dest.label}`}
            className="group relative flex h-9 w-full items-center gap-2.5 pr-3 pl-[17px] text-left"
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 right-1 left-1 rounded-[9px] ${i === active ? "bg-sidebar-accent" : ""}`}
            />
            <MenuGlyph name={r.dest.icon} size={18} className="text-text-dim group-hover:text-foreground relative shrink-0" />
            <span className="text-foreground relative min-w-0 flex-1 truncate text-sm font-medium">{r.dest.label}</span>
            <span className="text-text-faint relative max-w-[70px] shrink-0 truncate text-xs">{r.group}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
