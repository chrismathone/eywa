"use client";

import { useEffect, useRef } from "react";
import { V } from "./engine";

type Draw = (w: number, h: number) => string;
type Job = { kind: "paint" | "update"; force: boolean };

/**
 * 그리기 줄 — 칸마다 바로 그리면 칸마다 크기를 재고(레이아웃) 곧바로 그림을 바꿔(무효화) 다음 칸이 또 레이아웃을 한다.
 * 보기 전환으로 차트 수십 개가 한꺼번에 서면 그 왕복이 1초 가까이 걸렸다(2026-11-09 실측 — 오늘 운영 1,038ms).
 * 그래서 한 프레임에 모아 **먼저 전부 재고 → 그다음 전부 그린다**(레이아웃 한 번).
 */
const queue = new Map<HTMLElement, { job: Job; draw: () => Draw }>();
let scheduled = false;
function flush() {
  scheduled = false;
  const jobs = [...queue];
  queue.clear();
  const sizes = jobs.map(([el]) => [el.clientWidth, el.clientHeight] as const);
  jobs.forEach(([el, { job, draw }], i) => {
    if (!el.isConnected) return;
    if (job.kind === "update") V.update(el, draw(), sizes[i]);
    else V.paint(el, draw(), job.force, sizes[i]);
  });
}
function schedule(el: HTMLElement, job: Job, draw: () => Draw) {
  const prev = queue.get(el)?.job;
  // 같은 칸이 한 프레임에 여러 번 오면 가장 센 일 하나로(값 바뀜 > 강제 다시 그리기 > 크기 확인).
  const kind = prev?.kind === "update" || job.kind === "update" ? "update" : "paint";
  queue.set(el, { job: { kind, force: !!prev?.force || job.force }, draw });
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

/** 차트 글꼴이 이미 받아져 있으면 글꼴을 기다린 두 번째 그리기를 하지 않는다(`V.fontsReady`가 기다리는 것과 같은 글꼴). */
const fontReadyNow = () => {
  try { return document.fonts.check(`500 13px ${V.fontFamily()}`); } catch { return false; }
};

/**
 * 차트 한 칸 — 칸의 실제 크기를 재서 그림을 그린다. 폭이 바뀌면 다시 그려서 글자·원이 늘어나지 않는다.
 * 값이 바뀌면(`draw`가 새 함수) 옛 모양에서 새 모양으로 이어서 움직인다. 값이 그대로면 아무 일도 없다.
 * 숨은 칸(보기 전환으로 감춘 보기)은 크기가 0이라 그리지 않고, 다시 보일 때 크기가 같으면 그대로 둔다.
 */
export function VizSlot({ draw, h, className = "" }: { draw: Draw; h: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(draw);
  const mounted = useRef(false);

  useEffect(() => {
    latest.current = draw;
    const el = ref.current;
    // 처음 설 때는 아래 effect가 한 번 그린다 — 여기서 또 그리지 않는다.
    if (el && mounted.current) schedule(el, { kind: "update", force: false }, () => latest.current);
  }, [draw]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mounted.current = true;
    let alive = true;
    schedule(el, { kind: "paint", force: true }, () => latest.current);
    if (!fontReadyNow()) void V.fontsReady().then(() => { if (alive) schedule(el, { kind: "paint", force: true }, () => latest.current); });
    // 크기가 그대로면 V.paint가 아무것도 안 한다(처음 알림 · 숨겼다 다시 보인 보기).
    const resize = new ResizeObserver(() => schedule(el, { kind: "paint", force: false }, () => latest.current));
    resize.observe(el);
    const entrance = new IntersectionObserver((items) => {
      if (!items.some((i) => i.isIntersecting)) return;
      entrance.disconnect();
      V.enter(el);
    }, { threshold: 0.2 });
    entrance.observe(el);
    return () => { alive = false; mounted.current = false; queue.delete(el); resize.disconnect(); entrance.disconnect(); };
  }, []);

  return <div ref={ref} className={`viz ${className}`} style={{ height: h }} />;
}
