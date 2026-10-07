import type { VocabkingReport } from "../model";
import { fmtDuration } from "../format";

/**
 * 보카킹 리포트 맨 위 **점수 영역**(원장 2026-10-07 *"점수 영역 디자인이 더 추가되어야 할 듯 — 지금 너무 별로"*).
 * 한 덩어리에 담는 것: 점수 원 그래프(/100) · 정답 수 · 객관식(의미)·주관식(철자) · 소요 시간 · 석차(있을 때만) ·
 * **점수 위치 막대**(0~100 위에 내 점수와 전체·반 평균) — 숫자 하나가 아니라 "평균에 비해 어디쯤"이 한눈에 보이게.
 * 🔴 석차가 없으면(순위 숨김 계정·인재원 미계산) 석차 줄을 **아예 안 그린다**("정보가 없습니다" 문구도 안 쓴다).
 * 🔴 총 응시 인원은 쓰지 않는다(원장 지시) — 상위 %만.
 */
const R = 50;
const C = 2 * Math.PI * R;

function Gauge({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  return (
    <svg viewBox="0 0 128 128" className="size-24 shrink-0 @md:size-32" role="img" aria-label={`점수 ${score}점 (100점 만점)`}>
      <circle cx={64} cy={64} r={R} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={12} />
      <circle
        cx={64}
        cy={64}
        r={R}
        fill="none"
        className="stroke-gold-bright"
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${(C * s) / 100} ${C}`}
        transform="rotate(-90 64 64)"
      />
      <text x={64} y={66} textAnchor="middle" dominantBaseline="middle" className="num fill-current text-4xl font-bold">
        {score}
      </text>
      <text x={64} y={92} textAnchor="middle" className="fill-current text-xs" opacity={0.8}>
        / 100점
      </text>
    </svg>
  );
}

/** 0~100 막대 위의 내 점수와 평균들 — 평균이 없으면 막대만. */
function ScoreLine({ score, marks }: { score: number; marks: { label: string; value: number }[] }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-3 rounded-full bg-white/20">
        <div className="bg-gold-bright h-3 rounded-full" style={{ width: `${clamp(score)}%` }} />
        {marks.map((m) => (
          <span
            key={m.label}
            className="absolute -top-1.5 block h-6 w-0.5 rounded-full bg-white"
            style={{ left: `calc(${clamp(m.value)}% - 1px)` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs opacity-90">
        <span className="num">0</span>
        <span className="flex flex-wrap gap-x-3">
          {marks.map((m) => (
            <span key={m.label}>
              <span className="mr-1 inline-block h-2.5 w-0.5 rounded-full bg-white align-middle" aria-hidden />
              {m.label} <b className="num">{m.value}점</b>
            </span>
          ))}
        </span>
        <span className="num">100</span>
      </div>
    </div>
  );
}

export function VkScore({ report }: { report: VocabkingReport }) {
  const { score, position, competency, details } = report;
  const kinds = competency.filter((c) => c.key !== "total");
  const marks = position.comparisons
    .filter((c) => c.key === "overall" || c.key === "class")
    .map((c) => ({ label: c.key === "overall" ? "전체 평균" : "반 평균", value: c.avg }));
  return (
    <section className="bg-primary text-primary-foreground flex flex-col gap-4 rounded-2xl px-5 py-5 @md:px-7">
      {/* 한 줄 = 원 그래프 + 정답 수·석차(폰에서도 나란히) / 다음 줄 = 의미·철자·시간 칸(전체 폭). */}
      <div className="flex items-center gap-4 @md:gap-6">
        <Gauge score={score.score} />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-bold tracking-wide opacity-85">이번 시험 결과</p>
          <p className="text-lg font-bold @md:text-xl">
            {score.total}문제 중 <span className="num text-2xl @md:text-3xl">{score.correct}</span>개 정답
          </p>
          {position.rank !== null && position.topPercent !== null ? (
            <p className="bg-gold-bright text-primary inline-flex w-fit flex-wrap items-baseline gap-x-1.5 rounded-lg px-3 py-1 text-sm font-bold">
              전체 <span className="num">{position.rank}</span>위 · 상위 <span className="num">{position.topPercent}%</span>
              {position.band ? <span>· {position.band}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {kinds.map((k) => (
          <div key={k.key} className="min-w-0 rounded-xl bg-white/12 px-2 py-2 @md:px-3">
            <p className="text-xs whitespace-nowrap opacity-85">{k.label}</p>
            <p className="num text-sm font-bold whitespace-nowrap @md:text-lg">{Math.round(k.rate * 100)}%</p>
          </div>
        ))}
        <div className="min-w-0 rounded-xl bg-white/12 px-2 py-2 @md:px-3">
          <p className="text-xs whitespace-nowrap opacity-85">소요 시간</p>
          <p className="num text-sm font-bold whitespace-nowrap @md:text-lg">{fmtDuration(details.elapsedMs)}</p>
        </div>
      </div>
      <ScoreLine score={score.score} marks={marks} />
    </section>
  );
}
