import type { Stem } from "@/features/help/overlay-caption";

export function HelpStem({ stem }: { stem: Stem }) {
  return (
    <svg className="text-primary pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <path
        d={`M ${stem.x1} ${stem.y1} Q ${stem.cx} ${stem.cy} ${stem.x2} ${stem.y2}`}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.7}
        strokeWidth={2}
      />
    </svg>
  );
}
