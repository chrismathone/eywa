"use client";

import { useEffect } from "react";

/** 긴 세로 스크롤을 제품 세 장의 가로 이동으로 바꾼다. */
export function FlagshipMotion() {
  useEffect(() => {
    const section = document.querySelector<HTMLElement>(".flag-showroom");
    if (!section) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 901px)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (motion.matches || !desktop.matches) {
        section.style.removeProperty("--showroom-offset");
        section.style.removeProperty("--showroom-bar");
        return;
      }
      const distance = section.offsetHeight - window.innerHeight;
      const progress = distance > 0 ? Math.max(0, Math.min(1, -section.getBoundingClientRect().top / distance)) : 0;
      section.style.setProperty("--showroom-offset", `${-progress * 200 / 3}%`);
      section.style.setProperty("--showroom-bar", `${progress * 100}%`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const onFocus = (event: FocusEvent) => {
      if (motion.matches || !desktop.matches || !(event.target instanceof HTMLElement)) return;
      const slide = event.target.closest<HTMLElement>(".flag-slide");
      if (!slide) return;
      const slides = Array.from(section.querySelectorAll<HTMLElement>(".flag-slide"));
      const index = slides.indexOf(slide);
      if (index < 0 || slides.length < 2) return;
      // 키보드가 화면 밖 링크에 닿으면 브라우저의 가로 자동 스크롤을 되돌리고
      // 세로 스크롤 위치를 해당 제품에 맞춘다.
      const sticky = section.querySelector<HTMLElement>(".flag-showroom-sticky");
      if (sticky) sticky.scrollLeft = 0;
      const top = window.scrollY + section.getBoundingClientRect().top;
      const distance = Math.max(0, section.offsetHeight - window.innerHeight);
      window.scrollTo({ top: top + distance * index / (slides.length - 1), behavior: "instant" });
      update();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    section.addEventListener("focusin", onFocus);
    motion.addEventListener("change", schedule);
    desktop.addEventListener("change", schedule);
    update();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      section.removeEventListener("focusin", onFocus);
      motion.removeEventListener("change", schedule);
      desktop.removeEventListener("change", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      section.style.removeProperty("--showroom-offset");
      section.style.removeProperty("--showroom-bar");
    };
  }, []);
  return null;
}
