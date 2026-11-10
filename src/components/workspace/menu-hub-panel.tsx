"use client";

import { useNavigationSettings } from "@/features/owner/navigation-context";

import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { useEffect } from "react";

import { HubGrid, useOpenMenu } from "./menu-hub-grid";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor } from "@/lib/menu-hub";
import type { MenuLayout } from "@/features/owner/menu-layout";
import type { AccessMatrix, SystemRole } from "@/lib/permissions";
import { railWidth } from "./use-sidebar-resize";
import { useIsDesktop } from "./use-is-desktop";
import { useMenuHub } from "./menu-hub-store";
import { usePrefs } from "./use-prefs";

/** 업무군 선택 패널. 메뉴를 고르면 닫히고, 열린 업무 창 뒤에는 대시보드가 남는다.
 * 메뉴와 권한은 menu-hub.ts, 쌓임 순서는 창(40) < 패널(44) < 사이드바(45)를 따른다. */
export function MenuHubPanel({
  systemRole,
  isSuperAdmin,
  permMatrix,
  canTeacherView = false,
  menuLayout,
  isGenericTenant = false,
  canViewVendors = false,
}: {
  systemRole: SystemRole;
  /** 총괄(super_admin) — master 전용 목적지를 함께 연다. */
  isSuperAdmin?: boolean;
  permMatrix?: AccessMatrix;
  canTeacherView?: boolean;
  /** 학원 설정 '왼쪽 탭'(보기 설정) — 사이드바와 **같은 값**을 봐야 왼쪽과 본문이 같은 목록을 그린다. */
  menuLayout?: MenuLayout;
  /** 새 학원(일반판) — 설정 '기능' 면 노출. 사이드바와 같은 값을 받는다. */
  isGenericTenant?: boolean;
  /** 업체리스트 지정자 — 학원운영 판의 '업체리스트' 입구(menu-hub `vendorsOnly`). */
  canViewVendors?: boolean;
}) {
  const { groups: groupLayout } = useNavigationSettings();
  const groupId = useMenuHub((s) => s.groupId);
  const close = useMenuHub((s) => s.close);
  const isDesktop = useIsDesktop();
  const go = useOpenMenu();
  const sidebarExpanded = usePrefs((s) => s.sidebarExpanded);
  const rail = railWidth(sidebarExpanded);

  // Esc는 메뉴 선택만 취소한다. 작업 중인 창은 그대로 둔다.
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
    // 🔴 총괄(super_admin)도 통과 — 사이드바 게이트와 같은 규약(한쪽만 고치면 입구가 갈린다).
    isMaster: systemRole === "master" || isSuperAdmin,
    menuLayout,
    groupLayout,
    isGenericTenant,
    canViewVendors,
  }).find((g) => g.id === groupId);
  if (!group) return null;

  const main = group.items.filter((d) => !d.tool);
  const tools = group.items.filter((d) => d.tool);
  // 설정처럼 목적지가 많은 허브는 묶음 제목으로 나눈다(순서는 정의 순서 그대로).
  // 묶음 제목은 모든 메뉴에 붙어 있을 때만 쓴다 — 학원 설정에서 옮긴 줄은 묶음이 지워져, 섞이면 일부만 묶음에 서고 나머지가 흩어진다.
  const sections = main.every((d) => !!d.section) ? [...new Set(main.map((d) => d.section!))] : [];

  return (
    <div
      // data-usage-chrome — 메뉴 판 입력은 배경 화면의 활동이 아니다(이용 분석, features/usage/session.ts).
      data-usage-chrome=""
      className="animate-in fade-in-0 fixed z-[44] duration-150 print:hidden"
      style={{ left: rail, top: 0, right: 0, bottom: 0 }}
      role="dialog"
      aria-modal="false"
      aria-label={`${group.label} 메뉴`}
    >
      {/* 세로도 가운데 — 짧은 업무군(학생 2칸)이 화면 위쪽에 매달려 있으면 허전하다(원장 2026-09-07).
          길어지면(설정 11칸) `min-h-full`이 자리를 넘겨 자연스럽게 스크롤된다.
          바탕 = 사이드바와 같은 면(`bg-sidebar`) — 메뉴 판은 사이드바 업무군을 펼친 자리다. `bg-background`는 테마가 덮지 않아
          종이색 화면 위에 흰 판이 떴다(원장 2026-11-09 수납관리 판 캡처). 기본 팔레트에선 둘 다 흰색이라 그대로다. */}
      <div className="bg-sidebar h-full overflow-auto px-6 py-8 [scrollbar-gutter:stable]">
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
                className={`border-line text-text-dim hover:bg-bg-soft hover:text-foreground inline-flex items-center rounded-lg border px-2.5 font-bold ${CONTROL_H} ${CONTROL_LABEL}`}
              >
                닫기
              </button>
            </div>
          </header>

          {sections.length > 0 ? (
            <>
              {sections.map((s) => (
                <section key={s} className="mb-5">
                  <h2 className="text-text-dim mb-2 text-base font-bold">{s}</h2>
                  <HubGrid dests={main.filter((d) => d.section === s)} onGo={go} />
                </section>
              ))}
              {/* 묶음 제목이 없는 메뉴(학원 설정 '탭 및 메뉴 구성'에서 옮긴 줄은 묶음이 지워진다)도 빠뜨리지 않는다 — 안 그리면 'N개 메뉴'인데 일부만 보였다. */}
              {main.some((d) => !d.section) ? (
                <section className="mb-5">
                  <h2 className="text-text-dim mb-2 text-base font-bold">그 밖의 메뉴</h2>
                  <HubGrid dests={main.filter((d) => !d.section)} onGo={go} />
                </section>
              ) : null}
            </>
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
