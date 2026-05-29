"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { NAV_GROUPS } from "@/lib/navigation";
import { canAccess, type SystemRole } from "@/lib/permissions";

/** 헤더 검색 버튼 등 외부 요소가 팰릿을 여는 데 쓰는 커스텀 이벤트 이름. */
export const COMMAND_PALETTE_OPEN_EVENT = "eywa:open-command-palette";

type Command = {
  href: string;
  label: string;
  group: string;
  icon: EywaIconName;
  keywords: string;
};

/**
 * ⌘K / Ctrl+K 메뉴 점프 팰릿. 사이드바와 동일한 canAccess 게이트로 접근 가능한
 * 메뉴만 노출한다. 전역 단축키 + 헤더 검색 버튼(커스텀 이벤트) 두 경로로 열린다.
 * 전부 클라이언트 사이드 — 네트워크 왕복 없이 즉시 이동 (반응속도 1순위).
 */
export function CommandPalette({ systemRole }: { systemRole: SystemRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (!canAccess(systemRole, item.menuKey)) continue;
        list.push({
          href: item.href,
          label: item.label,
          group: group.label,
          icon: item.icon,
          // menuKey 포함 → 영문 입력("billing")으로도 검색됨
          keywords: `${item.label} ${group.label} ${item.menuKey}`.toLowerCase(),
        });
      }
    }
    return list;
  }, [systemRole]);

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () => (q ? commands.filter((c) => c.keywords.includes(q)) : commands),
    [commands, q],
  );

  // 열 때 항상 검색어·선택 초기화. 이벤트 핸들러에서만 호출 → effect 본문 setState 회피.
  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  // 전역 ⌘K / Ctrl+K 토글 + 외부 트리거(헤더 검색) 이벤트
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, openPalette);
    };
  }, [open, openPalette, closePalette]);

  // 키보드 이동 시 활성 항목이 항상 보이도록 (긴 목록·짧은 뷰포트 대비)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function navigate(href: string) {
    closePalette();
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[active];
      if (target) navigate(target.href);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? openPalette() : closePalette())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup
          initialFocus={() => inputRef.current}
          className="border-line bg-card shadow-modal fixed top-[14vh] left-1/2 z-50 w-full max-w-[min(560px,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <Dialog.Title className="sr-only">메뉴 검색</Dialog.Title>

          <div className="border-line flex items-center gap-2.5 border-b px-4 py-3">
            <span className="text-text-dim">
              <EyIcon name="search" size={15} />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="메뉴 이동… (예: 출석, 수납, 회의록)"
              aria-label="메뉴 검색"
              autoComplete="off"
              className="text-foreground placeholder:text-text-faint flex-1 bg-transparent text-sm focus:outline-none"
            />
            <kbd className="bg-bg-soft text-text-faint rounded-sm px-1.5 py-px font-mono text-[10px]">
              ESC
            </kbd>
          </div>

          <ul className="scrollbar-thin max-h-[52vh] overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <li className="text-text-dim px-3 py-8 text-center text-xs">
                일치하는 메뉴가 없습니다
              </li>
            ) : (
              results.map((c, i) => {
                const isActive = i === active;
                return (
                  <li key={c.href}>
                    <button
                      ref={isActive ? activeRef : null}
                      type="button"
                      onClick={() => navigate(c.href)}
                      onMouseMove={() => setActive(i)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition ${
                        isActive ? "bg-primary text-primary-foreground" : "text-foreground"
                      }`}
                    >
                      <span
                        className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${
                          isActive ? "bg-white/15 text-white" : "bg-bg-soft text-text-dim"
                        }`}
                      >
                        <EyIcon name={c.icon} size={14} />
                      </span>
                      <span className="flex-1 truncate font-medium">{c.label}</span>
                      <span
                        className={`font-mono text-[10px] tracking-wider uppercase ${
                          isActive ? "text-white/70" : "text-text-faint"
                        }`}
                      >
                        {c.group}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
