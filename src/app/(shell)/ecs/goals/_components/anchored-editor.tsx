"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Position = { left: number; top: number; width: number };

/** Keep the grid row at its display size while the focused editor sits over its line. */
export function AnchoredEditor({ anchorRef, children }: {
  anchorRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 360), 460, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const height = panel.getBoundingClientRect().height;
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
      setPosition((current) => current?.left === left && current.top === top && current.width === width
        ? current : { left, top, width });
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      ref={panelRef}
      data-anchored-editor
      className="fixed z-50 max-h-[calc(100vh-16px)] overflow-y-auto shadow-xl"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, width: position?.width ?? 360,
        visibility: position ? "visible" : "hidden" }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
