import { PILL_SIZE, type PlacedPill } from "@/features/help/overlay-layout";
import s from "./help-overlay.module.css";

export function HelpPills({
  pills,
  focusKey,
  onFocus,
}: {
  pills: PlacedPill[];
  focusKey: string | null;
  onFocus: (key: string) => void;
}) {
  return (
    <>
      {pills.map((p, i) => (
        <button
          key={p.key}
          type="button"
          data-help-pill={p.key}
          aria-current={p.key === focusKey ? "true" : undefined}
          aria-describedby={p.key === focusKey ? "aywa-help-caption" : undefined}
          className={`${s.pill} text-xs tabular-nums`}
          style={{
            left: p.pill.x,
            top: p.pill.y,
            width: PILL_SIZE,
            height: PILL_SIZE,
            animationDelay: `${Math.min(i * 25, 300)}ms`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onFocus(p.key);
          }}
          onMouseEnter={() => onFocus(p.key)}
        >
          {p.n}
        </button>
      ))}
    </>
  );
}
