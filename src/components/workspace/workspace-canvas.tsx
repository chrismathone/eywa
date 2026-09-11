"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { subscribeWindowBusy } from "@/lib/realtime/window-busy";
import { useWindowStore } from "./window-store";
import { usePrefs } from "./use-prefs";
import { railWidth } from "./use-sidebar-resize";
import { useIsDesktop } from "./use-is-desktop";
import { FloatingWindow } from "./floating-window";
import { iframeRegistry } from "./route-window";
import { WindowSwitcher } from "./window-switcher";
import { SnapAssist } from "./snap-assist";
import { SnapLayoutsBar } from "./snap-layouts-bar";
import { SpotlightStrip } from "./spotlight-strip";
import { WorkspaceOnboarding } from "./workspace-onboarding";
import { useEmptyWorkspaceHome } from "./use-empty-workspace-home";
import { useDeepLinkWindow } from "./deep-link-window";
import { snapTarget, templateSlots } from "./window-geometry";

// 콘텐츠 스테이지 상단 오프셋 — 데스크톱(캔버스가 뜨는 유일한 조건: useIsDesktop = ≥lg + pointer:fine)에선
// 데스크톱엔 상단탭이 없다(2026-07-20 상단 헤더 폐지 → 2026-07-30 모바일 헤더도 MobileTopNav로 흡수). 따라서 0 —
// 최대화·스냅 창이 화면 최상단까지 덮는다. (이 값이 48이던 시절엔 그 48px 띠로 운영실 배경이 비쳐, 최대화해도
// 위가 안 덮이는 문제가 있었음.) 좌측 레일은 사이드바 실제 너비를 런타임 계산(아래 rail).
const HEADER = 0;

/**
 * Stage Manager 캔버스 — 현재 라우트의 콘텐츠 영역 위에 뜨는 fixed 오버레이
 * (pointer-events:none, 창·스위처만 이벤트 수신 → 빈 공간은 아래 페이지로 클릭 통과).
 * 데스크톱 전용. 자식은 absolute라 스테이지(레일/헤더 제외) 안에 갇힌다.
 * owner=`tenantId:userId` — 복원 레이아웃이 다른 계정 것이면 store가 초기화(메타 누수 방지).
 */
export function WorkspaceCanvas({ owner, homeHref = "/dashboard" }: { owner: string; homeHref?: string }) {
  const isDesktop = useIsDesktop();
  const pathname = usePathname();
  // 대시보드가 작업 배경이다. /menu는 접근 제한 계정의 안내 화면만 남긴다.
  const isDesktopSurface = pathname === "/dashboard" || pathname === "/menu";
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

  // 일반 라우트를 직접 연 데스크톱에선 스테이지가 main을 덮으므로 이중 스크롤을 막는다. 반면 오늘
  //(`/dashboard`)은 main 자체가 AI 운영실 데스크톱 작업면이다. 이때는 캔버스가 떠 있어도 main을 가리거나
  // 스크롤을 잠그면 안 된다. 모바일·미니셸·iframe 또한 main이 유일한 스크롤이므로 잠그지 않는다.
  useEffect(() => {
    const root = document.documentElement;
    if (!isDesktop || isDesktopSurface) {
      delete root.dataset.stage;
      return;
    }
    root.dataset.stage = "on";
    return () => {
      delete root.dataset.stage;
    };
  }, [isDesktop, isDesktopSurface]);

  // 사이드바 실제 너비 = 펼침이면 저장 너비, 접힘이면 레일(52). 펼침/접힘·드래그 드롭으로 바뀌면
  // 스테이지가 따라가 창 최대치(최대화·스냅)가 사이드바 오른쪽에 정확히 맞는다.
  const sidebarExpanded = usePrefs((s) => s.sidebarExpanded);
  const rail = railWidth(sidebarExpanded);

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

  // 딥링크(주소창·외부 링크·북마크)로 들어온 라우트를 창으로 열어 준다(원장 지시 2026-09-01).
  // 조건은 **아래 바탕이 main을 덮는 조건과 같다** — 안 덮는 화면(운영실)에서 열면 배경과 겹친다.
  // ⚠️ adoptOwner(영속 복원·계정 채택) **뒤**에 두는 것이 중요하다 — 먼저 열면 다른 계정의 레이아웃을
  //    지우는 초기화가 방금 연 창까지 함께 쓸어간다(효과·하이드레이션 리스너 둘 다 선언 순서로 돈다).
  useDeepLinkWindow(isDesktop && !isDesktopSurface);
  useEmptyWorkspaceHome(isDesktop && !isDesktopSurface, homeHref);

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
      // 잠금은 store에도 옮겨 담는다 — 창 자체 X(FloatingWindow)와 하단 독의 ✕(WindowSwitcher)가
      // 같은 값을 보게 하는 단일 소스(구독을 화면마다 따로 두면 마운트 시점이 늦은 쪽은 진행 중인
      // 녹음을 모른 채 창을 닫아버린다 — 독은 스포트라이트 진입/해제로 실제로 재마운트된다).
      useWindowStore.getState().setWindowBusy(m.winId, m.active);
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
      if (data.type === "eywa-window-maximize") {
        // 창 안 '최소 크기 위반' 안내의 [창 최대화](WindowMinSizeNotice). 이미 최대화면 토글이 되돌리므로 건너뛴다.
        if (!st.windows[sourceWinId]?.maximized) st.toggleMax(sourceWinId);
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

  return (
    <>
    <div
      // print:hidden — 배경 문서를 인쇄(계산기·시간표 Ctrl+P 등)할 때 열려 있는 플로팅 창·딤이
      // fixed로 매 페이지 위에 찍히는 것 방지(인쇄물은 문서만).
      className="pointer-events-none fixed z-40 print:hidden"
      style={{ left: rail, top: HEADER, right: 0, bottom: 0 }}
    >
      {/* 직접 연 업무 페이지는 창에 표시한다. 마지막 창을 닫으면 대시보드로 이동한다. */}
      {!isDesktopSurface ? (
        <div className="pointer-events-auto bg-background absolute inset-0 z-0" aria-hidden="true" />
      ) : null}
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
