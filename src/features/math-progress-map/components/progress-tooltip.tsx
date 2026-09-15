"use client";

import type { TooltipContent } from "../tooltip-content";

/**
 * 링 칸 툴팁 — 지도 컨테이너 기준 좌표에 절대 배치. 오른쪽 절반에선 왼쪽으로 뒤집는다(창 밖으로 안 나가게).
 * `position: fixed`를 쓰지 않는다 — 창(iframe)·줌 래퍼의 transform이 좌표계를 바꾼다([[#98]]).
 */
export function ProgressTooltip({
  content,
  x,
  y,
  flip,
  flipY,
  narrow,
}: {
  content: TooltipContent;
  x: number;
  y: number;
  /** 오른쪽 절반 → 포인터 왼쪽에 */
  flip: boolean;
  /** 아래 절반 → 포인터 위에(창 바닥에 잘리지 않게) */
  flipY: boolean;
  /** 좁은 화면(폰) → 포인터를 안 따라가고 지도 아래 가운데에 */
  narrow: boolean;
}) {
  const tx = flip ? "-100%" : "0";
  const ty = flipY ? "-100%" : "0";
  const style = narrow
    ? { left: "50%", bottom: 8, transform: "translateX(-50%)" }
    : { left: x + (flip ? -14 : 14), top: y + (flipY ? -14 : 14), transform: `translate(${tx}, ${ty})` };
  return (
    <div
      role="tooltip"
      className="bg-card border-line pointer-events-none absolute z-20 w-max max-w-[min(280px,calc(100%-16px))] rounded-lg border px-3 py-2.5 shadow-lg"
      style={style}
    >
      <p className="text-foreground text-sm font-bold">{content.title}</p>
      {content.rows.length > 0 ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {content.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-dim font-medium">{k}</dt>
              <dd className="text-foreground num break-keep">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
