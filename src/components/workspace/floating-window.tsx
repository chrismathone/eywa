"use client";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { useWindowPresentation } from "@/features/owner/navigation-context";

import { useEffect, useRef, useState } from "react";
import { Minus, Square, Copy, CopyPlus, X, ArrowLeft, RotateCw, ChevronDown } from "@/components/icons/aywa-icon-compat";
import { useWindowStore, instanceLabel, type Win } from "./window-store";
import { useCloseWindow } from "./use-close-window";
import { usePointerDrag } from "./use-pointer-drag";
import { usePointerResize } from "./use-pointer-resize";
import { WindowContent } from "./window-content";
import { navigateWindow } from "./route-window";
import { WINDOW_TRANSITION } from "./motion";
import { usePrefs } from "./use-prefs";
import { spotlightTile, type ResizeHandle } from "./window-geometry";

const HANDLES: { h: ResizeHandle; cls: string }[] = [
  { h: "n", cls: "top-0 inset-x-3 h-1.5 cursor-n-resize" },
  { h: "s", cls: "bottom-0 inset-x-3 h-1.5 cursor-s-resize" },
  { h: "e", cls: "right-0 inset-y-3 w-1.5 cursor-e-resize" },
  { h: "w", cls: "left-0 inset-y-3 w-1.5 cursor-w-resize" },
  { h: "ne", cls: "top-0 right-0 size-3 cursor-ne-resize" },
  { h: "nw", cls: "top-0 left-0 size-3 cursor-nw-resize" },
  { h: "se", cls: "bottom-0 right-0 size-3 cursor-se-resize" },
  { h: "sw", cls: "bottom-0 left-0 size-3 cursor-sw-resize" },
];

export function FloatingWindow({
  win,
  focused,
  z,
  spotlight = false,
}: {
  win: Win;
  focused: boolean;
  z: number;
  spotlight?: boolean;
}) {
  // outerRef: 위치/크기(transform·width·height)를 드래그/리사이즈가 직접 갱신(리렌더 0)
  const outerRef = useRef<HTMLDivElement>(null);
  const drag = usePointerDrag(win.id, outerRef);
  const resize = usePointerResize(win.id, outerRef);
  const closeWindow = useCloseWindow();
  const minimize = useWindowStore((s) => s.minimize);
  const toggleMax = useWindowStore((s) => s.toggleMax);
  const focus = useWindowStore((s) => s.focus);
  const duplicate = useWindowStore((s) => s.duplicate);
  const reloadWindow = useWindowStore((s) => s.reloadWindow);
  const dragging = useWindowStore((s) => s.draggingId === win.id);
  const bounds = useWindowStore((s) => s.bounds);
  // 라이브 제목/뒤로가능(RouteWindow가 iframe 관찰로 갱신). 라우트 창은 현재 서브뷰 제목을 표시하고,
  // 드릴인했으면(canBack) 크롬 뒤로(←) 버튼을 띄운다 — 인페이지 "← …로" 백을 대체(Idea A).
  const live = useWindowStore((s) => s.live[win.id]);
  const currentHref = useWindowStore((s) => s.nav[win.id]?.at(-1));
  const present = useWindowPresentation();
  const display = present(win, currentHref, live?.title);

  // 녹음 등 "끊기면 유실" 작업이 이 창 안에서 진행 중이면 잠금 — 닫기(X)·새로고침·뒤로·Esc를 막아
  // 우발적 종료로 녹음을 날리지 않게 한다(use-recording-lock이 창 본문 iframe에서 부모에 postMessage →
  // RouteWindow가 **자기 iframe이 보낸 것만** store.busy에 싣는다). 하단 독의 ✕도 **같은 값**을 본다(닫기 게이트 단일 소스).
  const locked = useWindowStore((s) => s.busy[win.id] ?? false);

  // 미저장 변경(dirty) — 창 안 폼이 작성 중이면 닫기(X)·Esc 시 "정말 닫을까요?" 확인.
  // useUnsavedGuard(iframe)가 부모로 postMessage → workspace-canvas가 iframe→win.id 매칭 후 store에 세팅.
  const dirty = useWindowStore((s) => s.dirty[win.id] ?? false);
  const [confirmClose, setConfirmClose] = useState(false);

  // 스포트라이트: 상단에 올라온(spotlightRaised) 창들은 상단 영역에 가로 타일(spotlightTile, store rect
  // 불변→해제 시 글라이드 복원), 나머지는 숨김(마운트 유지=iframe 보존, 카드 클릭 raise 시 리로드 없음).
  const spotlightRaised = useWindowStore((s) => s.spotlightRaised);
  const lowerFromSpotlight = useWindowStore((s) => s.lowerFromSpotlight);
  const raisedIndex = spotlight ? spotlightRaised.indexOf(win.id) : -1;
  const spot = raisedIndex >= 0;
  // 상단에 안 올라온 스포트라이트 창: display:none(hidden) 대신 opacity로 가림 — 해제(X) 시 숨어있던
  // iframe 여러 개가 동시에 재레이아웃되며 생기던 렉 제거(레이아웃은 유지, 합성만 토글).
  const veiled = spotlight && raisedIndex < 0 && !win.minimized;
  const rect = spot ? spotlightTile(bounds, raisedIndex, spotlightRaised.length) : win.rect;

  const animationsOn = usePrefs((s) => s.animations);
  const animOff = !animationsOn;

  // 퇴장 애니메이션: 닫기/최소화/배경교체는 zoom-out 후(150ms) 실제 동작 실행. 모션 OFF면 즉시.
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);
  function runExit(commit: () => void, keepMounted = false) {
    if (animOff) {
      commit();
      return;
    }
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      commit();
      if (keepMounted) setExiting(false); // 최소화는 마운트 유지 → 복원 위해 상태 리셋
    }, 150);
  }

  // 닫기 = useCloseWindow 단일 경로(스토어 close + 라우트 창이면 배경 router.refresh()) — 창에서 한
  // 저장/삭제가 별도 문서인 배경 목록에 즉시 반영되게 한다(예: 직원 이름 수정 후 닫으면 배경 카드도 갱신).
  const closeAndRefresh = () => closeWindow(win.id);

  // 닫기 요청(X·Esc) — 미저장 변경이 있으면 즉시 닫지 않고 확인부터. 잠금(녹음) 중이면 애초에 막힘.
  function requestClose() {
    if (locked) return;
    if (confirmClose) {
      setConfirmClose(false); // 확인이 열린 상태서 Esc = 확인 취소(키보드로 되돌리기).
      return;
    }
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    runExit(closeAndRefresh);
  }

  // 최소화는 언마운트하지 않고 숨김(display:none) — iframe 문서/스크롤 상태 보존(진짜 멀티태스킹).
  return (
    <div
      ref={outerRef}
      className={`pointer-events-auto absolute top-0 left-0 ${dragging ? "will-change-transform" : ""} ${win.minimized ? "hidden" : ""}`}
      data-window-id={win.id}
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.w,
        height: rect.h,
        zIndex: z,
        opacity: veiled ? 0 : 1,
        pointerEvents: veiled ? "none" : undefined,
        // 드래그 중엔 transition 0(1:1 추종), 그 외 store rect 변경(스냅/배치/스포트라이트)은 글라이드.
        // opacity는 스포트라이트 가림/복귀 페이드(재레이아웃 없이 합성만 → 렉 없음).
        transition: dragging || animOff ? "none" : `${WINDOW_TRANSITION}, opacity 220ms ease`,
      }}
      onPointerDown={() => focus(win.id)}
    >
      <div
        role="dialog"
        data-window-dialog
        aria-modal={false}
        aria-label={display.title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !locked) requestClose();
        }}
        className={`bg-card relative flex h-full w-full flex-col overflow-hidden rounded-xl border ${
          animOff ? "" : `duration-150 ${exiting ? "animate-out fade-out-0 zoom-out-95" : "animate-in fade-in-0 zoom-in-95"}`
        } ${focused ? "border-primary/45 shadow-modal ring-primary/20 ring-2" : "border-line-strong shadow-card-hover"}`}
      >
        {/* 타이틀바 (드래그 핸들 — 스포트라이트 상단 창은 드래그/더블클릭 잠금) */}
        <div
          onPointerDown={spot ? undefined : drag.onPointerDown}
          onPointerMove={spot ? undefined : drag.onPointerMove}
          onPointerUp={spot ? undefined : drag.onPointerUp}
          // pointercancel(OS 제스처·캡처 detach 등) 시에도 onPointerUp으로 정리 — 안 하면 draggingId가
          // 남아 iframe이 visibility:hidden인 채 영구 stuck(#8).
          onPointerCancel={spot ? undefined : drag.onPointerUp}
          onDoubleClick={spot ? undefined : () => toggleMax(win.id)}
          className={`bg-bg-soft border-line relative flex h-9 shrink-0 touch-none items-center border-b px-1 select-none ${spot ? "" : "cursor-grab active:cursor-grabbing"}`}
        >
          {/* 좌측 그룹: 새로고침 · 복제 · 배경으로 (+ 드릴인 시 뒤로) — 콘텐츠/창 조작.
              그룹 span에서 stopPropagation → 버튼 클릭이 드래그/최대화로 안 샌다. */}
          <span
            className="flex shrink-0 items-center"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {win.kind === "route" && live?.canBack ? (
              // 드릴인 상태에서만 뒤로(←) — 그 창 iframe만 한 단계 이전 URL로(location.replace, joint history 회피).
              // 녹음 중엔 잠근다 — 옮기면 녹음이 끊긴다(⟳·✕와 같은 축, 리뷰 2026-09-11).
              <button
                type="button"
                aria-label="뒤로"
                title={locked ? "녹음 중 — 정지 후 가능" : "뒤로"}
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  const target = useWindowStore.getState().backNav(win.id);
                  // 기록에서 꺼낸 주소엔 embed=1이 없을 수 있다(창 안 이동이 떨어뜨림) — navigateWindow가 늘 붙인다.
                  if (target) navigateWindow(win.id, target);
                }}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-sm transition disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowLeft size={14} strokeWidth={1.8} />
              </button>
            ) : null}
            {win.kind === "route" ? (
              // 이 창 iframe만 새로고침(전체 F5보다 빠름). 녹음 중엔 잠금(reload=녹음 유실).
              <button
                type="button"
                aria-label="새로고침"
                title={locked ? "녹음 중 — 정지 후 가능" : "이 창만 새로고침"}
                onClick={() => { if (!locked) reloadWindow(win.id); }}
                disabled={locked}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-sm transition disabled:pointer-events-none disabled:opacity-40"
              >
                <RotateCw size={13} strokeWidth={1.8} />
              </button>
            ) : null}
            {win.kind === "route" && !spot ? (
              <button
                type="button"
                aria-label="창 복제"
                title="이 창 복제 (같은 화면 새 창)"
                onClick={() => duplicate(win.id)}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-sm transition"
              >
                <CopyPlus size={14} strokeWidth={1.8} />
              </button>
            ) : null}
          </span>

          {/* 정중앙: 창 이름 — 좌우 그룹 너비와 무관하게 바 한가운데 고정(absolute). 드래그 통과(pointer-events-none). */}
          <span className="pointer-events-none absolute inset-y-0 left-1/2 flex max-w-[46%] -translate-x-1/2 items-center justify-center gap-1.5">
            <span className="text-foreground truncate text-xs font-bold">{display.icon ? <MenuGlyph name={display.icon} size={16} className="mr-1.5 inline-block" /> : null}{instanceLabel(win.id, display.title)}</span>
            {win.params.subtitle ? <span className="text-text-faint shrink-0 truncate text-xs">{win.params.subtitle}</span> : null}
          </span>

          {/* 우측 그룹: 최소화 · 최대화 · 닫기 (Windows식 창 컨트롤) */}
          <span
            className="ml-auto flex shrink-0 items-center"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {spot && spotlightRaised.length > 1 ? (
              <button
                type="button"
                aria-label="스트립으로 내리기"
                title="앨범 스트립으로 내리기"
                onClick={() => lowerFromSpotlight(win.id)}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-sm transition"
              >
                <ChevronDown size={15} strokeWidth={1.8} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="최소화"
              title="최소화"
              onClick={() => runExit(() => minimize(win.id), true)}
              className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-sm transition"
            >
              <Minus size={15} strokeWidth={1.8} />
            </button>
            {!spot ? (
              <button
                type="button"
                aria-label={win.maximized ? "이전 크기로" : "최대화"}
                title={win.maximized ? "이전 크기로" : "최대화"}
                onClick={() => toggleMax(win.id)}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-sm transition"
              >
                {win.maximized ? <Copy size={13} strokeWidth={1.8} /> : <Square size={13} strokeWidth={1.8} />}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="닫기"
              title={locked ? "녹음 중 — 정지 후 닫기 가능" : "닫기"}
              onClick={requestClose}
              disabled={locked}
              className="text-text-dim hover:bg-danger flex h-7 w-9 items-center justify-center rounded-sm transition hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </span>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1">
          <WindowContent win={win} />
        </div>

        {/* 미저장 변경 상태에서 닫기 시도 시 확인 — 이 창 위 오버레이(작성 중 내용 유실 방지). */}
        {confirmClose ? (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-ink/40 p-4"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setConfirmClose(false);
            }}
          >
            <div className="bg-card border-line shadow-modal w-full max-w-xs rounded-xl border p-5">
              <p className="text-foreground text-sm font-bold">저장하지 않고 닫을까요?</p>
              <p className="text-text-dim mt-1.5 text-xs leading-relaxed">
                작성 중인 변경 내용이 있습니다. 닫으면 저장하지 않은 내용이 사라질 수 있어요.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmClose(false)}
                  className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground rounded-lg border px-3 py-1.5 text-xs font-medium transition"
                >
                  계속 작성
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmClose(false); runExit(closeAndRefresh); }}
                  className="bg-danger rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
                >
                  저장 안 함, 닫기
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 리사이즈가 그 창의 최소 크기에 닿았을 때만 보이는 힌트 — use-pointer-resize가 DOM으로 켠다(리렌더 0).
            원장 2026-09-03 "최소 크기보다 줄이려고 할 때 경고를 띄우고 줄어들지 않도록". */}
        <div
          data-min-hint
          hidden
          aria-live="polite"
          className="bg-foreground text-background pointer-events-none absolute right-2 bottom-2 z-20 rounded-md px-2 py-1 text-xs font-bold whitespace-nowrap"
        />

        {/* 8방향 리사이즈 핸들 (스포트라이트 상단 창은 잠금) */}
        {spot
          ? null
          : HANDLES.map(({ h, cls }) => (
              <div
                key={h}
                onPointerDown={resize.start(h)}
                onPointerMove={resize.onPointerMove}
                onPointerUp={resize.onPointerUp}
                onPointerCancel={resize.onPointerUp}
                className={`absolute z-10 touch-none ${cls}`}
              />
            ))}
      </div>
    </div>
  );
}
