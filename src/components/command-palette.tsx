"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import type { LucideIcon } from "lucide-react";
import { NAV_GROUPS } from "@/lib/navigation";
import { canAccess, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowStore } from "@/components/workspace/window-store";
import { windowIdForHref } from "@/components/workspace/window-link";
import type { PaletteHit } from "@/features/search/server/queries";

/** 헤더 검색 버튼 등 외부 요소가 팰릿을 여는 데 쓰는 커스텀 이벤트 이름. */
export const COMMAND_PALETTE_OPEN_EVENT = "eywa:open-command-palette";

type Command = {
  href: string;
  label: string;
  group: string;
  icon: LucideIcon;
  menuKey: MenuKey;
  keywords: string;
};

/** 평면 결과 항목(키보드 이동 단위) — 메뉴(클라) 또는 데이터(서버 검색). */
type Item = { kind: "menu"; cmd: Command } | { kind: "data"; hit: PaletteHit };

const DATA_ICON: Record<PaletteHit["kind"], EywaIconName> = {
  student: "seed",
  class: "branch",
  consultation: "wave",
  enrollment: "sprout",
};
const SECTION_LABEL: Record<string, string> = {
  menu: "메뉴",
  student: "학생",
  class: "수업",
  consultation: "상담",
  enrollment: "등록상담",
};
const sectionOf = (item: Item): string => (item.kind === "menu" ? "menu" : item.hit.kind);

/**
 * 검색 팰릿. 정적 메뉴(canAccess 게이트, 클라 즉시 필터) + 데이터 검색(학생/수업/상담/등록상담,
 * /api/search/palette 서버 fetch, 디바운스). 헤더 검색 버튼 클릭으로 열림. 입력 전엔 안 펼침.
 */
export function CommandPalette({
  systemRole,
  permMatrix,
}: {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
}) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const openWindow = useWindowStore((s) => s.open);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.hidden || !canAccess(systemRole, item.menuKey, permMatrix)) continue;
        list.push({
          href: item.href,
          label: item.label,
          group: group.label,
          icon: item.icon,
          menuKey: item.menuKey,
          // menuKey 포함 → 영문 입력("billing")으로도 검색됨
          keywords: `${item.label} ${group.label} ${item.menuKey}`.toLowerCase(),
        });
      }
    }
    return list;
  }, [systemRole, permMatrix]);

  const q = query.trim().toLowerCase();
  const menuResults = useMemo(
    () => (q ? commands.filter((c) => c.keywords.includes(q)) : []),
    [commands, q],
  );

  // 데이터 검색 디바운스 — query 변경 180ms 후 debounced 갱신(setState는 timeout 안이라 effect 룰 OK).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const { data: dataHits = [], isFetching } = useQuery<PaletteHit[]>({
    queryKey: ["palette-search", debounced],
    queryFn: () =>
      fetch(`/api/search/palette?q=${encodeURIComponent(debounced)}`).then((r) =>
        r.ok ? (r.json() as Promise<PaletteHit[]>) : [],
      ),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(
    () => [
      ...menuResults.map((cmd) => ({ kind: "menu" as const, cmd })),
      ...(q ? dataHits.map((hit) => ({ kind: "data" as const, hit })) : []),
    ],
    [menuResults, dataHits, q],
  );

  // 열 때 항상 초기화. 이벤트 핸들러에서만 호출 → effect 본문 setState 회피.
  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, openPalette);
    return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, openPalette);
  }, [openPalette]);

  // 키보드 이동 시 활성 항목이 항상 보이도록.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(item: Item) {
    closePalette();
    if (item.kind === "menu") {
      const cmd = item.cmd;
      if (isDesktop) openWindow("route", { id: cmd.menuKey, title: cmd.label, href: cmd.href });
      else router.push(cmd.href);
      return;
    }
    const hit = item.hit;
    if (hit.kind === "student") {
      // 학생은 요약 창(StudentWindow) 재사용
      if (isDesktop) openWindow("student", { id: hit.id, title: hit.title, subtitle: hit.subtitle ?? undefined });
      else router.push(`/students/${hit.id}`);
      return;
    }
    // 수업·등록상담은 상세 페이지로(상세 창) — 검색 결과 클릭 시 해당 항목 상세가 열린다.
    // 학생상담(consultation)은 전용 상세 페이지가 없어 목록 창으로(기존 동작 유지).
    const detailHref =
      hit.kind === "class"
        ? `/classes/${hit.id}`
        : hit.kind === "enrollment"
          ? `/enrollment/${hit.id}`
          : null;
    if (detailHref) {
      if (isDesktop) {
        const id = windowIdForHref(detailHref)?.id ?? detailHref.slice(1);
        openWindow("route", { id, title: hit.title, href: detailHref });
      } else {
        router.push(detailHref);
      }
      return;
    }
    const dest = { id: "consultations", title: "학생상담", href: "/consultations" };
    if (isDesktop) openWindow("route", dest);
    else router.push(dest.href);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[active];
      if (target) go(target);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? openPalette() : closePalette())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup
          initialFocus={() => inputRef.current}
          className="border-line bg-card shadow-modal fixed top-[26vh] left-1/2 z-50 w-full max-w-[min(560px,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <Dialog.Title className="sr-only">검색</Dialog.Title>

          <div className={`flex items-center gap-2.5 px-4 py-3 ${q ? "border-line border-b" : ""}`}>
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
              placeholder="메뉴 · 학생 · 수업 · 상담 검색…"
              aria-label="검색"
              autoComplete="off"
              className="text-foreground placeholder:text-text-faint flex-1 bg-transparent text-sm focus:outline-none"
            />
          </div>

          {q ? (
            <ul className="scrollbar-thin max-h-[52vh] overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <li className="text-text-dim px-3 py-8 text-center text-xs">
                  {isFetching ? "검색 중…" : "일치하는 결과가 없습니다"}
                </li>
              ) : (
                items.map((item, i) => {
                  const isActive = i === active;
                  const section = sectionOf(item);
                  const showHeader = i === 0 || sectionOf(items[i - 1]) !== section;
                  const key =
                    item.kind === "menu" ? `m:${item.cmd.href}` : `d:${item.hit.kind}:${item.hit.id}`;
                  return (
                    <Fragment key={key}>
                      {showHeader ? (
                        <li className="text-text-faint px-3 pt-2 pb-1 font-mono text-[10px] tracking-wider uppercase">
                          {SECTION_LABEL[section]}
                        </li>
                      ) : null}
                      <li>
                        <button
                          ref={isActive ? activeRef : null}
                          type="button"
                          onClick={() => go(item)}
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
                            {item.kind === "menu" ? (
                              <item.cmd.icon size={14} />
                            ) : (
                              <EyIcon name={DATA_ICON[item.hit.kind]} size={14} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {item.kind === "menu" ? item.cmd.label : item.hit.title}
                            </span>
                            {item.kind === "data" && item.hit.subtitle ? (
                              <span
                                className={`block truncate text-[11px] ${
                                  isActive ? "text-white/70" : "text-text-faint"
                                }`}
                              >
                                {item.hit.subtitle}
                              </span>
                            ) : null}
                          </span>
                          {item.kind === "menu" ? (
                            <span
                              className={`shrink-0 font-mono text-[10px] tracking-wider uppercase ${
                                isActive ? "text-white/70" : "text-text-faint"
                              }`}
                            >
                              {item.cmd.group}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    </Fragment>
                  );
                })
              )}
            </ul>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
