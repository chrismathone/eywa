"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { monthPosition, periodAt } from "../../continuous-timeline";
import { monthAtScrollPosition, monthNearestCenter } from "../../timeline-navigation";

function scrollHost(element: HTMLElement): HTMLElement {
  if (/(auto|scroll)/.test(getComputedStyle(element).overflowY)) return element;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement as HTMLElement;
}

type ScrollOptions = {
  onScrollPosition?: (position: number) => void;
  selectionRevision?: number;
  detailSelector?: string;
  requireUserScroll?: boolean;
};

export function useTimelineScrollSpy(position: number, onPosition: (position: number) => void, scopeKey: string, continuous = false, options: ScrollOptions = {}) {
  const { onScrollPosition = onPosition, selectionRevision = 0, detailSelector, requireUserScroll = false } = options;
  const layoutRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const monthRefs = useRef(new Map<number, HTMLElement>());
  const latest = useRef({ position, onPosition, onScrollPosition, detailSelector });
  useLayoutEffect(() => { latest.current = { position, onPosition, onScrollPosition, detailSelector }; }, [position, onPosition, onScrollPosition, detailSelector]);
  const lock = useRef(true);
  const userScrolling = useRef(false);
  const spyPosition = useRef<number | null>(null);
  const jumpRef = useRef<((smooth: boolean) => void) | null>(null);
  const [programmaticScroll, setProgrammaticScroll] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ above: false, below: false });
  const [request, setRequest] = useState(0);
  useLayoutEffect(() => {
    lock.current = true;
    spyPosition.current = null;
    userScrolling.current = false;
  }, [selectionRevision]);
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
      const maxScroll = host.scrollHeight - host.clientHeight;
      const above = maxScroll > 1 && host.scrollTop > 1;
      const below = maxScroll > 1 && maxScroll - host.scrollTop > 1;
      setScrollEdges((previous) => previous.above === above && previous.below === below ? previous : { above, below });
      if (lock.current || requireUserScroll && !userScrolling.current) return;
      if (box.bottom < area.top || box.top > area.top + area.height) return;
      const current = periodAt(latest.current.position);
      const bounds = [...monthRefs.current].map(([month, element]) => {
        const rect = element.getBoundingClientRect();
        return { month, top: rect.top, bottom: rect.bottom };
      });
      const currentKey = continuous ? latest.current.position : current.month;
      const month = continuous
        ? monthAtScrollPosition(bounds, area.center, currentKey, host.scrollTop, host.scrollHeight - host.clientHeight)
        : monthNearestCenter(bounds, area.center, currentKey);
      if (month === currentKey) return;
      const next = continuous ? month : monthPosition(current.year, month);
      spyPosition.current = next;
      latest.current.onScrollPosition(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const unlock = () => { lock.current = false; setProgrammaticScroll(false); };
    const interrupt = (event: Event) => {
      if (sidebarRef.current?.contains(event.target as Node)) return;
      if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      if (requireUserScroll && event.type === "pointerdown" && (event.target as Element)?.closest("button, a, input, select")) return;
      userScrolling.current = true;
      cancelAnimationFrame(settleFrame);
      if (lock.current) host.scrollTo({ top: host.scrollTop, behavior: "instant" });
      unlock();
      schedule();
    };
    jumpRef.current = (smooth) => {
      const month = continuous ? latest.current.position : periodAt(latest.current.position).month;
      const element = monthRefs.current.get(month);
      if (!element) { unlock(); return; }
      lock.current = true;
      userScrolling.current = false;
      setProgrammaticScroll(true);
      cancelAnimationFrame(settleFrame);
      const area = viewport();
      const detail = latest.current.detailSelector ? element.querySelector<HTMLElement>(latest.current.detailSelector) : null;
      const rect = (detail ?? element).getBoundingClientRect();
      // 펼친 월이 화면보다 길면 제목·첫 주부터 보여 준다. 중간으로 맞추면 앞 주들이 바로 가려진다.
      const top = host.scrollTop + (detail || rect.height > area.height ? rect.top - area.top - 8 : (rect.top + rect.bottom) / 2 - area.center);
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
    eventHost.addEventListener("pointerdown", interrupt, { passive: true });
    eventHost.addEventListener("touchstart", interrupt, { passive: true });
    eventHost.addEventListener("keydown", interrupt);
    const onResize = () => { if (requireUserScroll) userScrolling.current = false; schedule(); };
    window.addEventListener("resize", onResize);
    schedule();
    jumpRef.current(false);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame); cancelAnimationFrame(settleFrame);
      observer.disconnect(); resize.disconnect();
      eventHost.removeEventListener("scroll", schedule);
      eventHost.removeEventListener("wheel", interrupt);
      eventHost.removeEventListener("pointerdown", interrupt);
      eventHost.removeEventListener("touchstart", interrupt);
      eventHost.removeEventListener("keydown", interrupt);
      window.removeEventListener("resize", onResize);
      jumpRef.current = null;
    };
  }, [scopeKey, continuous, requireUserScroll]);

  useEffect(() => {
    if (spyPosition.current === position) return;
    const frame = requestAnimationFrame(() => { if (lock.current) jumpRef.current?.(true); });
    return () => cancelAnimationFrame(frame);
  }, [position, request, selectionRevision]);

  return { layoutRef, sidebarRef, monthRefs, registerMonth, navigateMonth, navigatePosition, programmaticScroll, scrollEdges };
}
