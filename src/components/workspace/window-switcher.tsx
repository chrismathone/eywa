"use client";

import { LayoutPanelTop, type LucideIcon } from "lucide-react";
import { NAV_GROUPS } from "@/lib/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useWindowStore, instanceLabel } from "./window-store";

// 라우트 창 칩 아이콘 — 레일과 동일(NAV_GROUPS의 lucide). 학생 요약창은 EyIcon seed.
const ICON_BY_MENU: Record<string, LucideIcon> = {};
for (const g of NAV_GROUPS) for (const it of g.items) ICON_BY_MENU[it.menuKey] = it.icon;

/** 하단 중앙 독/스위처 — 열린·최소화 창 칩. 클릭=focus/복원, 가운데클릭=닫기. 좌측=스포트라이트 토글. */
export function WindowSwitcher() {
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const focusedId = useWindowStore((s) => s.focusedId);
  const restore = useWindowStore((s) => s.restore);
  const close = useWindowStore((s) => s.close);
  const enterSpotlight = useWindowStore((s) => s.enterSpotlight);

  const list = order.map((id) => windows[id]).filter(Boolean);
  if (list.length === 0) return null;
  const openCount = list.filter((w) => !w.minimized).length;

  return (
    <div
      data-slot="window-switcher"
      className="border-line bg-card/95 shadow-modal pointer-events-auto absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2 py-1.5 backdrop-blur"
    >
      {openCount >= 2 ? (
        <button
          type="button"
          onClick={() => enterSpotlight()}
          title="스포트라이트 (포커스 크게 + 나머지 커버)"
          aria-label="스포트라이트"
          className="text-text-dim hover:bg-bg-soft hover:text-foreground mr-0.5 flex size-7 items-center justify-center rounded-full transition"
        >
          <LayoutPanelTop size={15} strokeWidth={2} />
        </button>
      ) : null}
      {list.map((w) => {
        const active = w.id === focusedId && !w.minimized;
        const Icon =
          w.kind === "route"
            ? (ICON_BY_MENU[w.params.id] ?? ICON_BY_MENU[w.params.id.split("/")[0]])
            : null;
        const label = instanceLabel(w.id, w.params.title);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => restore(w.id)}
            onAuxClick={(e) => {
              e.preventDefault();
              close(w.id);
            }}
            title={`${label}${w.minimized ? " (최소화됨)" : ""}`}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition ${
              active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
            } ${w.minimized ? "opacity-60" : ""}`}
          >
            {Icon ? <Icon size={13} strokeWidth={1.85} /> : <EyIcon name="seed" size={12} />}
            <span className="max-w-[120px] truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
