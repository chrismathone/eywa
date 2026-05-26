export function Sparkline({
  data,
  colorVar = "--color-chart-1",
  height = 40,
  strokeWidth = 1.5,
}: {
  data: number[];
  colorVar?: string;
  height?: number;
  strokeWidth?: number;
}) {
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 3;
  const width = 100;
  const innerH = height - padding * 2;
  const dx = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * dx;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const last = points[points.length - 1];
  const area = `${line} L ${last[0]} ${height} L 0 ${height} Z`;

  const gradId = `spark-${colorVar.replace(/[^a-z0-9]/gi, "")}-${data.join("x")}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(${colorVar})`} stopOpacity="0.20" />
          <stop offset="100%" stopColor={`var(${colorVar})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={`var(${colorVar})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r={1.6} fill={`var(${colorVar})`} />
    </svg>
  );
}
