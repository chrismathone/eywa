"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { useWindowStore } from "./window-store";

/** 하단 중앙 독/스위처 — 열린·최소화 창 칩. 클릭=focus/복원, 가운데클릭=닫기. */
export function WindowSwitcher() {
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const focusedId = useWindowStore((s) => s.focusedId);
  const restore = useWindowStore((s) => s.restore);
  const close = useWindowStore((s) => s.close);

  const list = order.map((id) => windows[id]).filter(Boolean);
  if (list.length === 0) return null;

  return (
    <div
      data-slot="window-switcher"
      className="border-line bg-card/95 shadow-modal pointer-events-auto fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2 py-1.5 backdrop-blur"
    >
      {list.map((w) => {
        const active = w.id === focusedId && !w.minimized;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => restore(w.id)}
            onAuxClick={(e) => {
              e.preventDefault();
              close(w.id);
            }}
            title={`${w.params.title}${w.minimized ? " (최소화됨)" : ""}`}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition ${
              active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
            } ${w.minimized ? "opacity-60" : ""}`}
          >
            <EyIcon name="seed" size={12} />
            <span className="max-w-[120px] truncate">{w.params.title}</span>
          </button>
        );
      })}
    </div>
  );
}
