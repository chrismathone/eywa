import { Calendar } from "lucide-react";

const DAYS = [
  { date: "5/20", day: "월", attendance: 92.1, payment: 79.2 },
  { date: "5/21", day: "화", attendance: 93.8, payment: 81.5 },
  { date: "5/22", day: "수", attendance: 91.2, payment: 84.0 },
  { date: "5/23", day: "목", attendance: 95.0, payment: 85.8 },
  { date: "5/24", day: "금", attendance: 88.4, payment: 86.4 },
  { date: "5/25", day: "토", attendance: 94.6, payment: 87.0 },
  { date: "5/26", day: "일", attendance: 94.2, payment: 87.1 },
];

export function TrendCard() {
  const w = 720;
  const h = 180; // X-axis labels live outside the SVG now
  const padX = 44;
  const padY = 24;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const dx = innerW / (DAYS.length - 1);
  const yMin = 75;
  const yMax = 100;
  const yRange = yMax - yMin;
  const yAt = (v: number) => padY + innerH - ((v - yMin) / yRange) * innerH;

  const attLine = DAYS.map(
    (d, i) => `${i === 0 ? "M" : "L"} ${padX + i * dx} ${yAt(d.attendance)}`,
  ).join(" ");
  const payLine = DAYS.map(
    (d, i) => `${i === 0 ? "M" : "L"} ${padX + i * dx} ${yAt(d.payment)}`,
  ).join(" ");
  const attArea = `${attLine} L ${padX + (DAYS.length - 1) * dx} ${h - padY} L ${padX} ${h - padY} Z`;

  return (
    <section className="bg-card border-border rounded-lg border p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="eyebrow">최근 7일 추세</p>
          <h2 className="display text-foreground mt-1.5 text-xl">출석률 · 수납률</h2>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <Legend colorClass="bg-chart-2" label="출석률" value="94.2%" delta="+2.1pt" positive />
          <Legend
            colorClass="bg-chart-3"
            label="수납률"
            value="87.1%"
            delta="+7.9pt"
            positive
            dashed
          />
          <div className="text-muted-foreground inline-flex items-center gap-1.5">
            <Calendar className="size-3" />
            <span className="num">5/20 ~ 5/26</span>
          </div>
        </div>
      </header>

      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="block w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="att-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[80, 85, 90, 95, 100].map((g) => (
            <g key={g}>
              <line
                x1={padX}
                y1={yAt(g)}
                x2={w - padX}
                y2={yAt(g)}
                stroke="var(--color-border)"
                strokeDasharray="2 4"
                opacity="0.7"
              />
              <text
                x={padX - 10}
                y={yAt(g)}
                fontSize="11"
                fill="var(--color-muted-foreground)"
                textAnchor="end"
                dominantBaseline="middle"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {g}
              </text>
            </g>
          ))}

          <path d={attArea} fill="url(#att-grad)" />

          <path
            d={attLine}
            fill="none"
            stroke="var(--color-chart-2)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={payLine}
            fill="none"
            stroke="var(--color-chart-3)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="5 4"
          />

          {DAYS.map((d, i) => (
            <g key={d.date}>
              <circle
                cx={padX + i * dx}
                cy={yAt(d.attendance)}
                r="3.5"
                fill="var(--color-card)"
                stroke="var(--color-chart-2)"
                strokeWidth="1.5"
              />
              <circle
                cx={padX + i * dx}
                cy={yAt(d.payment)}
                r="3.5"
                fill="var(--color-card)"
                stroke="var(--color-chart-3)"
                strokeWidth="1.5"
              />
            </g>
          ))}
        </svg>

        <div className="relative mt-3 h-9">
          {DAYS.map((d, i) => {
            const xPct = ((padX + i * dx) / w) * 100;
            return (
              <div
                key={d.date}
                className="absolute top-0 -translate-x-1/2 text-center"
                style={{ left: `${xPct}%` }}
              >
                <p className="text-muted-foreground num text-[11px] leading-tight">{d.date}</p>
                <p className="text-muted-foreground/65 num mt-0.5 text-[10px] leading-tight">
                  {d.day}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Legend({
  colorClass,
  label,
  value,
  delta,
  positive,
  dashed = false,
}: {
  colorClass: string;
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  dashed?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-[2px] w-5 ${colorClass}`}
        style={
          dashed
            ? {
                backgroundImage:
                  "repeating-linear-gradient(90deg,currentColor 0 4px,transparent 4px 7px)",
              }
            : undefined
        }
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="num text-foreground font-semibold">{value}</span>
      <span className={`num text-[10px] ${positive ? "text-chart-2" : "text-chart-4"}`}>
        {delta}
      </span>
    </div>
  );
}
