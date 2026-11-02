"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { subscribeWindowBusy } from "@/lib/realtime/window-busy";
import { useWindowStore } from "./window-store";
import { usePrefs } from "./use-prefs";
import { railWidth } from "./use-sidebar-resize";
import { useWindowMode } from "./use-window-mode";
import { useShellMode, useShellModeEpoch } from "./shell-mode";
import { KeepaliveStage } from "./keepalive-stage";
import { useKeepaliveFollow } from "./use-keepalive-follow";
import { FloatingWindow } from "./floating-window";
import { iframeRegistry } from "./route-window";
import { openLinkWindow } from "./open-menu-window";
import { noteDirtyOwner } from "./window-signals-core";
import { isFromCurrentDocument, WINDOW_DIRTY_MESSAGE } from "./window-bridge";
import { WindowSwitcher } from "./window-switcher";
import { SnapAssist } from "./snap-assist";
import { SnapLayoutsBar } from "./snap-layouts-bar";
import { SpotlightStrip } from "./spotlight-strip";
import { WorkspaceOnboarding } from "./workspace-onboarding";
import { useEmptyWorkspaceHome } from "./use-empty-workspace-home";
import { useDeepLinkWindow } from "./deep-link-window";
import { snapTarget, templateSlots } from "./window-geometry";

// 콘텐츠 스테이지 상단 오프셋 — 데스크톱(캔버스가 뜨는 유일한 조건: useIsDesktop = ≥1240 + any-pointer:fine)에선
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
  // 창 모드가 꺼진 지점(또는 미니셸)에선 캔버스가 없다 — 본문(<main>)이 모바일처럼 유일한 화면이 된다.
  const isDesktop = useWindowMode();
  // 단일 화면(이전 화면 유지) 방식 — 같은 창 엔진을 쓰되 창 크롬 없이 한 화면씩 그린다(원장 2026-10-01). 아래 분기 몇 곳만 다르다.
  const shellMode = useShellMode();
  const shellEpoch = useShellModeEpoch();
  const keepalive = isDesktop && shellMode === "keepalive";
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
    // 🔴 지점 방식(`shellMode`)과 그 판(`shellEpoch`)도 함께 채택한다 — 영속본이 다른 방식·다른 판으로 쌓은 것이면 전부 닫고 빈 상태로
    //    시작(원장 2026-10-01 "창모드 전환 시에 이전의 창 모드들은 모두 종료시킨 채로"). 이 효과는 창 모드를 끈 지점·폰에서도 돈다(캔버스는
    //    늘 마운트) — 그래서 어느 방향 전환이든 잡힌다. 판을 모르면(라이선스 조회 실패 — 이 요청은 fail-open 창 모드) 방식은 채택하지 않는다
    //    (일시 장애 한 번에 유지 화면이 지워지지 않게 — 계정만 본다).
    const adopt = () => (shellEpoch === null ? adoptOwner(owner) : adoptOwner(owner, shellMode, shellEpoch));
    if (useWindowStore.persist.hasHydrated()) {
      adopt();
      return;
    }
    const unsub = useWindowStore.persist.onFinishHydration(adopt);
    return unsub;
  }, [owner, shellMode, shellEpoch, adoptOwner]);

  // 딥링크(주소창·외부 링크·북마크)로 들어온 라우트를 창으로 열어 준다(원장 지시 2026-09-01).
  // 조건은 **아래 바탕이 main을 덮는 조건과 같다** — 안 덮는 화면(운영실)에서 열면 배경과 겹친다.
  // ⚠️ adoptOwner(영속 복원·계정 채택) **뒤**에 두는 것이 중요하다 — 먼저 열면 다른 계정의 레이아웃을
  //    지우는 초기화가 방금 연 창까지 함께 쓸어간다(효과·하이드레이션 리스너 둘 다 선언 순서로 돈다).
  // 🔴 이전 화면 유지 방식은 이 둘 대신 `useKeepaliveFollow`가 주소와 화면을 양방향으로 맞춘다(딥링크도 거기서 연다).
  // 스토어 규칙(복제 금지·사용 도장)이 볼 '지금 그려진 방식' — 영속본의 방식과 갈릴 수 있다(라이선스 조회 실패로 이 요청만 창 모드).
  useEffect(() => {
    if (useWindowStore.getState().kaActive !== keepalive) useWindowStore.setState({ kaActive: keepalive });
  }, [keepalive]);
  useDeepLinkWindow(isDesktop && !isDesktopSurface && !keepalive);
  useEmptyWorkspaceHome(isDesktop && !isDesktopSurface && !keepalive, homeHref);
  useKeepaliveFollow(keepalive, homeHref);

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
      // ⚠️ 여기서는 **개수만** 센다 — 창 잠금(store.busy)은 RouteWindow가 자기 iframe의 신호로 정확한 창 id에 건다.
      //    이 방송의 id는 경로로 추측한 것이라(상세 창 안에서 수정으로 들어가면 없는 창 id) 잠금에 쓰면 유령 잠금이
      //    남았다 — 녹음 중에 그 id의 창을 새로 열면 영문 모르게 닫기가 막혔다(전수검사 2026-09-11 후속).
      //    방송은 탭을 넘나들므로 다른 탭의 녹음도 이 탭의 새로고침을 막는다(종전 그대로).
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
        /** 미저장 메시지를 보낸 문서의 표지(performance.timeOrigin). */
        doc?: number;
        /** 창 안 Shift+클릭(WindowLink) — 같은 화면을 새 창으로 한 벌 더. */
        newInstance?: boolean;
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
        // 이전 화면 유지: 화면 안 클릭 = 사용 중 — 2시간 만료 기준(keepalive-rules). 판정은 **지금 그려진 방식**(kaActive — 위 효과가 맞춘다).
        if (st.kaActive) st.applyKeepalive(Date.now(), { touch: sourceWinId });
        return;
      }
      if (data.type === "eywa-activity") {
        // 이전 화면 유지 화면의 입력·스크롤 신호(KeepaliveFrameBridge) — 클릭 없이 읽고 치는 사용도 '사용 중'이다.
        if (st.kaActive) st.applyKeepalive(Date.now(), { touch: sourceWinId });
        return;
      }
      if (data.type === WINDOW_DIRTY_MESSAGE) {
        // 떠난 문서가 늦게 보낸 메시지는 버린다(window-bridge `windowDirtyMessage`) — 새 문서를 거짓 주인으로 적지 않게.
        if (!isFromCurrentDocument(iframeRegistry.get(sourceWinId)?.contentWindow, data.doc)) return;
        // 창 본문 폼의 미저장 변경 여부(useUnsavedGuard) → 그 창 id로 저장. FloatingWindow가 X/Esc 확인에 사용.
        st.setWindowDirty(sourceWinId, data.dirty === true);
        // 표식의 주인 = 지금 그 창에 붙은 문서 — 새 문서가 뜰 때 "떠난 문서의 표식"만 내리게(window-signals-core).
        let ownerDoc: Document | null = null;
        try {
          ownerDoc = data.dirty === true ? (iframeRegistry.get(sourceWinId)?.contentDocument ?? null) : null;
        } catch {
          /* 접근 불가 — 주인 모름(종전 동작) */
        }
        noteDirtyOwner(sourceWinId, ownerDoc);
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
        const params = {
          id: data.id,
          title: data.title ?? "보기",
          href: data.href,
          autoClose: data.autoClose === true,
          spawnedBy: sourceWinId,
        };
        // 창 안 Shift+클릭(`newInstance`) = 최상위 Shift+클릭과 같은 뜻 — 같은 화면을 새 창으로 한 벌 더.
        // 종전엔 open()이라 이미 떠 있는 그 창이 그 주소로 옮겨져 보던 자리를 잃었다(2026-09-11 리뷰).
        // "새 X" 작성 폼(autoClose)은 그 메뉴의 작성 창이 전부 녹음 중이면 새 작성 창을 한 벌 더(openForm — 원장 2026-10-16).
        if (data.newInstance === true) st.openNewInstance("route", params);
        else if (params.autoClose) st.openForm("route", params);
        else openLinkWindow(params);
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!isDesktop) return null;

  // 이전 화면 유지 — 창 크롬·스냅·앨범·하단 독 없이 화면 가득. 바탕 가림막(바탕이 작업면이 아닐 때)만 창 모드와 같다.
  if (keepalive) {
    return (
      <div className="pointer-events-none fixed inset-0 z-40 print:hidden" data-usage-chrome="">
        {!isDesktopSurface ? <div className="pointer-events-auto bg-background absolute inset-0 z-0" aria-hidden="true" /> : null}
        <KeepaliveStage />
      </div>
    );
  }

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
      // data-usage-chrome — 창 테두리·제목줄·작업 표시 입력은 배경 화면의 활동이 아니다(이용 분석,
      // features/usage/session.ts). 창 **본문**은 iframe이라 원래 이 문서로 안 온다.
      data-usage-chrome=""
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
