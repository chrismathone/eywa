"use client";

import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor, type HubDest } from "@/lib/menu-hub";
import type { MenuLayout } from "@/features/owner/menu-layout";
import type { AccessMatrix, SystemRole } from "@/lib/permissions";
import { HubGrid, useOpenMenu } from "./menu-hub-grid";

/**
 * 첫 화면의 **메뉴 판** — 업무군마다 제목 + 메뉴 버튼(원장 2026-09-07 버튼형 확정).
 *
 * 🔴 왼쪽 사이드바(업무군 → 허브)와 **같은 목적지·같은 여는 방식**을 쓴다([`menu-hub-grid.tsx`]) —
 *    두 벌로 만들면 한쪽만 고쳐진다.
 * ⚠️ 여기엔 **업무군 고르개를 두지 않는다** — 전부 펼쳐 놓고 스크롤하는 게 메뉴 화면의 일이고,
 *    한 업무군만 크게 보고 싶을 땐 왼쪽에서 그 업무군을 누른다(그때 허브가 뜬다).
 * ⚠️ 모바일엔 사이드바가 없어 **이 화면이 유일한 메뉴**다 — 그래서 페이지(라우트)로 만들었다.
 */
export function MenuBoard({
  systemRole,
  permMatrix,
  canTeacherView = false,
  menuLayout,
}: {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
  canTeacherView?: boolean;
  /** 학원 설정 '왼쪽 탭'(보기 설정) — 🔴 **모바일엔 사이드바가 없어 이 화면이 유일한 메뉴**라 여기도 같은 값을 봐야 한다. */
  menuLayout?: MenuLayout;
}) {
  const open = useOpenMenu();
  const groups = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], {
    systemRole,
    permMatrix,
    canTeacherView,
    isMaster: systemRole === "master",
    menuLayout,
  });
  const direct = groups.filter((g) => g.kind === "direct");
  const hubs = groups.filter((g) => g.kind !== "direct");

  return (
    <div className="mx-auto w-full max-w-5xl pb-6">
      <h1 className="text-foreground text-3xl font-bold tracking-tight">메뉴</h1>
      <p className="text-text-dim mt-1 text-sm">
        업무를 골라 화면을 엽니다 · 자주 여는 화면은 왼쪽 맨 위에 자동으로 모입니다
      </p>
      {/* 바로 여는 업무군(운영실·캘린더·도움말)은 **한 줄로 모은다** — 제목 하나에 버튼 하나씩 세우면
          같은 말이 두 번 적히고 세로만 길어진다. */}
      {direct.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-foreground mb-3 text-xl font-bold">바로 열기</h2>
          <HubGrid dests={direct.map((g) => g.items[0]!)} onGo={open} />
        </section>
      ) : null}
      {hubs.map((g) => {
        const main = g.items.filter((d) => !d.tool);
        const tools = g.items.filter((d) => d.tool);
        return (
          <section key={g.id} className="mt-7">
            <h2 className="text-foreground mb-3 text-xl font-bold">{g.label}</h2>
            <HubGrid dests={main} onGo={open} />
            {tools.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {/* 🔴 치수를 손으로 적지 말 것 — 허브 패널의 같은 칩과 **한 쌍**이라 한쪽만 고치면
                    같은 메뉴가 첫 화면과 허브에서 다른 모양으로 보인다(줄상자까지 같아야 해서 CONTROL_LABEL). */}
                {tools.map((d: HubDest) => (
                  <button
                    key={d.href}
                    type="button"
                    onClick={(e) => open(d, e.shiftKey)}
                    className={`border-line text-foreground hover:bg-bg-soft inline-flex items-center rounded-lg border px-3 font-bold ${CONTROL_H} ${CONTROL_LABEL}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
