export function Sparkline({
  data,
  colorVar = "--color-chart-1",
  height = 40,
  strokeWidth = 1.5,
}: {
  data: ReadonlyArray<number | null>;
  colorVar?: string;
  height?: number;
  strokeWidth?: number;
}) {
  if (data.length === 0) return null;

  const recorded = data.filter((value): value is number => value !== null && Number.isFinite(value));
  if (recorded.length === 0) return null;

  const min = Math.min(...recorded);
  const max = Math.max(...recorded);
  const range = max - min || 1;
  const padding = 3;
  const width = 100;
  const innerH = height - padding * 2;
  const dx = data.length > 1 ? width / (data.length - 1) : 0;

  type Point = readonly [x: number, y: number];
  const segments: Point[][] = [];
  let segment: Point[] = [];
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value === null || !Number.isFinite(value)) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      continue;
    }

    const x = data.length === 1 ? width / 2 : index * dx;
    const y = padding + innerH - ((value - min) / range) * innerH;
    segment.push([x, y]);
  }
  if (segment.length > 0) segments.push(segment);

  const gradId = `spark-${colorVar.replace(/[^a-z0-9]/gi, "")}-${data.map((value) => value ?? "n").join("x")}`;
  const lastSegment = segments[segments.length - 1];
  const last = lastSegment[lastSegment.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(${colorVar})`} stopOpacity="0.20" />
          <stop offset="100%" stopColor={`var(${colorVar})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {segments.map((points, index) => {
        if (points.length === 1) {
          const [point] = points;
          return <circle key={`point-${index}`} cx={point[0]} cy={point[1]} r={1.6} fill={`var(${colorVar})`} />;
        }

        const line = points
          .map(([x, y], pointIndex) => (pointIndex === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
          .join(" ");
        const first = points[0];
        const segmentLast = points[points.length - 1];
        const area = `${line} L ${segmentLast[0]} ${height} L ${first[0]} ${height} Z`;
        return (
          <g key={`segment-${index}`}>
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
          </g>
        );
      })}
      {lastSegment.length > 1 ? (
        <circle cx={last[0]} cy={last[1]} r={1.6} fill={`var(${colorVar})`} />
      ) : null}
    </svg>
  );
}
