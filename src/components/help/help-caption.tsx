import { HOVER_CARD_SHELL } from "@/components/hover-tip/card-style";
import type { Box } from "@/features/help/overlay-layout";
import s from "./help-overlay.module.css";

function stop(e: { stopPropagation: () => void }) {
  e.stopPropagation();
}

export function HelpCaption({
  n,
  label,
  body,
  index,
  total,
  card,
}: {
  n: number;
  label: string;
  body: string;
  index: number;
  total: number;
  card: Box;
}) {
  return (
    <div
      id="eywa-help-caption"
      className={`${HOVER_CARD_SHELL} ${s.caption} pointer-events-auto text-foreground absolute overflow-y-auto`}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
      onClick={stop}
      onPointerDown={stop}
      onWheel={stop}
    >
      <p className="text-sm font-bold break-keep">
        <span className="mr-1 tabular-nums">{n}</span>
        {label}
      </p>
      <p className="mt-0.5 text-xs leading-snug break-keep">{body}</p>
      <p className="mt-2 text-xs tabular-nums">
        {index} / {total} · ← →
      </p>
    </div>
  );
}
