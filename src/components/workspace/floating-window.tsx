"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SendToBack, Minus, Square, Copy, CopyPlus, X, ArrowLeft } from "lucide-react";
import { useWindowStore, isDuplicate, instanceLabel, type Win } from "./window-store";
import { usePointerDrag } from "./use-pointer-drag";
import { usePointerResize } from "./use-pointer-resize";
import { WindowContent } from "./window-content";
import { iframeRegistry } from "./route-window";
import { WINDOW_TRANSITION } from "./motion";
import { usePrefs } from "./use-prefs";
import { spotlightTop, type ResizeHandle } from "./window-geometry";

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
  // 배경 드롭 칩에 놓으면 타이틀바 "배경으로 보내기" 버튼과 동일 동작(라우트 창 한정, 함수 호이스팅).
  const drag = usePointerDrag(win.id, outerRef, () => handleSwapToBackground());
  const resize = usePointerResize(win.id, outerRef);
  const close = useWindowStore((s) => s.close);
  const minimize = useWindowStore((s) => s.minimize);
  const toggleMax = useWindowStore((s) => s.toggleMax);
  const focus = useWindowStore((s) => s.focus);
  const duplicate = useWindowStore((s) => s.duplicate);
  const swapToBackground = useWindowStore((s) => s.swapToBackground);
  const dragging = useWindowStore((s) => s.draggingId === win.id);
  const bounds = useWindowStore((s) => s.bounds);
  // 라이브 제목/뒤로가능(RouteWindow가 iframe 관찰로 갱신). 라우트 창은 현재 서브뷰 제목을 표시하고,
  // 드릴인했으면(canBack) 크롬 뒤로(←) 버튼을 띄운다 — 인페이지 "← …로" 백을 대체(Idea A).
  const live = useWindowStore((s) => s.live[win.id]);
  const router = useRouter();

  // 스포트라이트: 포커스 창은 상단 큰 영역(spotlightTop, store rect 불변→해제 시 글라이드 복원),
  // 비포커스 창은 숨김(마운트 유지=iframe 보존, 카드 클릭 swap 시 리로드 없음). 드래그/리사이즈 잠금.
  const spot = spotlight && focused;
  // 비포커스 스포트라이트 창: display:none(hidden) 대신 opacity로 가림 — 해제(X) 시 숨어있던
  // iframe 여러 개가 동시에 재레이아웃되며 생기던 렉 제거(레이아웃은 유지, 합성만 토글).
  const veiled = spotlight && !focused && !win.minimized;
  const rect = spot ? spotlightTop(bounds) : win.rect;

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

  // 배경으로 보내기: 이 창을 닫고 라우트를 배경 스택 맨 위(보이는 배경)로. 옛 배경은 스택에 남아
  // 하단/상단 배경 탭 스트립에서 다시 꺼낼 수 있다. (router.push로 메인 프레임 이동.)
  function handleSwapToBackground() {
    // 복제본(#n)은 배경 시스템(라우트↔배경 1:1)에 안 들어간다 — window-only.
    if (win.kind !== "route" || !win.params.href || isDuplicate(win.id)) return;
    const href = win.params.href;
    runExit(() => {
      router.push(href);
      swapToBackground(win.id);
    });
  }

  // 창을 닫을 때 부모(배경) 라우트를 새로고침 — 창(iframe)에서 한 저장/삭제가 별도 문서인 배경
  // 목록에 즉시 반영되게 한다(예: 직원 이름 수정 후 닫으면 배경 카드도 바로 갱신).
  function closeAndRefresh() {
    close(win.id);
    if (win.kind === "route") router.refresh();
  }

  // 최소화는 언마운트하지 않고 숨김(display:none) — iframe 문서/스크롤 상태 보존(진짜 멀티태스킹).
  return (
    <div
      ref={outerRef}
      className={`pointer-events-auto absolute top-0 left-0 ${dragging ? "will-change-transform" : ""} ${win.minimized ? "hidden" : ""}`}
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
        aria-modal={false}
        aria-label={win.params.title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") runExit(closeAndRefresh);
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
          className={`bg-bg-soft border-line flex h-9 shrink-0 touch-none items-center gap-2 border-b pr-1 pl-3 select-none ${spot ? "" : "cursor-grab active:cursor-grabbing"}`}
        >
          {win.kind === "route" && live?.canBack ? (
            // 드릴인 상태에서만 뒤로(←) 표시 — iframe 한 단계 뒤로. 루트(첫 화면)에선 표시 안 함
            // (닫기는 우상단 X가 담당, ← 닫기는 중복).
            <button
              type="button"
              aria-label="뒤로"
              title="뒤로"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              // 창별 nav 스택을 한 단계 pop → 그 창의 iframe만 직접 이전 URL로 이동(location.replace).
              // history.back()은 모든 iframe이 공유하는 joint session history를 되감아 엉뚱한 창이
              // 되감기던 버그가 있어 사용하지 않는다.
              onClick={() => {
                const target = useWindowStore.getState().backNav(win.id);
                if (target) iframeRegistry.get(win.id)?.contentWindow?.location.replace(target);
              }}
              className="text-text-dim hover:bg-line-strong/30 hover:text-foreground -ml-1 flex size-6 shrink-0 items-center justify-center rounded-[3px] transition"
            >
              <ArrowLeft size={14} strokeWidth={2} />
            </button>
          ) : null}
          <span className="text-foreground min-w-0 truncate text-[12px] font-semibold">{instanceLabel(win.id, live?.title ?? win.params.title)}</span>
          {win.params.subtitle ? <span className="text-text-faint min-w-0 truncate text-[11px]">{win.params.subtitle}</span> : null}
          <span className="flex-1" />

          {/* Windows식 창 컨트롤(우상단): 최소화 _ / 최대화·복원 □ / 닫기 ✕ */}
          <span
            className="flex shrink-0 items-center"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {win.kind === "route" && !spot ? (
              <button
                type="button"
                aria-label="창 복제"
                title="이 창 복제 (같은 화면 새 창)"
                onClick={() => duplicate(win.id)}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-[3px] transition"
              >
                <CopyPlus size={14} strokeWidth={2} />
              </button>
            ) : null}
            {win.kind === "route" && !spot && !isDuplicate(win.id) ? (
              <button
                type="button"
                aria-label="배경으로 보내기"
                title="배경으로 보내기"
                onClick={handleSwapToBackground}
                disabled={exiting}
                className="text-text-dim hover:bg-primary/15 hover:text-primary mr-0.5 flex h-7 w-9 items-center justify-center rounded-[3px] transition disabled:pointer-events-none disabled:opacity-40"
              >
                <SendToBack size={14} strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="최소화"
              title="최소화"
              onClick={() => runExit(() => minimize(win.id), true)}
              className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-[3px] transition"
            >
              <Minus size={15} strokeWidth={2} />
            </button>
            {!spot ? (
              <button
                type="button"
                aria-label={win.maximized ? "이전 크기로" : "최대화"}
                title={win.maximized ? "이전 크기로" : "최대화"}
                onClick={() => toggleMax(win.id)}
                className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-[3px] transition"
              >
                {win.maximized ? <Copy size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="닫기"
              title="닫기"
              onClick={() => runExit(closeAndRefresh)}
              className="text-text-dim hover:bg-danger flex h-7 w-9 items-center justify-center rounded-[3px] transition hover:text-white"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </span>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1">
          <WindowContent win={win} />
        </div>

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
