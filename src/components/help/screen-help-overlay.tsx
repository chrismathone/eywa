"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { manualBySlug } from "@/features/help/manuals";
import { isHelpHotkey } from "@/features/help/overlay-hotkey";
import { placeCaption } from "@/features/help/overlay-caption";
import { resolveFocusKey } from "@/features/help/overlay-focus";
import {
  holeRect,
  isOnScreen,
  placePills,
  PILL_SIZE,
  type OverlayAnchor,
  type PlacedPill,
  type Viewport,
} from "@/features/help/overlay-layout";
import { isManualArticlePath, overlaySlugForPath } from "@/features/help/overlay-path";
import { iframeRegistry } from "@/components/workspace/route-window";
import { HelpCaption } from "./help-caption";
import { HelpPills } from "./help-pills";
import { HelpSpotlight } from "./help-spotlight";
import { HelpStem } from "./help-stem";
import s from "./help-overlay.module.css";
import { useHelpOverlayKeys } from "./use-help-overlay-keys";

const HELP_TOGGLE = "eywa-help-toggle";
const subscribeNever = () => () => {};
function useClient(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/**
 * 어느 화면에서든 F1 → 그 문서 위에 번호 알약 + 포커스 캡션 1개.
 * 창(iframe)은 포커스된 문서에서만 반응한다(키는 프레임을 못 넘는다).
 *
 * 강사뷰 영어 화면(`teacher_view_lang`)은 이번엔 한국어 그대로다 —
 * 설명 문구는 manuals 한국어 원문이고, 이번 범위에서 사전을 타지 않는다.
 */
export function ScreenHelpOverlay({ beneathWindows = false }: { beneathWindows?: boolean }) {
  const pathname = usePathname() ?? "";
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [pills, setPills] = useState<PlacedPill[]>([]);
  const [vp, setVp] = useState<Viewport>({ w: 0, h: 0 });
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const restoreEl = useRef<HTMLElement | null>(null);

  const measure = useCallback(() => {
    if (document.body.classList.contains("tt-dragging")) {
      setOpen(false);
      return;
    }
    const next = collectAnchors(pathname);
    const placed = placePills(next.anchors, next.vp);
    setVp(next.vp);
    setPills(placed);
    setFocusKey((prev) => resolveFocusKey(prev, placed));
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isHelpHotkey(e)) {
        e.preventDefault();
        if (e.repeat) return;
        const winId = windowElId(e.target);
        if (winId && forwardHelp(winId)) {
          setOpen(false);
          return;
        }
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type !== HELP_TOGGLE) return;
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreEl.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = window.requestAnimationFrame(() => measure());
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    const obs = new MutationObserver(() => {
      if (document.body.classList.contains("tt-dragging")) setOpen(false);
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      obs.disconnect();
      restoreEl.current?.focus();
    };
  }, [open, measure]);

  const onFocus = useCallback((key: string) => setFocusKey(key), []);
  const onClose = useCallback(() => setOpen(false), []);
  useHelpOverlayKeys({ open, pills, focusKey, onFocus, onClose });

  if (!client || !open) return null;

  const focused = pills.find((p) => p.key === focusKey) ?? null;
  const occupied = pills.map((p) => ({ x: p.pill.x, y: p.pill.y, w: PILL_SIZE, h: PILL_SIZE }));
  const placed =
    focused && vp.w >= 1
      ? placeCaption(focused.box, focused.pill, vp, focused.label, focused.body, occupied)
      : null;
  const hole = focused ? holeRect(focused.box, vp) : null;
  const idx = focused ? pills.findIndex((p) => p.key === focused.key) + 1 : 0;
  const z = beneathWindows ? "z-30" : "z-[10000]";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이 화면 도움말"
      className={`fixed inset-0 overflow-hidden ${z}`}
    >
      <div className="absolute inset-0" onClick={onClose} />
      {hole ? <HelpSpotlight hole={hole} /> : (
        <div className={`${s.dim} pointer-events-none absolute inset-0`} style={{ background: "rgb(18 18 18 / 0.40)" }} />
      )}
      {placed?.stem ? <HelpStem stem={placed.stem} /> : null}
      {pills.length === 0 ? (
        <p className="bg-card text-foreground shadow-card pointer-events-none absolute top-1/2 left-1/2 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-center text-sm break-keep">
          {isManualArticlePath(pathname)
            ? "이 페이지가 그 화면의 번호 설명서입니다. F1 또는 Esc 로 닫습니다."
            : "이 화면에는 아직 번호 도움말이 없습니다. F1 또는 Esc 로 닫습니다."}
        </p>
      ) : null}
      <HelpPills pills={pills} focusKey={focusKey} onFocus={onFocus} />
      {focused && placed ? (
        <HelpCaption n={focused.n} label={focused.label} body={focused.body} index={idx} total={pills.length} card={placed.card} />
      ) : null}
    </div>,
    document.body,
  );
}

function collectAnchors(pathname: string): { vp: Viewport; anchors: OverlayAnchor[] } {
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
  return { vp, anchors };
}

function windowElId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest("[data-window-id]")?.getAttribute("data-window-id") ?? null;
}

function forwardHelp(winId: string): boolean {
  const frame = iframeRegistry.get(winId)?.contentWindow;
  if (!frame) return false;
  frame.postMessage({ type: HELP_TOGGLE }, window.location.origin);
  return true;
}
