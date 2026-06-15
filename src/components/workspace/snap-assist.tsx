"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useWindowStore } from "./window-store";
import { snapTarget } from "./window-geometry";

/**
 * Snap Assist — 한 창을 절반에 스냅한 직후 반대편 half에 떠서, 다른 열린 창을
 * 골라 그 자리를 채우게 한다(Windows식 2-up). 라이트 프로스티드 패널(다크 dim 금지).
 * 카드 클릭=채우기, Esc/바깥(패널 배경) 클릭=닫힘. 창 포커스/이동 등 상호작용도 store가 닫음.
 */
export function SnapAssist() {
  const assist = useWindowStore((s) => s.snapAssist);
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const bounds = useWindowStore((s) => s.bounds);
  const assistPick = useWindowStore((s) => s.assistPick);
  const dismissAssist = useWindowStore((s) => s.dismissAssist);

  useEffect(() => {
    if (!assist) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissAssist();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assist, dismissAssist]);

  if (!assist) return null;
  const rect = snapTarget(assist.half, bounds);
  if (!rect) return null;

  const candidates = order
    .filter((id) => id !== assist.originId && !windows[id]?.minimized)
    .map((id) => windows[id])
    .filter(Boolean);
  if (candidates.length === 0) return null;

  return (
    <div
      className="animate-in fade-in-0 pointer-events-auto absolute top-0 left-0 p-2 duration-150"
      style={{ transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.w, height: rect.h, zIndex: 20 }}
      onClick={dismissAssist}
    >
      <div className="bg-card/85 border-line shadow-modal flex h-full w-full flex-col gap-3 rounded-xl border p-5 supports-backdrop-filter:backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-dim text-[12px] font-semibold">반대편 채우기</span>
          <button
            type="button"
            aria-label="닫기"
            onClick={dismissAssist}
            className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex size-6 items-center justify-center rounded-[3px] transition"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="scrollbar-thin grid content-start gap-2 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {candidates.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => assistPick(w.id)}
              className="border-line bg-card hover:border-primary/40 hover:bg-bg-soft flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition"
            >
              <span className="text-foreground w-full truncate text-[13px] font-semibold">{w.params.title}</span>
              {w.params.subtitle ? (
                <span className="text-text-faint w-full truncate text-[11px]">{w.params.subtitle}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
