"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { monthPosition, periodAt } from "../../continuous-timeline";
import { monthNearestCenter } from "../../timeline-navigation";

function scrollHost(element: HTMLElement): HTMLElement {
  if (/(auto|scroll)/.test(getComputedStyle(element).overflowY)) return element;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement as HTMLElement;
}

export function useTimelineScrollSpy(position: number, onPosition: (position: number) => void, scopeKey: string) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const monthRefs = useRef(new Map<number, HTMLElement>());
  const latest = useRef({ position, onPosition });
  useLayoutEffect(() => { latest.current = { position, onPosition }; }, [position, onPosition]);
  const lock = useRef(true);
  const spyPosition = useRef<number | null>(null);
  const jumpRef = useRef<((smooth: boolean) => void) | null>(null);
  const [programmaticScroll, setProgrammaticScroll] = useState(false);
  const [request, setRequest] = useState(0);
  const registerMonth = useCallback((month: number, element: HTMLElement | null) => {
    if (element) monthRefs.current.set(month, element);
    else monthRefs.current.delete(month);
  }, []);
  const navigatePosition = useCallback((next: number) => {
    lock.current = true;
    spyPosition.current = null;
    latest.current.onPosition(next);
    setRequest((value) => value + 1);
  }, []);
  const navigateMonth = useCallback((month: number) => {
    navigatePosition(monthPosition(periodAt(latest.current.position).year, month));
  }, [navigatePosition]);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const host = scrollHost(layout);
    const isDocument = host === document.scrollingElement;
    const eventHost = isDocument ? window : host;
    let frame = 0, settleFrame = 0;
    let disposed = false;
    const viewport = () => {
      const top = isDocument ? 0 : host.getBoundingClientRect().top;
      const height = isDocument ? innerHeight : host.clientHeight;
      const compact = matchMedia("(max-width: 900px)").matches;
      const covered = compact ? Math.min(sidebarRef.current?.offsetHeight ?? 0, height * 0.5) : 0;
      return { top, height, center: top + covered + (height - covered) / 2 };
    };
    const update = () => {
      frame = 0;
      const area = viewport();
      layout.style.setProperty("--timeline-viewport", `${area.height}px`);
      const box = layout.getBoundingClientRect();
      layout.style.setProperty("--timeline-sidebar-height", `${Math.max(240, area.height - Math.max(0, box.top - area.top) - 24)}px`);
      if (lock.current) return;
      if (box.bottom < area.top || box.top > area.top + area.height) return;
      const current = periodAt(latest.current.position);
      const bounds = [...monthRefs.current].map(([month, element]) => {
        const rect = element.getBoundingClientRect();
        return { month, top: rect.top, bottom: rect.bottom };
      });
      const month = monthNearestCenter(bounds, area.center, current.month);
      if (month === current.month) return;
      const next = monthPosition(current.year, month);
      spyPosition.current = next;
      latest.current.onPosition(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const unlock = () => { lock.current = false; setProgrammaticScroll(false); };
    const interrupt = (event: Event) => {
      if (sidebarRef.current?.contains(event.target as Node)) return;
      if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      cancelAnimationFrame(settleFrame);
      if (lock.current) host.scrollTo({ top: host.scrollTop, behavior: "instant" });
      unlock();
      schedule();
    };
    jumpRef.current = (smooth) => {
      const month = periodAt(latest.current.position).month;
      const element = monthRefs.current.get(month);
      if (!element) { unlock(); return; }
      lock.current = true;
      setProgrammaticScroll(true);
      cancelAnimationFrame(settleFrame);
      const area = viewport();
      const rect = element.getBoundingClientRect();
      const top = host.scrollTop + (rect.top + rect.bottom) / 2 - area.center;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      host.scrollTo({ top: Math.max(0, Math.min(host.scrollHeight - host.clientHeight, top)), behavior: smooth && !reduced ? "smooth" : "instant" });
      const started = performance.now();
      let lastTop = host.scrollTop, stableSince = started;
      const settle = () => {
        if (disposed) return;
        const now = performance.now();
        if (Math.abs(host.scrollTop - lastTop) > 0.5) stableSince = now;
        lastTop = host.scrollTop;
        if ((now - started >= 160 && now - stableSince > 100) || now - started > 2200) {
          unlock();
          return;
        }
        settleFrame = requestAnimationFrame(settle);
      };
      settleFrame = requestAnimationFrame(settle);
    };
    const observer = new IntersectionObserver(schedule, { root: isDocument ? null : host, threshold: [0, 0.5, 1] });
    monthRefs.current.forEach((element) => observer.observe(element));
    const resize = new ResizeObserver(schedule);
    resize.observe(layout);
    if (sidebarRef.current) resize.observe(sidebarRef.current);
    if (!isDocument) resize.observe(host);
    eventHost.addEventListener("scroll", schedule, { passive: true });
    eventHost.addEventListener("wheel", interrupt, { passive: true });
    eventHost.addEventListener("touchstart", interrupt, { passive: true });
    eventHost.addEventListener("keydown", interrupt);
    window.addEventListener("resize", schedule);
    schedule();
    jumpRef.current(false);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame); cancelAnimationFrame(settleFrame);
      observer.disconnect(); resize.disconnect();
      eventHost.removeEventListener("scroll", schedule);
      eventHost.removeEventListener("wheel", interrupt);
      eventHost.removeEventListener("touchstart", interrupt);
      eventHost.removeEventListener("keydown", interrupt);
      window.removeEventListener("resize", schedule);
      jumpRef.current = null;
    };
  }, [scopeKey]);

  useEffect(() => {
    if (spyPosition.current === position) return;
    const frame = requestAnimationFrame(() => jumpRef.current?.(true));
    return () => cancelAnimationFrame(frame);
  }, [position, request]);

  return { layoutRef, sidebarRef, monthRefs, registerMonth, navigateMonth, navigatePosition, programmaticScroll };
}
