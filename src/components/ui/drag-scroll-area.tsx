"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 태블릿식 "잡고 끌기" 스크롤 영역 — 마우스로 빈 곳을 끌면 내용이 따라 움직이고(가로·세로 모두),
 * 놓으면 관성으로 부드럽게 미끄러진다. 넘치는 가장자리엔 페이드로 "더 있음"을 표시.
 *
 * 왜 래퍼가 두 겹인가: 페이드는 스크롤되지 않는 부모(바깥 div)에 절대배치해야
 * 스크롤과 함께 밀려나지 않는다. 안쪽 div가 실제 스크롤 컨테이너(overflow-auto).
 *
 * 충돌 회피:
 *  - 터치는 네이티브 스크롤에 맡김(pointerType==="touch" 무시).
 *  - dnd-kit draggable(aria-roledescription="draggable")·폼 컨트롤 위 pointerdown은 팬 시작 안 함.
 *  - 5px 임계값 전엔 클릭으로 취급 → 카드 "탭=열기 / 끌기=팬" 구분. 실제 끌었으면 뒤따르는 click 1회 차단.
 *
 * 사용: 기존 `<div className="... overflow-auto ...">{표}</div>` 를
 *       `<DragScrollArea className="... (overflow-auto 빼고)">{표}</DragScrollArea>` 로 교체.
 */
export function DragScrollArea({
  children,
  className = "",
  fade = true,
  momentum = true,
  barX = false,
}: {
  children: ReactNode;
  className?: string;
  /** 넘치는 가장자리 페이드 표시(기본 true) */
  fade?: boolean;
  /** 놓을 때 관성 글라이드(기본 true) */
  momentum?: boolean;
  /** 가로 스크롤바를 항상·또렷하게 노출(overflow-x:scroll + 굵은 thumb). 항상 넓은 표(시간표)용. */
  barX?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false, top: false, bottom: false });
  const [grabbable, setGrabbable] = useState(false);

  // 넘침/가장자리 상태(페이드·커서용) — 스크롤·리사이즈 시 갱신
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const maxX = el.scrollWidth - el.clientWidth;
      const maxY = el.scrollHeight - el.clientHeight;
      setGrabbable(maxX > 1 || maxY > 1);
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft < maxX - 1,
        top: el.scrollTop > 1,
        bottom: el.scrollTop < maxY - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // 드래그-팬 + 관성
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down = false;
    let dragging = false;
    let pid = -1;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let vx = 0;
    let vy = 0;
    let raf = 0;

    const stopMomentum = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const skip = (t: EventTarget | null) =>
      t instanceof Element &&
      !!t.closest(
        'input,textarea,select,option,[contenteditable=""],[contenteditable="true"],[aria-roledescription="draggable"],[data-no-drag-scroll]',
      );

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      if (skip(e.target)) return;
      const canX = el.scrollWidth - el.clientWidth > 1;
      const canY = el.scrollHeight - el.clientHeight > 1;
      if (!canX && !canY) return;
      down = true;
      dragging = false;
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
      vx = 0;
      vy = 0;
      stopMomentum();
    };

    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // 임계값 전 = 클릭
        dragging = true;
        try {
          el.setPointerCapture(pid);
        } catch {
          /* capture 실패 무시 */
        }
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      el.scrollLeft = startLeft - dx;
      el.scrollTop = startTop - dy;
      const dt = e.timeStamp - lastT || 16;
      vx = (e.clientX - lastX) / dt;
      vy = (e.clientY - lastY) / dt;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
    };

    const onUp = () => {
      if (!down) return;
      down = false;
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* noop */
      }
      el.style.cursor = "";
      el.style.userSelect = "";
      // 실제로 끌었으면 뒤따라오는 click 1회를 삼켜 카드/링크 오작동 방지
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, true), 0);
      if (momentum && (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05)) {
        const step = () => {
          vx *= 0.92;
          vy *= 0.92;
          el.scrollLeft -= vx * 16;
          el.scrollTop -= vy * 16;
          if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) {
            raf = 0;
            return;
          }
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopMomentum();
    };
  }, [momentum]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        ref={ref}
        className={`h-full w-full overscroll-contain rounded-[inherit] ${
          barX ? "scroll-x-always overflow-y-auto" : "overflow-auto"
        } ${grabbable ? "cursor-grab" : ""}`}
      >
        {children}
      </div>
      {fade ? (
        <>
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-foreground/12 to-transparent transition-opacity duration-200 ${
              edges.left ? "opacity-100" : "opacity-0"
            }`}
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-foreground/12 to-transparent transition-opacity duration-200 ${
              edges.right ? "opacity-100" : "opacity-0"
            }`}
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-foreground/10 to-transparent transition-opacity duration-200 ${
              edges.top ? "opacity-100" : "opacity-0"
            }`}
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-foreground/10 to-transparent transition-opacity duration-200 ${
              edges.bottom ? "opacity-100" : "opacity-0"
            }`}
          />
        </>
      ) : null}
    </div>
  );
}
