"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  mpPrintFit,
  mpPrintFitCaption,
  mpPrintPageCss,
} from "@/features/class-sheets/lib/month-plan-print-fit";

/**
 * 월간 계획서 인쇄물을 **A4 한 장에 맞춰 줄이는** 껍데기(원장 2026-09-21 *"인쇄도 한페이지에 딱 들어오게"*).
 * 규칙(배율·방향·여백)은 [`month-plan-print-fit`](@/features/class-sheets/lib/month-plan-print-fit.ts) 한 곳이다.
 *
 * 🔑 **화면도 같은 배율로 보여 준다** — 창에서 보는 미리보기가 곧 종이다(WYSIWYG). 그전엔 화면에선
 *    금요일이 창 밖으로, 종이에선 둘째 장으로 넘어갔다.
 * 🔑 크기는 **그려진 문서를 재서** 정한다 — 꼬리말은 반마다 줄 수가 달라 계산으로는 못 맞춘다.
 * 🔴 React state를 쓰지 않고 DOM에 직접 쓴다 — `beforeprint`에서 고친 값이 인쇄 전에 반드시 반영돼야
 *    하는데, state는 다음 렌더까지 미뤄질 수 있다(그러면 옛 배율·옛 방향으로 찍힌다). 이 컴포넌트는
 *    다시 렌더될 일이 없어(props가 서버에서 한 번 온다) 직접 쓴 값이 덮이지 않는다.
 * ⚠️ `zoom`을 쓴다(`transform: scale`이 아니다) — transform은 레이아웃 상자를 안 줄여서 브라우저가 원래
 *    크기로 쪽을 나눈다(= 빈 둘째 장). zoom은 크롬·엣지·웨일·사파리·파이어폭스(126+)가 인쇄에도 적용한다.
 */
export function MpFitToPage({ children }: { children: ReactNode }) {
  const zoomRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLStyleElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const box = zoomRef.current;
      const doc = docRef.current;
      if (!box || !doc) return;
      // 원래 크기로 되돌린 뒤 잰다 — 줄인 채로 재면 이미 줄어든 값을 또 줄인다.
      const prev = box.style.zoom;
      box.style.zoom = "1";
      const width = doc.offsetWidth;
      const height = doc.offsetHeight;
      // ⚠️ 창이 가려진 채(최소화 = display:none, [[#131]]) 열리면 크기가 0이다 — 그때 "100%"를 적으면 거짓이다.
      //    아무것도 바꾸지 않고, 보이게 되는 순간(아래 ResizeObserver) 다시 잰다.
      if (width === 0 || height === 0) {
        box.style.zoom = prev;
        return;
      }
      const fit = mpPrintFit({ width, height });
      box.style.zoom = String(fit.zoom);
      if (pageRef.current) pageRef.current.textContent = mpPrintPageCss(fit.orientation);
      if (noteRef.current) noteRef.current.textContent = mpPrintFitCaption(fit);
    };
    measure();
    // 가려져 있던 창이 보이게 되면(0 → 실제 크기) 다시 잰다.
    // ⚠️ 콜백 안에서 바로 재지 않고 **다음 프레임으로 미룬다** — 줄인 조상 아래에선 관찰 크기가 서브픽셀로
    //    흔들려(1302 → 1301.98), 콜백 안에서 zoom을 바꾸면 "ResizeObserver loop completed…" 오류가 한 번씩 난다
    //    (적대적 재리뷰 2026-09-21 실측). 같은 크기면 같은 배율을 쓰므로 고리는 한 번에 멈춘다.
    let frame = 0;
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
          });
    if (ro && docRef.current) ro.observe(docRef.current);
    // 글꼴이 늦게 오면 꼬리말 줄바꿈이 달라져 높이가 바뀐다 — 한 번 더 잰다.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    // 인쇄 직전에도 다시 잰다(창 크기가 바뀌어 꼬리말이 다시 접혔을 수 있다).
    window.addEventListener("beforeprint", measure);
    return () => {
      alive = false;
      ro?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("beforeprint", measure);
    };
  }, []);

  return (
    <>
      <style ref={pageRef}>{mpPrintPageCss("landscape")}</style>
      <p ref={noteRef} className="text-text-dim mb-2 text-xs print:hidden" aria-live="polite" />
      <div ref={zoomRef}>
        <div ref={docRef} className="mx-auto w-fit">
          {children}
        </div>
      </div>
    </>
  );
}
