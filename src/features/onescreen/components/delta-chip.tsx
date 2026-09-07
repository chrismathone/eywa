import { delta } from "../report";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { useSheetT } from "@/features/teacher-view/lang-context";

/** 직전 회차 대비 증감 배지 (▲ 상승=green / ▼ 하락=danger / — 동일) */
export function DeltaChip({ score, prev }: { score: number | null; prev: number | null }) {
  const t = useSheetT();
  const d = delta(score, prev);
  if (d == null) return null;
  const cls = d > 0 ? "text-primary" : d < 0 ? "text-danger" : "text-text-faint";
  const icon: EywaIconName | null = d > 0 ? "arrowUp" : d < 0 ? "arrowDown" : null;
  return (
    <span className={`tabular inline-flex items-center gap-0.5 text-xs font-bold ${cls}`}>
      {icon ? <EyIcon name={icon} size={10} strokeWidth={1.8} /> : null}
      {d === 0 ? t("os.delta.same") : Math.abs(d)}
    </span>
  );
}
