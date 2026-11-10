"use client";

import { useEffect } from "react";
import { unitsOf } from "./attendance-data";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const all = <T extends Element>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));

type Pin = {
  el: HTMLElement; steps: number; scene: string; last: number;
  li: HTMLElement[]; dots: HTMLElement[]; wins: HTMLElement[]; lns: HTMLElement[];
};

/**
 * 랜딩 스크롤 연출 — 서버가 그린 화면에 **클래스만** 붙였다 뗀다(상태·다시 그리기 없음).
 * · 히어로 화면 기울기(`--t`) · 머리 줄 경계선 · 화면에 들어오면 떠오르기(`.rv` → `.in`)
 * · 고정 장면(`.pin`)은 스크롤 진행률로 단계를 정해 창·상담 분석 줄·출석부 칸을 차례로 켠다
 * · 화면 스트립은 폭에 맞춰 흐르는 속도를 정한다(CSS 애니메이션 — 마우스를 올리면 멈춤은 CSS가)
 * 움직임 줄이기 설정이면 전부 켠 최종 모습만 보여 주고 끝낸다.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp");
    if (!root) return;
    root.classList.add("js");
    const att = root.querySelector<HTMLElement>("#att");
    const cells = all<HTMLElement>(root, "#attTable td.c").sort((a, b) => Number(a.dataset.o) - Number(b.dataset.o));
    const sums = all<HTMLElement>(root, "#attTable td.sum");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("rm");
      cells.forEach((c) => c.classList.add("on"));
      att?.classList.add("final");
      return () => root.classList.remove("js", "rm");
    }

    const strip = root.querySelector<HTMLElement>("#strip");
    const setDur = () => strip?.style.setProperty("--dur", `${Math.max(30, Math.round(strip.scrollWidth / 2 / 38))}s`);
    setDur();

    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    all(root, ".rv").forEach((el) => io.observe(el));

    const words = all<HTMLElement>(root, "#words span");
    // `[data-play]` 장면(상담·학원 비서·출석부)은 스크롤이 아니라 `ScenePlayer`가 시간으로 재생한다(2026-11-10).
    const pins: Pin[] = all<HTMLElement>(root, ".pin:not([data-play])").map((el) => ({
      el, steps: Number(el.dataset.steps) || 1, scene: el.dataset.scene ?? "", last: -1,
      li: all<HTMLElement>(el, ".steps li"), dots: all<HTMLElement>(el, ".dots i"),
      wins: all<HTMLElement>(el, ".win"), lns: all<HTMLElement>(el, ".ln"),
    }));

    const setStep = (p: Pin, s: number) => {
      if (p.last === s) return;
      p.last = s;
      p.li.forEach((li) => { const i = Number(li.dataset.i); li.classList.toggle("on", i === s); li.classList.toggle("done", i < s); });
      p.dots.forEach((d, i) => d.classList.toggle("on", i === s));
      p.wins.forEach((w) => { const i = Number(w.dataset.i); w.classList.toggle("show", i <= s); w.classList.toggle("top", i === s); });
      p.lns.forEach((l) => l.classList.toggle("show", Number(l.dataset.i) <= s));
      if (p.scene === "att" && att) { att.classList.toggle("memo", s === 2); att.classList.toggle("final", s === 3); }
    };

    const frame = root.querySelector<HTMLElement>("#heroFrame");
    const nav = root.querySelector<HTMLElement>("#nav");
    let ticking = false;
    let raf = 0;
    const update = () => {
      ticking = false;
      const vh = window.innerHeight;
      const y = window.scrollY;
      nav?.classList.toggle("scrolled", y > 8);
      frame?.style.setProperty("--t", (1 - clamp(y / (vh * 0.7), 0, 1)).toFixed(3));
      for (const p of pins) {
        const r = p.el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) continue;
        const prog = clamp(-r.top / (r.height - vh), 0, 1);
        if (p.scene === "words") {
          words.forEach((w, i) => w.style.setProperty("--w", clamp(prog * (words.length + 3) - i, 0, 1).toFixed(2)));
          continue;
        }
        setStep(p, Math.min(p.steps - 1, Math.floor(prog * p.steps)));
        if (p.scene === "att") {
          const k = Math.round(clamp(prog / 0.72, 0, 1) * cells.length);
          const byRow = sums.map(() => 0);
          cells.forEach((c, i) => {
            const on = i < k;
            c.classList.toggle("on", on);
            if (on) byRow[Number(c.dataset.o) % 10] += unitsOf(c.querySelector("span")?.textContent ?? "");
          });
          sums.forEach((e, i) => { e.textContent = String(byRow[i]); });
        }
      }
    };
    const onScroll = () => { if (!ticking) { ticking = true; raf = requestAnimationFrame(update); } };
    const onResize = () => { setDur(); update(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      io.disconnect();
      root.classList.remove("js");
    };
  }, []);
  return null;
}
