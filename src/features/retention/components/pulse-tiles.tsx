import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { formatWonShort } from "../format";
import type { RetentionStats } from "../server/queries";

type TileColor = "danger" | "amber" | "blue" | "rose" | "primary";

const ICON_BG: Record<TileColor, string> = {
  danger: "bg-danger-soft text-danger",
  amber: "bg-amber-soft text-amber",
  blue: "bg-blue-soft text-blue",
  rose: "bg-rose-soft text-rose",
  primary: "bg-primary-soft text-primary",
};

function Tile({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: EywaIconName;
  color: TileColor;
}) {
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro truncate">{label}</p>
        <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[26px] leading-none">{value}</p>
    </div>
  );
}

/** 브리핑 상단 바이탈 타일 5종 — 학원 현황 한눈에. */
export function PulseTiles({ stats }: { stats: RetentionStats }) {
  return (
    <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="위험 학생" value={stats.risk} icon="userMinus" color="danger" />
      <Tile label="관심 학생" value={stats.warn} icon="alertCircle" color="amber" />
      <Tile label="상담 예약" value={stats.scheduled} icon="messages" color="blue" />
      <Tile label="재등록 위험" value={stats.renewalRisk} icon="bell" color="rose" />
      <Tile label="매출 위험" value={formatWonShort(stats.revenueRisk)} icon="wallet" color="primary" />
    </section>
  );
}
