import type { ReportBlock } from "../report";

/** 긴 반 이름·여러 대상은 가로 막대로, 시간축은 세로 막대/선으로 유지한다. */
export function chartLayout(kind: Extract<ReportBlock, { type: "chart" }>["kind"], labels: readonly string[], seriesCount: number) {
  const horizontal = (kind === "bar" || kind === "stacked_bar") && (labels.length > 6 || labels.some(label => [...label].length > 8));
  return {
    horizontal,
    height: horizontal ? Math.max(280, labels.length * (kind === "stacked_bar" ? 32 : Math.max(34, seriesCount * 14 + 14)) + 48) : 280,
    labelWidth: horizontal ? Math.min(176, Math.max(72, ...labels.map(label => [...label].reduce((n,c) => n + (/[^\x00-\x7f]/.test(c) ? 14 : 8), 0) + 12))) : 0,
  };
}
