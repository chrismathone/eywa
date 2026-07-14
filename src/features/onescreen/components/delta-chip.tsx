import { delta } from "../report";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";

/** 직전 회차 대비 증감 배지 (▲ 상승=green / ▼ 하락=danger / — 동일) */
export function DeltaChip({ score, prev }: { score: number | null; prev: number | null }) {
  const d = delta(score, prev);
  if (d == null) return null;
  const cls = d > 0 ? "text-primary" : d < 0 ? "text-danger" : "text-text-faint";
  const icon: EywaIconName | null = d > 0 ? "arrowUp" : d < 0 ? "arrowDown" : null;
  return (
    <span className={`tabular inline-flex items-center gap-0.5 text-[11px] font-bold ${cls}`}>
      {icon ? <EyIcon name={icon} size={10} strokeWidth={2} /> : null}
      {d === 0 ? "동일" : Math.abs(d)}
    </span>
  );
}
