import { Pill } from "@/components/atoms/pill";
import type { StudyExamRow, StudyKpis, TrendPoint } from "../sheet-model";
import { EmptyNote, KpiTile, Meter } from "./jj-sheet-parts";

/**
 * 학습 분석지 조각 — 종합(정답률) · 핵심 지표 네 칸 · 기간 중 시험(점수 추이 + 최근 목록). 순수 프레젠테이션.
 */

/** 종합 — 정답률 크게 + 푼 문제·정답. 기록이 없으면 숫자 대신 "기록 없음". */
export function StudyHero({ k }: { k: StudyKpis }) {
  return (
    <div className="bg-bg-soft flex items-end justify-between gap-4 rounded-xl px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-text-dim text-xs font-medium">정답률</p>
        {k.hasAnswers ? (
          <p className="mt-1 flex items-baseline gap-1">
            <span className={`num text-5xl leading-none font-bold ${k.accuracyTone === "critical" ? "text-danger" : "text-foreground"}`}>
              {k.accuracy}
            </span>
            <span className="text-text-dim text-xl font-bold">%</span>
          </p>
        ) : (
          <p className="text-text-dim mt-1 text-2xl font-bold">기록 없음</p>
        )}
      </div>
      <dl className="grid shrink-0 grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-1 text-right">
        <dt className="text-text-dim text-xs">푼 문제</dt>
        <dd className="num text-foreground text-base font-bold">{k.answers}</dd>
        <dt className="text-text-dim text-xs">정답</dt>
        <dd className="num text-foreground text-base font-bold">{k.correct}</dd>
      </dl>
    </div>
  );
}

/** 핵심 지표 네 칸 — 비율인 칸(학습한 날·장기기억)만 미터. */
export function StudyKpiTiles({ k }: { k: StudyKpis }) {
  return (
    <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
      <KpiTile label="학습 시간" value={k.studyTime} note={k.studyNote} />
      <KpiTile label="학습한 날" value={k.activeDays} note={k.activeNote} ratio={k.activeRatio} />
      <KpiTile label="새로 익힌 단어" value={k.newWords} note="기간 중 처음 본 단어" />
      <KpiTile label="장기기억 단어" value={k.longTerm} note={k.longTermNote} ratio={k.longTermRatio} />
    </div>
  );
}

/** 점수 추이 — 0~100 한 축, 선 + 점(60 미만만 빨강). 글자는 SVG 밖(확대돼도 글씨가 안 커지게, #4). */
function TrendLine({ points }: { points: TrendPoint[] }) {
  const W = 300;
  const H = 72;
  const P = 8;
  const yOf = (v: number) => H - P - ((H - 2 * P) * v) / 100;
  const xy = points.map((p, i) => [P + ((W - 2 * P) * i) / (points.length - 1), yOf(p.score)] as const);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`최근 ${points.length}회 점수 추이`}>
      {[0, 50, 100].map((v) => (
        <line key={v} x1={P} x2={W - P} y1={yOf(v)} y2={yOf(v)} className="stroke-line" strokeWidth={1} />
      ))}
      <polyline
        points={xy.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        className="stroke-primary"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle
          key={p.key}
          cx={xy[i]![0]}
          cy={xy[i]![1]}
          r={4.5}
          strokeWidth={2}
          className={`stroke-card ${p.tone === "critical" ? "fill-danger" : "fill-primary"}`}
        />
      ))}
    </svg>
  );
}

/** 기간 중 시험 — (넓은 틀이면) 점수 추이 + 최근 시험 목록. 이 목록은 링크가 없다(학부모 카드와 같은 조각). */
export function StudyExamList({
  data,
  trend,
}: {
  data: { rows: StudyExamRow[]; rest: number; trend: TrendPoint[] };
  trend: boolean;
}) {
  if (!data.rows.length) return <EmptyNote>기간 중 본 시험이 없습니다.</EmptyNote>;
  return (
    <div className="flex flex-col gap-2">
      {trend && data.trend.length ? <TrendLine points={data.trend} /> : null}
      <div className="flex flex-col">
        {data.rows.map((r) => (
          <div
            key={r.key}
            className="border-line grid grid-cols-[minmax(0,1fr)_auto_2.75rem_minmax(0,6rem)] items-center gap-x-2.5 border-b py-1.5 last:border-b-0"
          >
            <span className="truncate text-sm font-medium" title={r.deck}>
              {r.deck}
            </span>
            <Pill>{r.typeLabel}</Pill>
            <span className="num text-text-dim text-right text-xs">{r.date}</span>
            <span className="flex items-center gap-1.5">
              <Meter pct={r.score} tone={r.tone} size="sm" />
              <span className={`num w-10 shrink-0 text-right text-sm font-bold ${r.tone === "critical" ? "text-danger" : "text-foreground"}`}>
                {r.score}점
              </span>
            </span>
          </div>
        ))}
      </div>
      {data.rest ? (
        <p className="text-text-dim text-right text-xs">
          외 {data.rest}회 — 최근 {data.rows.length}회만 보여 줍니다
        </p>
      ) : null}
    </div>
  );
}
