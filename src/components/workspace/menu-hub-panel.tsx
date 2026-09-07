"use client";

import { useEffect } from "react";

import { HubGrid, useOpenMenu } from "./menu-hub-grid";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor } from "@/lib/menu-hub";
import type { AccessMatrix, SystemRole } from "@/lib/permissions";
import { railWidth } from "./use-sidebar-resize";
import { useIsDesktop } from "./use-is-desktop";
import { useMenuHub } from "./menu-hub-store";
import { usePrefs } from "./use-prefs";

/**
 * 업무군 메뉴 허브 — 왼쪽에서 업무군을 고르면 **본문에 그 업무의 메뉴 버튼**이 뜬다(원장 2026-09-07 확정).
 *
 * 🔴 **열린 창을 닫지 않는다** — 허브는 캔버스 위를 덮는 한 겹이고, 메뉴를 고르면 그 위에서 창이 열린다.
 *    메뉴만 보다가 Esc로 닫으면 하던 작업이 그대로 있다(인수인계 §6의 핵심 요구).
 * 🔴 목적지·권한은 [`menu-hub.ts`](src/lib/menu-hub.ts) 한 곳에서 온다 — 여기서 메뉴를 새로 적지 않는다.
 * ⚠️ z 층위: 캔버스(z-40) 위, 사이드바(z-45) **아래** — 허브가 떠 있어도 왼쪽에서 다른 업무군을 바로 고른다.
 *    검색 팰릿(z-50)은 그 위에 뜬다.
 */
export function MenuHubPanel({
  systemRole,
  permMatrix,
  canTeacherView = false,
}: {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
  canTeacherView?: boolean;
}) {
  const groupId = useMenuHub((s) => s.groupId);
  const close = useMenuHub((s) => s.close);
  const isDesktop = useIsDesktop();
  const go = useOpenMenu();
  const sidebarExpanded = usePrefs((s) => s.sidebarExpanded);
  const rail = railWidth(sidebarExpanded);

  // Esc = 닫기(하던 작업으로 돌아간다). 창 안 입력은 다른 문서라 여기 키가 안 걸린다.
  useEffect(() => {
    if (!groupId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupId, close]);

  if (!isDesktop || !groupId) return null;
  const group = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], {
    systemRole,
    permMatrix,
    canTeacherView,
    isMaster: systemRole === "master",
  }).find((g) => g.id === groupId);
  if (!group) return null;

  const main = group.items.filter((d) => !d.tool);
  const tools = group.items.filter((d) => d.tool);
  // 설정처럼 목적지가 많은 허브는 묶음 제목으로 나눈다(순서는 정의 순서 그대로).
  const sections = [...new Set(main.map((d) => d.section).filter((s): s is string => !!s))];

  return (
    <div
      className="animate-in fade-in-0 fixed z-[44] duration-150 print:hidden"
      style={{ left: rail, top: 0, right: 0, bottom: 0 }}
      role="dialog"
      aria-modal="false"
      aria-label={`${group.label} 메뉴`}
    >
      {/* 세로도 가운데 — 짧은 업무군(학생 2칸)이 화면 위쪽에 매달려 있으면 허전하다(원장 2026-09-07).
          길어지면(설정 11칸) `min-h-full`이 자리를 넘겨 자연스럽게 스크롤된다. */}
      <div className="bg-background h-full overflow-auto px-6 py-8 [scrollbar-gutter:stable]">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-text-faint text-xs font-bold">전체 업무 / {group.label}</p>
              <h1 className="text-foreground mt-1 text-3xl font-bold tracking-tight">{group.label}</h1>
              {group.note ? <p className="text-text-dim mt-1 text-sm">{group.note}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-text-faint num text-sm">{main.length}개 메뉴</span>
              <button
                type="button"
                onClick={close}
                aria-label="메뉴 닫기"
                title="닫기 (Esc)"
                className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground h-(--control-h) rounded-lg border px-2.5 text-(length:--control-label) font-bold"
              >
                닫기
              </button>
            </div>
          </header>

          {sections.length > 0 ? (
            sections.map((s) => (
              <section key={s} className="mb-5">
                <h2 className="text-text-dim mb-2 text-base font-bold">{s}</h2>
                <HubGrid dests={main.filter((d) => d.section === s)} onGo={go} />
              </section>
            ))
          ) : (
            <HubGrid dests={main} onGo={go} />
          )}

          {tools.length > 0 ? (
            <section className="mt-6">
              {/* 가끔 쓰는 도구 — 큰 버튼과 섞으면 매일 쓰는 것이 안 보인다. */}
              <h2 className="text-text-dim mb-2 text-base font-bold">도구</h2>
              <div className="flex flex-wrap gap-2">
                {tools.map((d) => (
                  <button
                    key={d.href}
                    type="button"
                    onClick={(e) => go(d, e.shiftKey)}
                    className="border-line text-foreground hover:bg-bg-soft h-(--control-h) rounded-lg border px-3 text-(length:--control-label) font-bold"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <p className="text-text-faint mt-6 text-xs">
            자주 쓰는 화면은 왼쪽 즐겨찾기에서 바로 열 수 있습니다 · Shift+클릭 = 같은 화면을 새 창으로 하나 더
          </p>
        </div>
      </div>
    </div>
  );
}
