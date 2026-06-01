import type { LearningStats } from "../history";

/** 누적 KPI 4타일 — 평균 정답률 · 출석률 · 학습 횟수 · 진도 완료 */
export function KpiGrid({ stat }: { stat: LearningStats }) {
  const items = [
    { k: "평균 정답률", v: stat.avgPct, u: "%" },
    { k: "출석률", v: stat.attRate, u: "%" },
    { k: "학습 횟수", v: stat.sessions, u: "회" },
    { k: "진도 완료", v: stat.currPct, u: "%" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.k} className="bg-card border-line shadow-card rounded-xl border p-4">
          <p className="micro text-text-faint">{it.k}</p>
          <p className="mt-2 flex items-baseline gap-0.5">
            <span className="tabular text-foreground text-[23px] leading-none font-extrabold">{it.v}</span>
            <span className="text-text-dim text-xs">{it.u}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
