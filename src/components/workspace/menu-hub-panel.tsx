"use client";

import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { HubGrid, useOpenMenu } from "./menu-hub-grid";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor } from "@/lib/menu-hub";
import type { MenuLayout } from "@/features/owner/menu-layout";
import type { AccessMatrix, SystemRole } from "@/lib/permissions";
import { railWidth } from "./use-sidebar-resize";
import { useIsDesktop } from "./use-is-desktop";
import { useMenuHub } from "./menu-hub-store";
import { usePrefs } from "./use-prefs";

/**
 * 업무군 메뉴 허브 — 왼쪽에서 업무군을 고르면 **본문에 그 업무의 메뉴 버튼**이 뜬다(원장 2026-09-07 확정).
 *
 * 🔴 **열린 창을 닫지 않는다** — 허브는 캔버스를 덮는 한 겹이고, 메뉴를 고르면 그 위에서 창이 열린다.
 *    메뉴만 보다가 Esc로 닫으면 하던 작업이 그대로 있다(인수인계 §6의 핵심 요구).
 * 🔴 **층이 둘이다**(원장 2026-09-09 *"학생 상담 누르면 배경이 '메뉴' 전체로 바뀌는데 어색한거 같은데"*):
 *    고르는 중엔 창 **위**(z-44), 메뉴를 고른 뒤엔 창 **아래**(z-39)로 내려가 그대로 **배경**이 된다.
 *    닫아 버리면 그 자리에 메뉴 판 전체가 펼쳐져 화면이 튀고, 방금 고른 묶음의 다음 메뉴도 다시 찾아야 한다.
 * ⚠️ 배경 층은 **메뉴 라우트(`/menu`)에 있을 때만** 그린다 — 다른 배경 라우트에선 캔버스가 불투명한 막
 *    (z-40)을 깔아 이 층이 어차피 안 보이고, 보이지 않는 것을 켜 두면 사이드바 표시만 어긋난다.
 * 🔴 목적지·권한은 [`menu-hub.ts`](src/lib/menu-hub.ts) 한 곳에서 온다 — 여기서 메뉴를 새로 적지 않는다.
 * ⚠️ z 층위: 캔버스(z-40) 위, 사이드바(z-45) **아래** — 허브가 떠 있어도 왼쪽에서 다른 업무군을 바로 고른다.
 *    검색 팰릿(z-50)은 그 위에 뜬다.
 */
export function MenuHubPanel({
  systemRole,
  permMatrix,
  canTeacherView = false,
  menuLayout,
}: {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
  canTeacherView?: boolean;
  /** 학원 설정 '왼쪽 탭'(보기 설정) — 사이드바와 **같은 값**을 봐야 왼쪽과 본문이 같은 목록을 그린다. */
  menuLayout?: MenuLayout;
}) {
  const groupId = useMenuHub((s) => s.groupId);
  const mode = useMenuHub((s) => s.mode);
  const close = useMenuHub((s) => s.close);
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const go = useOpenMenu();
  const sidebarExpanded = usePrefs((s) => s.sidebarExpanded);
  const rail = railWidth(sidebarExpanded);

  // Esc = 닫기(하던 작업으로 돌아간다). 창 안 입력은 다른 문서라 여기 키가 안 걸린다.
  // ⚠️ **배경 층에선 안 듣는다** — 그때 이 판은 화면을 덮은 게 아니라 배경이라, Esc로 조용히 배경을
  //    갈아 끼우면 누른 사람이 무슨 일이 일어났는지 모른다(닫으려면 왼쪽 업무군을 다시 누른다).
  useEffect(() => {
    if (!groupId || mode !== "overlay") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupId, mode, close]);

  const backdrop = mode === "backdrop";
  // 배경 층은 셸 본문이 곧 화면인 라우트(= 메뉴)에서만 의미가 있다 — workspace-canvas의 `isDesktopSurface`와 같은 판정.
  if (!isDesktop || !groupId || (backdrop && pathname !== "/menu")) return null;
  const group = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], {
    systemRole,
    permMatrix,
    canTeacherView,
    isMaster: systemRole === "master",
    menuLayout,
  }).find((g) => g.id === groupId);
  if (!group) return null;

  const main = group.items.filter((d) => !d.tool);
  const tools = group.items.filter((d) => d.tool);
  // 설정처럼 목적지가 많은 허브는 묶음 제목으로 나눈다(순서는 정의 순서 그대로).
  const sections = [...new Set(main.map((d) => d.section).filter((s): s is string => !!s))];

  return (
    <div
      // z-44 = 창 위(고르는 중) · z-39 = 창 아래(배경) — 캔버스가 z-40이라 이 한 칸이 층을 가른다.
      className={`animate-in fade-in-0 fixed duration-150 print:hidden ${backdrop ? "z-[39]" : "z-[44]"}`}
      style={{ left: rail, top: 0, right: 0, bottom: 0 }}
      role={backdrop ? "region" : "dialog"}
      aria-modal={backdrop ? undefined : "false"}
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
                title={backdrop ? "닫기 — 전체 메뉴로" : "닫기 (Esc)"}
                className={`border-line text-text-dim hover:bg-bg-soft hover:text-foreground inline-flex items-center rounded-lg border px-2.5 font-bold ${CONTROL_H} ${CONTROL_LABEL}`}
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
                    className={`border-line text-foreground hover:bg-bg-soft inline-flex items-center rounded-lg border px-3 font-bold ${CONTROL_H} ${CONTROL_LABEL}`}
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
