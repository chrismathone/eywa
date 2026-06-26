"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { findNavItem } from "@/lib/navigation";
import { useWindowStore } from "./window-store";
import { usePrefs } from "./use-prefs";
import { SIDEBAR_COLLAPSED_W } from "./use-sidebar-resize";
import { useIsDesktop } from "./use-is-desktop";
import { FloatingWindow } from "./floating-window";
import { WindowSwitcher } from "./window-switcher";
import { BackgroundDropZone } from "./background-drop-zone";
import { SnapAssist } from "./snap-assist";
import { SnapLayoutsBar } from "./snap-layouts-bar";
import { SpotlightStrip } from "./spotlight-strip";
import { WorkspaceOnboarding } from "./workspace-onboarding";
import { snapTarget, templateSlots } from "./window-geometry";

// 콘텐츠 스테이지 상단 오프셋 — 헤더(48) 제외. 좌측 레일은 사이드바 실제 너비(펼침/접힘·드래그)
// 를 따라가도록 런타임에 계산(아래 rail). 하드코딩하면 창 최대치가 접힘 기준에 고정됨.
const HEADER = 48;

/**
 * Stage Manager 캔버스 — 현재 라우트의 콘텐츠 영역 위에 뜨는 fixed 오버레이
 * (pointer-events:none, 창·스위처만 이벤트 수신 → 빈 공간은 아래 페이지로 클릭 통과).
 * 데스크톱 전용. 자식은 absolute라 스테이지(레일/헤더 제외) 안에 갇힌다.
 * owner=`tenantId:userId` — 복원 레이아웃이 다른 계정 것이면 store가 초기화(메타 누수 방지).
 */
export function WorkspaceCanvas({ owner }: { owner: string }) {
  const isDesktop = useIsDesktop();
  const order = useWindowStore((s) => s.order);
  const windows = useWindowStore((s) => s.windows);
  const focusedId = useWindowStore((s) => s.focusedId);
  const snapPreview = useWindowStore((s) => s.snapPreview);
  const dragLayout = useWindowStore((s) => s.dragLayout);
  const spotlight = useWindowStore((s) => s.spotlight);
  const bounds = useWindowStore((s) => s.bounds);
  const setStage = useWindowStore((s) => s.setStage);
  const adoptOwner = useWindowStore((s) => s.adoptOwner);
  const setBackground = useWindowStore((s) => s.setBackground);
  const pathname = usePathname();

  // 사이드바 실제 너비 = 펼침이면 저장 너비, 접힘이면 레일(52). 펼침/접힘·드래그 드롭으로 바뀌면
  // 스테이지가 따라가 창 최대치(최대화·스냅)가 사이드바 오른쪽에 정확히 맞는다.
  const sidebarExpanded = usePrefs((s) => s.sidebarExpanded);
  const sidebarWidth = usePrefs((s) => s.sidebarWidth);
  const rail = sidebarExpanded ? sidebarWidth : SIDEBAR_COLLAPSED_W;

  // 메인 프레임 라우트 = 배경. pathname이 바뀔 때마다 store.background 동기 → 배경 교체가
  // pathname 비동기 지연과 무관하게 결정적으로 동작(연타 레이스 방지).
  useEffect(() => {
    const item = findNavItem(pathname);
    if (item) setBackground({ id: item.menuKey, title: item.label, href: item.href });
  }, [pathname, setBackground]);

  // 스테이지 = 뷰포트 − 사이드바(rail) − 헤더. rail(사이드바 너비)이나 브라우저 크기가 바뀌면
  // 재계산 → setStage가 최대화·스냅 창을 새 영역에 재배치(reflow).
  useEffect(() => {
    const setVp = () =>
      setStage({
        left: rail,
        top: HEADER,
        width: Math.max(360, window.innerWidth - rail),
        height: Math.max(280, window.innerHeight - HEADER),
      });
    setVp();
    window.addEventListener("resize", setVp);
    return () => window.removeEventListener("resize", setVp);
  }, [rail, setStage]);

  // 마운트 1회: 영속 레이아웃 복원 후 owner 채택(다른 계정이면 초기화).
  useEffect(() => {
    const done = useWindowStore.persist.rehydrate();
    Promise.resolve(done).then(() => adoptOwner(owner));
  }, [owner, adoptOwner]);

  if (!isDesktop) return null;

  // 드래그 중 레이아웃 바 호버 시 전체 배치 고스트(선택 슬롯 강조), 아니면 단일 스냅 프리뷰.
  // (스포트라이트 중엔 드래그/스냅 비활성이라 고스트 없음.)
  const layoutGhosts = !spotlight && dragLayout ? templateSlots(dragLayout.template, bounds) : null;
  const preview = !spotlight && !dragLayout && snapPreview ? snapTarget(snapPreview, bounds) : null;
  // DOM 순서는 삽입순(안정) 유지, 쌓임순서는 z-index로만 → 포커스/스냅 시 DOM 이동 0 → iframe 리로드 0.
  const wins = Object.values(windows);

  return (
    <>
    <div
      className="pointer-events-none fixed z-40"
      style={{ left: rail, top: HEADER, right: 0, bottom: 0 }}
    >
      {layoutGhosts
        ? layoutGhosts.map((r, i) => (
            <div
              key={i}
              className={`pointer-events-none absolute top-0 left-0 rounded-xl border-2 transition-all duration-100 ${
                i === dragLayout!.slot ? "border-primary/70 bg-primary/15" : "border-primary/25 bg-primary/5"
              }`}
              style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h }}
              aria-hidden="true"
            />
          ))
        : null}
      {preview ? (
        <div
          className="border-primary/60 bg-primary/5 pointer-events-none absolute top-0 left-0 rounded-xl border-2 transition-all duration-100"
          style={{ transform: `translate(${preview.x}px, ${preview.y}px)`, width: preview.w, height: preview.h }}
          aria-hidden="true"
        />
      ) : null}
      {wins.map((w) => (
        <FloatingWindow
          key={w.id}
          win={w}
          focused={w.id === focusedId}
          z={order.indexOf(w.id) + 1}
          spotlight={spotlight}
        />
      ))}
      {spotlight ? (
        <SpotlightStrip />
      ) : (
        <>
          <SnapAssist />
          <SnapLayoutsBar />
          <BackgroundDropZone />
          <WindowSwitcher />
        </>
      )}
    </div>
    <WorkspaceOnboarding />
    </>
  );
}
