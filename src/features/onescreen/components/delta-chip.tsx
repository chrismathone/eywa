import { delta } from "../report";

/** 직전 회차 대비 증감 배지 (▲ 상승=green / ▼ 하락=danger / — 동일) */
export function DeltaChip({ score, prev }: { score: number | null; prev: number | null }) {
  const d = delta(score, prev);
  if (d == null) return null;
  const cls = d > 0 ? "text-primary" : d < 0 ? "text-danger" : "text-text-faint";
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "—";
  const text = d === 0 ? "동일" : `${arrow}${Math.abs(d)}`;
  return <span className={`tabular text-[11px] font-bold ${cls}`}>{text}</span>;
}
