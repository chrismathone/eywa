"use client";

import { useNavigationSettings } from "@/features/owner/navigation-context";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor, hubSearchKeywords, innerTabsOf, type HubDest, type HubGate } from "@/lib/menu-hub";
import { type AccessMatrix, type SystemRole } from "@/lib/permissions";
import type { MenuLayout } from "@/features/owner/menu-layout";
import { useWindowMode } from "@/components/workspace/use-window-mode";
import { useKeepaliveMode } from "@/components/workspace/shell-mode";
import { useWindowStore } from "@/components/workspace/window-store";
import { useMenuHub } from "@/components/workspace/menu-hub-store";
import { useOpenMenu } from "@/components/workspace/menu-hub-grid";
import { windowIdForHref } from "@/components/workspace/window-link";
import { isPaletteHotkey, PALETTE_OPEN_MESSAGE } from "@/lib/palette-hotkey";
import {
  EMPTY_PALETTE_RESULT,
  PALETTE_LIMIT,
  type PaletteHit,
  type PaletteKind,
  type PaletteSearchResult,
} from "@/features/search/palette";

/** 헤더 검색 버튼 등 외부 요소가 팰릿을 여는 데 쓰는 커스텀 이벤트 이름. */
export const COMMAND_PALETTE_OPEN_EVENT = "eywa:open-command-palette";

/** 메뉴 후보 한 줄 — 목적지(HubDest) + 업무군 이름 + 검색어 뭉치. */
type Command = { dest: HubDest; group: string; keywords: string };

/** 평면 결과 항목(키보드 이동 단위) — 메뉴(클라) 또는 데이터(서버 검색). */
type Item = { kind: "menu"; cmd: Command } | { kind: "data"; hit: PaletteHit };

const DATA_ICON: Record<PaletteKind, AywaIconName> = {
  student: "user",
  class: "book",
  consultation: "messages",
  enrollment: "userPlus",
};
const SECTION_LABEL: Record<string, string> = {
  menu: "메뉴",
  // 팰릿 구역 이름도 메뉴와 같은 말로(원장 2026-09-09) — 옆 구역이 "메뉴"라 둘이 갈리면 어색하다.
  student: "원생",
  class: "수업",
  consultation: "상담",
  enrollment: "신규 콜&상담",
};
const sectionOf = (item: Item): string => (item.kind === "menu" ? "menu" : item.hit.kind);

/**
 * 검색 팰릿. 메뉴(권한 게이트, 클라 즉시 필터) + 데이터 검색(원생/수업/상담/등록상담,
 * /api/search/palette 서버 fetch, 디바운스). 헤더 검색 버튼 클릭으로 열림. 입력 전엔 안 펼침.
 *
 * 🔴 메뉴 축의 출처는 **메뉴 화면·사이드바와 같은 목록**(`HUB_GROUPS`+`SUPPORT_GROUPS`)이고, 여는 방법도
 *    같은 함수(`useOpenMenu`)다 — 두 벌로 만들면 한쪽만 고쳐진다(예전엔 `NAV_GROUPS`만 읽어서 수학 강사
 *    시트·수납/설정 면들이 **검색으로 갈 길이 없었다**).
 * 검색도 학원의 표시·배치·이름·아이콘을 따른다. 원래 이름은 검색어로 함께 유지한다.
 */
export function CommandPalette({
  systemRole,
  permMatrix,
  canTeacherView = false,
  isSuperAdmin = false,
  menuLayout,
  isGenericTenant = false,
}: {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
  /** 겸직(담당 반 보유) — 담당 반을 전제로 만든 메뉴(원스크린·출결 모드)의 쓸모 판정. 사이드바와 같은 규약. */
  canTeacherView?: boolean;
  /**
   * 총괄(super_admin) — master 전용 목적지(감사로그 등)를 사이드바·메뉴 허브와 **같은 판정**으로 연다.
   * 🔴 빠지면 사이드바엔 뜨는 '감사로그'가 검색에선 안 나온다(입구가 갈린다 — 가드 `audit-read-gate.test.ts`).
   */
  isSuperAdmin?: boolean;
  /**
   * '왼쪽 탭' 보기 설정 + 꺼진 모듈의 면(`menuLayoutWithModules`) — 사이드바·메뉴 판과 **같은 목록**을 받는다.
   * 🔴 빠지면 일반판에서 끈 '회차 확정·시수 검증'이 검색에 뜨고, 누르면 안내 없이 수납 면으로 떨어진다
   *    (2026-09-23 전수 점검 F18).
   */
  menuLayout?: MenuLayout;
  /** 새 학원(일반판) — 설정 '기능' 면 노출(사이드바·메뉴 판과 같은 값). */
  isGenericTenant?: boolean;
}) {
  const { groups: groupLayout } = useNavigationSettings();
  const router = useRouter();
  const isDesktop = useWindowMode(); // 창 모드가 아니면 결과를 본문으로 연다
  const openWindow = useWindowStore((s) => s.open);
  const keepalive = useKeepaliveMode(); // 이전 화면 유지 방식엔 원생 요약 창(peek)이 없다 — 원생 화면 하나를 연다
  const openMenu = useOpenMenu();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const commands = useMemo<Command[]>(() => {
    const gate: HubGate = {
      systemRole,
      permMatrix,
      canTeacherView,
      isMaster: systemRole === "master" || isSuperAdmin,
      menuLayout,
      groupLayout,
      isGenericTenant,
    };
    return hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], gate).flatMap((group) =>
      // 메뉴 뒤에 그 화면 위 탭바의 면(수납의 환불 요청서 · 셔틀의 오늘 등하원 …)을 싣는다 — 메뉴엔 따로 안 서지만(원장 2026-10-14)
      // 탭바의 버튼도 이름으로 찾혀야 한다. 면은 부모 메뉴가 보일 때만(`innerTabsOf`).
      // 차례 = 메뉴 판의 버튼 전부 → 그 뒤에 화면 위 탭(수납 · 교재 · 지출 → 환불 …, 리뷰 2026-10-15).
      [...group.items, ...group.items.flatMap((item) => innerTabsOf(item.href, gate))].map((dest) => ({
        dest,
        group: group.label,
        // 라벨+업무군+영문 키+별칭 — 규칙은 [`hubSearchKeywords`](@/lib/menu-hub) 한 곳에 있다.
        // 🔴 별칭이 붙은 이유: 라벨에 없는 말로 찾으면 **0건**이었다(원장 2026-09-09 — 라벨
        //    "신규생 관리"를 *"신입생 관리"*로 찾아 못 찾음). 별칭은 검색에만 실리고 화면엔 안 나온다.
        keywords: hubSearchKeywords(dest, group.label),
      })),
    );
  }, [systemRole, permMatrix, canTeacherView, isSuperAdmin, menuLayout, groupLayout, isGenericTenant]);

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

  const { data: result = EMPTY_PALETTE_RESULT, isFetching } = useQuery<PaletteSearchResult>({
    queryKey: ["palette-search", debounced],
    queryFn: () =>
      fetch(`/api/search/palette?q=${encodeURIComponent(debounced)}`).then((r) =>
        r.ok ? (r.json() as Promise<PaletteSearchResult>) : EMPTY_PALETTE_RESULT,
      ),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(
    () => [
      ...menuResults.map((cmd) => ({ kind: "menu" as const, cmd })),
      ...(q ? result.hits.map((hit) => ({ kind: "data" as const, hit })) : []),
    ],
    [menuResults, result, q],
  );

  // 열 때 항상 초기화. 이벤트 핸들러에서만 호출 → effect 본문 setState 회피.
  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    // 열기 경로 3종(2026-07-20 상단 헤더 제거로 단축키가 1차 진입): ① 커스텀 이벤트(모바일 헤더 검색 버튼)
    // ② 전역 단축키 Shift+F(타이핑 보호)/Ctrl·Cmd+K ③ 창(iframe) 안 단축키의 postMessage 포워딩
    // (PaletteHotkeyForward — keydown은 프레임 경계를 못 넘는다).
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteHotkey(e)) return;
      e.preventDefault();
      openPalette();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type === PALETTE_OPEN_MESSAGE) openPalette();
    };
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, openPalette);
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, openPalette);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
    };
  }, [openPalette]);

  // 키보드 이동 시 활성 항목이 항상 보이도록.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(item: Item) {
    closePalette();
    // 메뉴는 **메뉴 화면·사이드바와 같은 방법**으로 연다(창/배경 판정·방문 기록이 한 곳에 있다).
    if (item.kind === "menu") {
      openMenu(item.cmd.dest);
      return;
    }
    // 🔴 데이터 결과도 떠 있는 메뉴 판을 닫는다 — 판(z-44)이 창 캔버스(z-40)를 덮어, 두면 방금 연 창이 판 밑에
    //    깔린다(메뉴 결과는 `useOpenMenu`가 이미 닫는다 — 2026-09-11 리뷰). 모바일엔 판이 없어 닫아도 무해하다.
    useMenuHub.getState().close();
    const hit = item.hit;
    if (hit.kind === "student") {
      // 학생은 요약 창(StudentWindow) 재사용 — 이전 화면 유지 방식은 요약 창 대신 원생 상세 화면(다른 검색 결과와 같은 길)
      if (isDesktop && keepalive) {
        const href = `/students/${hit.id}`;
        openWindow("route", { id: windowIdForHref(href)?.id ?? `students/${hit.id}`, title: hit.title, href });
      } else if (isDesktop) openWindow("student", { id: hit.id, title: hit.title, subtitle: hit.subtitle ?? undefined });
      else router.push(`/students/${hit.id}`);
      return;
    }
    // 수업·등록상담·학생상담은 상세 페이지로(상세 창) — 검색 결과 클릭 시 해당 항목 상세가 열린다.
    // (학생상담 상세는 2026-07-03 신설 — 이전엔 상세가 없어 목록 창으로 보냈었다.)
    const detailHref =
      hit.kind === "class"
        ? `/classes/${hit.id}`
        : hit.kind === "enrollment"
          ? `/enrollment/${hit.id}`
          : hit.kind === "consultation"
            ? `/consultations/${hit.id}`
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
    const dest = { id: "consultations", title: "원생상담", href: "/consultations" };
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
          // data-usage-chrome — 검색 팰릿 입력은 배경 화면의 활동이 아니다(이용 분석, features/usage/session.ts).
          data-usage-chrome=""
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
              placeholder="메뉴 · 원생 · 수업 · 상담 검색…"
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
                    item.kind === "menu" ? `m:${item.cmd.dest.href}` : `d:${item.hit.kind}:${item.hit.id}`;
                  return (
                    <Fragment key={key}>
                      {showHeader ? (
                        <li className="text-text-faint px-3 pt-2 pb-1 font-mono text-xs tracking-wider uppercase">
                          {SECTION_LABEL[section]}
                          {/* 🔴 상한에 걸린 축은 그 사실을 적는다 — 실데이터에서 '김'은 원생 252명이 걸리는데
                              8건만 보여 주고 끝내면 사람은 "검색이 안 된다"고 읽는다([[#89]]). */}
                          {result.more.includes(section as PaletteKind)
                            ? ` · 상위 ${PALETTE_LIMIT}건`
                            : ""}
                        </li>
                      ) : null}
                      <li>
                        <button
                          ref={isActive ? activeRef : null}
                          type="button"
                          onClick={() => go(item)}
                          onMouseMove={() => setActive(i)}
                          className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition ${
                            isActive ? "bg-primary text-primary-foreground" : "text-foreground"
                          }`}
                        >
                          <span
                            className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${
                              isActive ? "bg-white/15 text-white" : "bg-bg-soft text-text-dim"
                            }`}
                          >
                            {item.kind === "menu" ? (
                              <MenuGlyph name={item.cmd.dest.icon} size={18} />
                            ) : (
                              <EyIcon name={DATA_ICON[item.hit.kind]} size={14} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {item.kind === "menu" ? item.cmd.dest.label : item.hit.title}
                            </span>
                            {item.kind === "data" && item.hit.subtitle ? (
                              <span
                                className={`block truncate text-xs ${
                                  isActive ? "text-white/70" : "text-text-faint"
                                }`}
                              >
                                {item.hit.subtitle}
                              </span>
                            ) : null}
                          </span>
                          {item.kind === "menu" ? (
                            <span
                              className={`shrink-0 font-mono text-xs tracking-wider uppercase ${
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
