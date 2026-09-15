"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { manualBySlug } from "@/features/help/manuals";
import { isHelpHotkey } from "@/features/help/overlay-hotkey";
import {
  isOnScreen,
  placeOverlay,
  PILL_SIZE,
  type OverlayAnchor,
  type PlacedCallout,
} from "@/features/help/overlay-layout";
import { overlaySlugForPath } from "@/features/help/overlay-path";

const subscribeNever = () => () => {};
function useClient(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/**
 * 어느 화면에서든 F1 → 그 문서 위에 번호 알약 + 말풍선.
 * 창(iframe)은 포커스된 문서에서만 반응한다(키는 프레임을 못 넘는다).
 *
 * 강사뷰 영어 화면(`teacher_view_lang`)은 이번엔 한국어 그대로다 —
 * 설명 문구는 manuals 한국어 원문이고, 이번 범위에서 사전을 타지 않는다.
 */
export function ScreenHelpOverlay() {
  const pathname = usePathname() ?? "";
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<PlacedCallout[]>([]);

  const measure = useCallback(() => {
    const slug = overlaySlugForPath(pathname);
    const manual = slug ? manualBySlug(slug) : undefined;
    const byKey = new Map((manual?.callouts ?? []).filter((c) => c.key).map((c) => [c.key!, c]));
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const seen = new Set<string>();
    const anchors: OverlayAnchor[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-help]")) {
      const key = el.getAttribute("data-help");
      if (!key || seen.has(key)) continue;
      const callout = byKey.get(key);
      if (!callout) continue;
      const r = el.getBoundingClientRect();
      const box = { x: r.left, y: r.top, w: r.width, h: r.height };
      if (!isOnScreen(box, vp)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      seen.add(key);
      anchors.push({ key, n: callout.n, label: callout.label, body: callout.body, box });
    }
    anchors.sort((a, b) => a.n - b.n);
    setPlaced(placeOverlay(anchors, vp));
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isHelpHotkey(e)) {
        e.preventDefault();
        if (e.repeat) return;
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => measure());
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open, measure]);

  if (!client || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="이 화면 도움말"
      className="fixed inset-0 z-[10000]"
      onClick={() => setOpen(false)}
    >
      <div className="bg-ink/45 absolute inset-0" />
      {placed.length === 0 ? (
        <p className="bg-card text-foreground shadow-card pointer-events-none absolute top-1/2 left-1/2 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-center text-sm break-keep">
          이 화면에는 아직 번호 도움말이 없습니다. F1 또는 Esc 로 닫습니다.
        </p>
      ) : null}
      {placed.map((p) => (
        <div key={p.key} className="pointer-events-none">
          <span
            className="bg-primary text-white absolute inline-flex items-center justify-center rounded-full text-xs font-bold tabular-nums"
            style={{ left: p.pill.x, top: p.pill.y, width: PILL_SIZE, height: PILL_SIZE }}
          >
            {p.n}
          </span>
          <div
            className="bg-card text-foreground shadow-card absolute overflow-hidden rounded-xl px-3 py-2"
            style={{
              left: p.balloon.x,
              top: p.balloon.y,
              width: p.balloon.w,
              maxHeight: p.balloon.h,
            }}
          >
            <p className="text-sm font-bold break-keep">
              <span className="text-primary mr-1 tabular-nums">{p.n}</span>
              {p.label}
            </p>
            <p className="text-text-dim mt-1 text-xs leading-snug break-keep">{p.body}</p>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
