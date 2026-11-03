"use client";

import { useEffect, useRef } from "react";
import { V } from "./engine";

type Draw = (w: number, h: number) => string;

/**
 * 차트 한 칸 — 칸의 실제 크기를 재서 그림을 그린다. 폭이 바뀌면 다시 그려서 글자·원이 늘어나지 않는다.
 * 값이 바뀌면(`draw`가 새 함수) 옛 모양에서 새 모양으로 이어서 움직인다. 값이 그대로면 아무 일도 없다.
 */
export function VizSlot({ draw, h, className = "" }: { draw: Draw; h: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(draw);

  useEffect(() => {
    latest.current = draw;
    if (ref.current) V.update(ref.current, draw);
  }, [draw]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const paint = (force: boolean) => V.paint(el, latest.current, force);
    let alive = true;
    void V.fontsReady().then(() => { if (alive) paint(true); });
    const resize = new ResizeObserver(() => paint(false));
    resize.observe(el);
    const entrance = new IntersectionObserver((items) => {
      if (!items.some((i) => i.isIntersecting)) return;
      entrance.disconnect();
      V.enter(el);
    }, { threshold: 0.2 });
    entrance.observe(el);
    return () => { alive = false; resize.disconnect(); entrance.disconnect(); };
  }, []);

  return <div ref={ref} className={`viz ${className}`} style={{ height: h }} />;
}
