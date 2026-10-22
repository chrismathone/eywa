"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { fitToViewport } from "../placement";
import { clampMemoSize } from "../rules";
import { viewport } from "./cell-dom";

/**
 * 메모 상자 **크기 끌어 바꾸기**(원장 *"크기는 따로 움직이게"*) — 오른쪽 가장자리 · 아래 가장자리 · 오른쪽 아래 모서리.
 * 크기는 저장 범위(160~640 × 80~480)와 화면 안으로 자른다. 놓는 순간 `onDone`(메모마다 저장 — 다음에 열어도 그 크기).
 * 정보 카드와 묶이지 않는다 — 이 상자 크기만 바뀐다.
 */
export type ResizeAxis = "x" | "y" | "xy";

export function useBoxResize(
  initial: { width: number; height: number },
  getAt: () => { left: number; top: number },
  onDone: (size: { width: number; height: number }) => void,
) {
  const [size, setSize] = useState(initial);

  const start = (axis: ResizeAxis) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const from = size;
    let last = size;
    const move = (ev: PointerEvent) => {
      const raw = clampMemoSize(
        axis === "y" ? from.width : from.width + ev.clientX - x0,
        axis === "x" ? from.height : from.height + ev.clientY - y0,
      );
      const fit = fitToViewport(raw, getAt(), viewport());
      last = clampMemoSize(fit.width, fit.height);
      setSize(last);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (last.width !== from.width || last.height !== from.height) onDone(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return { size, start };
}
