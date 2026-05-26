import { Calendar } from "lucide-react";
import type { TrendPoint } from "@/features/dashboard/server/queries";

const Y_TICKS = [80, 85, 90, 95, 100];

export function TrendCard({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <section className="bg-card border-border rounded-lg border p-6">
        <p className="eyebrow">최근 7일 추세</p>
        <div className="text-muted-foreground mt-8 text-center text-sm">데이터 없음</div>
      </section>
    );
  }

  const w = 720;
  const h = 180;
  const padX = 44;
  const padY = 24;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const dx = innerW / (data.length - 1);
  const yMin = 75;
  const yMax = 100;
  const yRange = yMax - yMin;
  const yAt = (v: number) => padY + innerH - ((v - yMin) / yRange) * innerH;

  const attLine = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${padX + i * dx} ${yAt(d.attendance)}`)
    .join(" ");
  const payLine = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${padX + i * dx} ${yAt(d.payment)}`)
    .join(" ");
  const attArea = `${attLine} L ${padX + (data.length - 1) * dx} ${h - padY} L ${padX} ${h - padY} Z`;

  const lastAttendance = data[data.length - 1]?.attendance ?? 0;
  const firstAttendance = data[0]?.attendance ?? 0;
  const attDelta = (lastAttendance - firstAttendance).toFixed(1);
  const lastPayment = data[data.length - 1]?.payment ?? 0;
  const firstPayment = data[0]?.payment ?? 0;
  const payDelta = (lastPayment - firstPayment).toFixed(1);

  const rangeLabel = `${data[0]?.date} ~ ${data[data.length - 1]?.date}`;

  return (
    <section className="bg-card border-border rounded-lg border p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="eyebrow">최근 7일 추세</p>
          <h2 className="display text-foreground mt-1.5 text-xl">출석률 · 수납률</h2>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <Legend
            colorClass="bg-chart-2"
            label="출석률"
            value={`${lastAttendance.toFixed(1)}%`}
            delta={`${Number(attDelta) >= 0 ? "+" : ""}${attDelta}pt`}
            positive={Number(attDelta) >= 0}
          />
          <Legend
            colorClass="bg-chart-3"
            label="수납률"
            value={`${lastPayment.toFixed(1)}%`}
            delta={`${Number(payDelta) >= 0 ? "+" : ""}${payDelta}pt`}
            positive={Number(payDelta) >= 0}
            dashed
          />
          <div className="text-muted-foreground inline-flex items-center gap-1.5">
            <Calendar className="size-3" />
            <span className="num">{rangeLabel}</span>
          </div>
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-[860px] pl-8">
        <div className="relative">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="block w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="att-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {Y_TICKS.map((g) => (
              <line
                key={g}
                x1={padX}
                y1={yAt(g)}
                x2={w - padX}
                y2={yAt(g)}
                stroke="var(--color-border)"
                strokeDasharray="2 4"
                opacity="0.7"
              />
            ))}

            <path d={attArea} fill="url(#att-grad)" />

            <path
              d={attLine}
              fill="none"
              stroke="var(--color-chart-2)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={payLine}
              fill="none"
              stroke="var(--color-chart-3)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="5 4"
            />

            {data.map((d, i) => (
              <g key={d.date}>
                <circle
                  cx={padX + i * dx}
                  cy={yAt(d.attendance)}
                  r="3"
                  fill="var(--color-card)"
                  stroke="var(--color-chart-2)"
                  strokeWidth="1.5"
                />
                <circle
                  cx={padX + i * dx}
                  cy={yAt(d.payment)}
                  r="3"
                  fill="var(--color-card)"
                  stroke="var(--color-chart-3)"
                  strokeWidth="1.5"
                />
              </g>
            ))}
          </svg>

          <div className="pointer-events-none absolute inset-0">
            {Y_TICKS.map((g) => {
              const yPct = (yAt(g) / h) * 100;
              return (
                <span
                  key={g}
                  className="text-muted-foreground num absolute -translate-x-full -translate-y-1/2 pr-2 text-[10px] leading-none"
                  style={{ top: `${yPct}%`, left: 0 }}
                >
                  {g}
                </span>
              );
            })}
          </div>

          <div className="relative mt-2 h-8">
            {data.map((d, i) => {
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
