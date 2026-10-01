import type { ThumbKind } from "@/features/dashboard/layout/registry";

/**
 * 위젯 얼굴의 작은 그림 — 카드가 무엇을 그리는지(도넛·막대·추이·목록…) 한눈에. 장식이라 접근성 트리에서 뺀다.
 * 색은 글자색(currentColor)과 학원색 옅은 칠 둘뿐 — 의미색(빨강·초록)을 쓰지 않는다(실제 값이 아니다).
 */
export function WidgetThumb({ kind, className = "" }: { kind: ThumbKind; className?: string }) {
  const tint = "color-mix(in oklab, var(--primary) 26%, transparent)";
  const ink = "color-mix(in oklab, var(--primary) 70%, transparent)";
  return (
    <svg viewBox="0 0 48 28" className={className} aria-hidden focusable="false">
      {kind === "donut" && (
        <>
          <circle cx="14" cy="14" r="9" fill="none" stroke={tint} strokeWidth="5" />
          <path d="M14 5 a9 9 0 0 1 8.6 11.7" fill="none" stroke={ink} strokeWidth="5" />
          <rect x="29" y="8" width="15" height="3" rx="1.5" fill={tint} />
          <rect x="29" y="15" width="11" height="3" rx="1.5" fill={tint} />
        </>
      )}
      {kind === "bars" &&
        [17, 12, 8, 5].map((w, i) => <rect key={i} x="4" y={4 + i * 6} width={w * 2.4} height="4" rx="2" fill={i === 0 ? ink : tint} />)}
      {kind === "columns" &&
        [10, 15, 12, 18, 14, 21].map((h, i) => <rect key={i} x={4 + i * 7} y={26 - h} width="5" height={h} rx="1.5" fill={i === 5 ? ink : tint} />)}
      {kind === "line" && <polyline points="3,20 11,16 19,18 27,10 35,12 45,6" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === "list" &&
        [0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x="4" y={4 + i * 6} width="26" height="3" rx="1.5" fill={tint} />
            <rect x="36" y={4 + i * 6} width="8" height="3" rx="1.5" fill={i === 0 ? ink : tint} />
          </g>
        ))}
      {kind === "table" &&
        [0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="4" y={5 + i * 7} width="14" height="3" rx="1.5" fill={tint} />
            <rect x="22" y={5 + i * 7} width="9" height="3" rx="1.5" fill={tint} />
            <rect x="35" y={5 + i * 7} width="9" height="3" rx="1.5" fill={i === 2 ? ink : tint} />
          </g>
        ))}
      {kind === "schedule" &&
        [0, 1, 2].map((i) => <rect key={i} x={4 + (i % 2) * 6} y={4 + i * 7} width={30 - (i % 2) * 6} height="5" rx="2" fill={i === 0 ? ink : tint} />)}
      {kind === "stack" &&
        [0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="4" y={5 + i * 7} width="40" height="4" rx="2" fill={tint} />
            <rect x="4" y={5 + i * 7} width={30 - i * 9} height="4" rx="2" fill={ink} />
          </g>
        ))}
      {kind === "number" && (
        <>
          <rect x="4" y="6" width="22" height="9" rx="2" fill={ink} />
          <rect x="4" y="19" width="30" height="3" rx="1.5" fill={tint} />
        </>
      )}
    </svg>
  );
}
