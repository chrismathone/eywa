"use client";

import { useEffect, useRef, useState } from "react";
import { unitsOf } from "./attendance-data";

const STEP_MS = 4000;
const HOLD_MS = 5000;
const MIN_VISIBLE = 0.35;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * 자동 재생 장면(원장 2026-11-10 *"알아서 천천히 재생되는게 낫겠어 스크롤보다"* · *"판단해보고 … 분리해서 적용"*).
 * 시간 따라 일어나는 과정(상담 분석 · 학원 비서 · 출석부 채우기)은 스크롤에 묶지 않고 화면에 보이는 동안 저절로 흐른다 —
 * 한 단계 4초 · 끝에서 5초 머문 뒤 비우지 않고 바로 처음 단계로(Codex 협의 11-10). 구성을 쌓는 장면(창 네 개 · 선언문 · 쇼룸)은 스크롤 그대로(`LandingMotion`).
 * 대상 = `section[data-play]#<target>` — 서버가 그린 장면에 클래스만 붙였다 뗀다(`LandingMotion`이 스크롤로 하던 것과 같은 그림:
 * `.steps li` on/done · `.dots i` on · `.ln`·`.win` show · 출석부 칸·시수 합계·memo/final). `LandingMotion`은 `[data-play]`를 안 건드린다.
 * 화면 밖·다른 탭·'자동 재생 멈춤'이면 멈춘다. 움직임 줄이기면 아무것도 안 한다(CSS·`LandingMotion`이 최종 모습을 펼친다).
 */
export function ScenePlayer({ target }: { target: string }) {
  const [paused, setPaused] = useState(false);
  const ctl = useRef<((p: boolean) => void) | null>(null);

  useEffect(() => {
    const root = document.getElementById(target);
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const q = <T extends HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
    const steps = Number(root.dataset.steps) || 1;
    const li = q(".steps li");
    const dots = q(".dots i");
    const shows = q(".ln, .win");
    const att = root.querySelector<HTMLElement>("#att");
    const cells = q("#attTable td.c").sort((a, b) => Number(a.dataset.o) - Number(b.dataset.o));
    const sums = q("#attTable td.sum");
    const total = steps * STEP_MS;
    const cycle = total + HOLD_MS;
    let t = 0;
    let last = 0;
    let raf = 0;
    let painted = "";
    let visible = false;
    let userPaused = false;

    const paint = (prog: number) => {
      const s = prog < 0 ? -1 : Math.min(steps - 1, Math.floor(prog * steps));
      const k = prog < 0 ? 0 : Math.round(clamp(prog / 0.72, 0, 1) * cells.length);
      const key = `${s}:${k}`;
      if (key === painted) return;
      painted = key;
      li.forEach((l) => { const i = Number(l.dataset.i); l.classList.toggle("on", i === s); l.classList.toggle("done", s >= 0 && i < s); });
      dots.forEach((d, i) => d.classList.toggle("on", i === s));
      shows.forEach((l) => { const i = Number(l.dataset.i); l.classList.toggle("show", i <= s); l.classList.toggle("top", i === s); });
      if (!att) return;
      att.classList.toggle("memo", s === 2);
      att.classList.toggle("final", s === 3);
      const byRow = sums.map(() => 0);
      cells.forEach((c, i) => {
        const on = i < k;
        c.classList.toggle("on", on);
        if (on) byRow[Number(c.dataset.o) % 10] += unitsOf(c.querySelector("span")?.textContent ?? "");
      });
      sums.forEach((e, i) => { e.textContent = String(byRow[i]); });
    };
    const at = (tc: number) => (tc < total ? tc / total : 1);
    const running = () => visible && !userPaused && !document.hidden;
    const frame = (now: number) => {
      raf = 0;
      if (!running()) { last = 0; return; }
      if (last) t += now - last;
      last = now;
      paint(at(t % cycle));
      raf = window.requestAnimationFrame(frame);
    };
    const resume = () => { if (!raf && running()) { last = 0; raf = window.requestAnimationFrame(frame); } };
    const stop = () => { if (raf) window.cancelAnimationFrame(raf); raf = 0; last = 0; };

    paint(0);
    // isIntersecting은 조금만 걸쳐도 참이다 — 장면이 35% 넘게 보이거나(Codex 지적), 장면이 화면보다 길면 화면의 절반을 채울 때 재생
    // (확대 200%·가로 폰처럼 장면이 화면 높이 ÷ 0.35보다 길면 비율이 영영 0.35에 못 닿는다). 한꺼번에 온 기록은 마지막 것만 본다.
    const io = new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      const rootH = e.rootBounds?.height ?? window.innerHeight;
      visible = e.intersectionRatio >= MIN_VISIBLE || e.intersectionRect.height >= rootH * 0.5;
      if (visible) resume(); else stop();
    }, { threshold: [0, 0.1, 0.2, MIN_VISIBLE, 0.5, 0.75, 1] });
    io.observe(root);
    const onVis = () => { if (document.hidden) stop(); else resume(); };
    document.addEventListener("visibilitychange", onVis);
    ctl.current = (p) => { userPaused = p; if (p) stop(); else resume(); };
    return () => { stop(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); ctl.current = null; };
  }, [target]);

  const toggle = () => { const p = !paused; setPaused(p); ctl.current?.(p); };
  return (
    <button type="button" className="strip-toggle" aria-controls={target} aria-pressed={paused} onClick={toggle}>
      자동 재생 멈춤
    </button>
  );
}
