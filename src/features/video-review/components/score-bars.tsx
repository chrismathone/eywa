import { SCORE_LABEL } from "../view";
import { SCORE_KEYS, type ScoreKey } from "../types";

/**
 * 점수 5칸 막대 — 숫자 대신 가로 다섯 도막을 점수만큼 채운다(원장 2026-10-21 "단계별로 다섯도막 · 가로로 도막이 올라가고 · 항목별로 색상다르게").
 * 색은 항목을 가르는 표시라 의미색이 아니라 차트 색 토큰(--chart-1~5)을 쓴다. 근거는 줄에 마우스를 올리면 카드 툴팁(data-tip)으로.
 */
const ITEM_COLOR: Record<ScoreKey, string> = {
  accuracy: "bg-chart-1",
  order: "bg-chart-2",
  reasoning: "bg-chart-3",
  terms: "bg-chart-5",
  delivery: "bg-chart-4",
};

export function ScoreBars({ scores }: { scores: Record<ScoreKey, { score: number | null; evidence: string }> }) {
  return (
    <ul className="space-y-1.5">
      {SCORE_KEYS.map((k) => {
        const score = scores[k].score;
        return (
          <li key={k} className="relative flex items-center gap-3" data-tip={scores[k].evidence || undefined}>
            {scores[k].evidence ? <span className="sr-only">근거: {scores[k].evidence}</span> : null}
            <span className="text-text-dim w-16 shrink-0 text-xs">{SCORE_LABEL[k]}</span>
            {score == null ? (
              <span className="text-text-dim text-xs">판단 보류</span>
            ) : (
              <span role="img" aria-label={`${SCORE_LABEL[k]} 5칸 중 ${score}칸`} className="flex flex-1 gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={`h-3 flex-1 rounded-sm ${n <= score ? ITEM_COLOR[k] : "bg-muted"}`} />
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
