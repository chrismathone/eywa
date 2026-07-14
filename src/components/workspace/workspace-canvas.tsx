"use client";

import { useEffect } from "react";
import { subscribeWindowBusy } from "@/lib/realtime/window-busy";
import { useWindowStore } from "./window-store";
import { usePrefs } from "./use-prefs";
import { SIDEBAR_COLLAPSED_W } from "./use-sidebar-resize";
import { useIsDesktop } from "./use-is-desktop";
import Image from "next/image";
import { FloatingWindow } from "./floating-window";
import { iframeRegistry } from "./route-window";
import { WindowSwitcher } from "./window-switcher";
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
  const exitSpotlight = useWindowStore((s) => s.exitSpotlight);
  const bounds = useWindowStore((s) => s.bounds);
  const setStage = useWindowStore((s) => s.setStage);
  const adoptOwner = useWindowStore((s) => s.adoptOwner);

  // 사이드바 실제 너비 = 펼침이면 저장 너비, 접힘이면 레일(52). 펼침/접힘·드래그 드롭으로 바뀌면
  // 스테이지가 따라가 창 최대치(최대화·스냅)가 사이드바 오른쪽에 정확히 맞는다.
  const sidebarExpanded = usePrefs((s) => s.sidebarExpanded);
  const sidebarWidth = usePrefs((s) => s.sidebarWidth);
  const rail = sidebarExpanded ? sidebarWidth : SIDEBAR_COLLAPSED_W;

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
    // 영속 레이아웃 복원(rehydrate)은 window-store 모듈 로드 시점에서 처리한다(다른 effect의 set보다
    // 먼저 도록 — 안 그러면 빈 상태가 persist에 써져 영속 창이 파괴됨). 여기선 하이드레이션 완료 후
    // owner 채택(다른 계정/테넌트면 초기화). 이미 하이드레이션됐으면 즉시, 아니면 완료 시점에.
    if (useWindowStore.persist.hasHydrated()) {
      adoptOwner(owner);
      return;
    }
    const unsub = useWindowStore.persist.onFinishHydration(() => adoptOwner(owner));
    return unsub;
  }, [owner, adoptOwner]);

  // 창 안에서 녹음 등 끊기면 안 되는 작업이 진행 중이면 탭 전체 새로고침/이탈을 막는다(부모 탭은
  // iframe의 beforeunload가 못 막으므로 최상위 프레임에서 별도 가드). 마지막 busy 해제 시 제거.
  useEffect(() => {
    const busy = new Set<string>();
    let installed = false;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const unsub = subscribeWindowBusy((m) => {
      if (m.active) busy.add(m.winId);
      else busy.delete(m.winId);
      const need = busy.size > 0;
      if (need && !installed) {
        window.addEventListener("beforeunload", guard);
        installed = true;
      } else if (!need && installed) {
        window.removeEventListener("beforeunload", guard);
        installed = false;
      }
    });
    return () => {
      unsub();
      if (installed) window.removeEventListener("beforeunload", guard);
    };
  }, []);

  // iframe(창) → 부모 브리지(postMessage): iframe 내부 이벤트는 부모로 버블되지 않으므로 embed 페이지가
  // window.parent로 메시지를 보낸다. event.source(=클릭된 iframe의 contentWindow)를 iframeRegistry와 대조해
  // 어느 창인지 찾는다(우리 플로팅 창에서 온 것만 수용 — 중복창·다중탭 안전). 2종:
  //  · 'eywa-window-focus'(EmbedFocusSignal) → 그 창을 최상단(focus). 이미 포커스면 skip(재렌더 방지).
  //  · 'eywa-open-window'(WindowLink shift+클릭) → 드릴인 대신 링크 대상을 **새 플로팅 창**으로 open.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as {
        type?: string;
        id?: string;
        title?: string;
        href?: string;
        autoClose?: boolean;
        dirty?: boolean;
      } | null;
      if (!data || !e.source) return;
      let sourceWinId: string | null = null;
      for (const [winId, el] of iframeRegistry) {
        if (el.contentWindow === e.source) {
          sourceWinId = winId;
          break;
        }
      }
      if (sourceWinId === null) return; // 우리 플로팅 창이 아닌 곳에서 온 메시지 무시.
      const st = useWindowStore.getState();
      if (data.type === "eywa-window-focus") {
        if (st.focusedId !== sourceWinId) st.focus(sourceWinId);
        return;
      }
      if (data.type === "eywa-window-dirty") {
        // 창 본문 폼의 미저장 변경 여부(useUnsavedGuard) → 그 창 id로 저장. FloatingWindow가 X/Esc 확인에 사용.
        st.setWindowDirty(sourceWinId, data.dirty === true);
        return;
      }
      if (data.type === "eywa-open-window" && data.id && data.href) {
        // autoClose=true(useOpenFormWindow "새 X" 폼)면 제출 성공 후 창 자동 닫힘. shift+클릭(WindowLink)은
        // autoClose 없음 → false(그냥 새 창). spawnedBy=소스 창 id → autoClose로 닫힐 때 그 리스트 창도 reload
        // (최상위 router.refresh()는 배경만 갱신 = 소스 iframe엔 신규 항목이 stale로 남던 것 해소).
        st.open("route", {
          id: data.id,
          title: data.title ?? "보기",
          href: data.href,
          autoClose: data.autoClose === true,
          spawnedBy: sourceWinId,
        });
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!isDesktop) return null;

  // 드래그 중 레이아웃 바 호버 시 전체 배치 고스트(선택 슬롯 강조), 아니면 단일 스냅 프리뷰.
  // (스포트라이트 중엔 드래그/스냅 비활성이라 고스트 없음.)
  const layoutGhosts = !spotlight && dragLayout ? templateSlots(dragLayout.template, bounds) : null;
  const preview = !spotlight && !dragLayout && snapPreview ? snapTarget(snapPreview, bounds) : null;
  // DOM 순서는 삽입순(안정) 유지, 쌓임순서는 z-index로만 → 포커스/스냅 시 DOM 이동 0 → iframe 리로드 0.
  const wins = Object.values(windows);
  // 열린(비최소화) 창이 하나도 없으면 빈 데스크톱 안내를 띄운다.
  const hasOpenWindow = order.some((id) => !windows[id]?.minimized);

  return (
    <>
    <div
      // print:hidden — 배경 문서를 인쇄(계산기·시간표 Ctrl+P 등)할 때 열려 있는 플로팅 창·딤이
      // fixed로 매 페이지 위에 찍히는 것 방지(인쇄물은 문서만).
      className="pointer-events-none fixed z-40 print:hidden"
      style={{ left: rail, top: HEADER, right: 0, bottom: 0 }}
    >
      {/* 빈 데스크톱 바탕 — 뒤 라우트(메인 프레임)를 불투명하게 덮어 "아무것도 없는 바탕화면"으로 만든다.
          창들(z≥1) 뒤(z-0). pointer-events-auto로 덮인 라우트에 클릭이 새지 않게 흡수(빈 곳 클릭=무동작).
          창이 하나도 열려 있지 않으면 가운데 안내. 스포트라이트 중엔 아래 딤이 그 위를 덮는다. */}
      <div className="pointer-events-auto bg-background absolute inset-0 z-0" aria-hidden={hasOpenWindow}>
        {!hasOpenWindow && !spotlight ? (
          <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-2 p-8">
            <Image
              src="/empty-states/empty-workspace.png"
              alt=""
              width={240}
              height={240}
              loading="eager"
              className="mb-1 size-40 object-contain sm:size-44"
            />
            <div className="text-center">
              <p className="text-foreground text-[15px] font-semibold">열린 창이 없어요</p>
              <p className="text-text-dim mt-1 text-[13px]">왼쪽 메뉴를 눌러 창을 여세요.</p>
            </div>
          </div>
        ) : null}
      </div>
      {/* 앨범(스포트라이트) 딤 — 뒤 바탕을 흐려 앨범에 집중되게. 창들(z>=1) 뒤(z-0).
          빈 딤 영역 클릭 = 앨범 나가기(클릭 아웃). 캔버스는 pointer-events-none이라 이 막만 클릭 흡수. */}
      {spotlight ? (
        <div
          className="animate-in fade-in-0 pointer-events-auto absolute inset-0 z-0 bg-background/70 backdrop-blur-[2px] duration-200"
          onClick={() => exitSpotlight()}
          aria-hidden="true"
        />
      ) : null}
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
          <WindowSwitcher />
        </>
      )}
    </div>
    <WorkspaceOnboarding />
    </>
  );
}
