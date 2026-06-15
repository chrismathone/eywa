"use client";

import { useWindowStore } from "./window-store";
import { snapBar, type LayoutTemplate } from "./window-geometry";

const LABEL: Record<LayoutTemplate, string> = {
  split: "2분할",
  stack: "1+2",
  thirds: "세로 3분할",
};

/**
 * Win11식 스냅 레이아웃 바 — 드래그 중 상단 중앙에 떠서 레이아웃 후보를 미니 다이어그램으로 보여줌.
 * 시각 전용(pointer-events:none): 포인터는 타이틀바가 캡처 중이라 선택은 드래그 훅의 기하 히트테스트가 처리.
 * snapBar() 기하를 그대로 그려 히트테스트와 1:1 일치(호버 칸 강조 = 실제 드롭 슬롯).
 */
export function SnapLayoutsBar() {
  const draggingId = useWindowStore((s) => s.draggingId);
  const dragNearTop = useWindowStore((s) => s.dragNearTop);
  const bounds = useWindowStore((s) => s.bounds);
  const dragLayout = useWindowStore((s) => s.dragLayout);
  const order = useWindowStore((s) => s.order);
  const windows = useWindowStore((s) => s.windows);

  // 드래그 중 + 포인터가 상단 밴드에 있을 때만 reveal(Win11식). 단순 클릭/중앙 드래그엔 안 뜸.
  if (!draggingId || !dragNearTop) return null;
  const count = order.filter((id) => !windows[id]?.minimized).length;
  const bar = snapBar(bounds, count);
  if (!bar) return null;

  return (
    <div
      className="animate-in fade-in-0 slide-in-from-top-1 pointer-events-none absolute top-0 left-0 z-[60] duration-150"
      style={{ transform: `translate(${bar.x}px, ${bar.y}px)`, width: bar.w, height: bar.h }}
      aria-hidden="true"
    >
      <div className="bg-card/90 border-line shadow-modal absolute inset-0 rounded-xl border supports-backdrop-filter:backdrop-blur-sm" />
      {bar.items.map((item) => (
        <div key={item.template}>
          <div
            className="border-line absolute overflow-hidden rounded-[5px] border"
            style={{ left: item.box.x - bar.x, top: item.box.y - bar.y, width: item.box.w, height: item.box.h }}
          >
            {item.cells.map((c, s) => {
              const active = dragLayout?.template === item.template && dragLayout?.slot === s;
              return (
                <div
                  key={s}
                  className={`absolute rounded-[2px] border transition-colors ${
                    active ? "bg-primary/35 border-primary/70" : "bg-bg-soft border-line"
                  }`}
                  style={{ left: c.x - item.box.x + 1, top: c.y - item.box.y + 1, width: c.w - 2, height: c.h - 2 }}
                />
              );
            })}
          </div>
          <span
            className="text-text-dim absolute text-center text-[10px] font-medium"
            style={{ left: item.box.x - bar.x, top: item.box.y - bar.y + item.box.h + 3, width: item.box.w }}
          >
            {LABEL[item.template]}
          </span>
        </div>
      ))}
    </div>
  );
}
