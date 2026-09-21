"use client";

import { useEffect } from "react";
import { X } from "@/components/icons/aywa-icon-compat";
import { useWindowStore } from "./window-store";
import { snapTarget, MIN_W, MIN_H, type LayoutTemplate } from "./window-geometry";

type Slot = { x: number; y: number; w: number; h: number; anchor: boolean };

/** 미니 다이어그램용 분수 슬롯(0~1). 앵커 슬롯 = anchorSide 쪽. clamp 없음(작은 프리뷰). */
function diagram(template: LayoutTemplate, anchorSide: "left" | "right"): Slot[] {
  const L = anchorSide === "left";
  if (template === "split") {
    return [
      { x: L ? 0 : 0.5, y: 0, w: 0.5, h: 1, anchor: true },
      { x: L ? 0.5 : 0, y: 0, w: 0.5, h: 1, anchor: false },
    ];
  }
  if (template === "stack") {
    const ax = L ? 0 : 0.5;
    const ox = L ? 0.5 : 0;
    return [
      { x: ax, y: 0, w: 0.5, h: 1, anchor: true },
      { x: ox, y: 0, w: 0.5, h: 0.5, anchor: false },
      { x: ox, y: 0.5, w: 0.5, h: 0.5, anchor: false },
    ];
  }
  const anchorCol = L ? 0 : 2;
  return [0, 1 / 3, 2 / 3].map((x, i) => ({ x, y: 0, w: 1 / 3, h: 1, anchor: i === anchorCol }));
}

const LABEL: Record<LayoutTemplate, string> = {
  split: "2분할",
  stack: "1+2",
  thirds: "세로 3분할",
};

/**
 * Snap Assist — 절반 스냅 후 "어떻게 배치할지" 고르는 레이아웃 선택기.
 * 빈 half 중앙에 작은 카드로 뜨고, 각 옵션은 미니 다이어그램(앵커 슬롯을 작게 강조 + 제목)
 * → "현재 창은 여기, 나머지를 이렇게" 가 직관적. 클릭=열린 창 자동 타일링. 라이트 톤.
 */
export function SnapAssist() {
  const assist = useWindowStore((s) => s.snapAssist);
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const bounds = useWindowStore((s) => s.bounds);
  const applyLayout = useWindowStore((s) => s.applyLayout);
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
  const anchor = windows[assist.originId];
  const half = snapTarget(assist.half, bounds);
  if (!anchor || !half) return null;

  const anchorSide: "left" | "right" = assist.half === "right" ? "left" : "right";
  const openCount = order.filter((id) => !windows[id]?.minimized).length;

  const templates: LayoutTemplate[] = ["split"];
  if (openCount >= 3 && bounds.height >= 2 * MIN_H) templates.push("stack");
  if (openCount >= 3 && bounds.width >= 3 * MIN_W) templates.push("thirds");

  return (
    <div
      className="animate-in fade-in-0 pointer-events-auto absolute top-0 left-0 duration-150"
      style={{ transform: `translate(${half.x + half.w / 2}px, ${half.y + half.h / 2}px)` }}
      onClick={dismissAssist}
    >
      <div
        className="bg-card/90 border-line shadow-modal -translate-x-1/2 -translate-y-1/2 rounded-xl border p-3.5 supports-backdrop-filter:backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center justify-between gap-4">
          <span className="text-text-dim text-xs font-bold">창 배치</span>
          <button
            type="button"
            aria-label="닫기"
            onClick={dismissAssist}
            className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex size-5 items-center justify-center rounded-xs transition"
          >
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex items-start gap-2">
          {templates.map((t) => (
            <button
              key={t}
              type="button"
              aria-label={LABEL[t]}
              onClick={() => applyLayout(t)}
              className="hover:bg-bg-soft group flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition"
            >
              <div className="border-line bg-bg-soft/40 group-hover:border-primary/40 relative h-12 w-[72px] overflow-hidden rounded-sm border">
                {diagram(t, anchorSide).map((s, i) => (
                  <div
                    key={i}
                    className={`absolute flex items-center justify-center ${
                      s.anchor
                        ? "bg-primary/15 border-primary/50 z-10 border"
                        : "bg-card border-line border"
                    }`}
                    style={{
                      left: `${s.x * 100}%`,
                      top: `${s.y * 100}%`,
                      width: `${s.w * 100}%`,
                      height: `${s.h * 100}%`,
                    }}
                  >
                    {s.anchor ? (
                      <span className="text-primary max-w-full truncate px-0.5 text-xs leading-none font-bold">
                        {anchor.params.title}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              <span className="text-text-dim group-hover:text-foreground text-xs font-medium">
                {LABEL[t]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
