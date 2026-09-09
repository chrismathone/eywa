import type { EywaIconName } from "@/components/icons/eywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { BigStat, type BigStatTone } from "@/components/atoms/big-stat";
import { formatWonShort } from "../format";
import type { RetentionStats } from "../server/queries";

/** 브리핑 상단 바이탈 타일 5종 — 공용 BigStat(Editorial 문법 ②: 큰 num + 작은 라벨)으로 승격. */
export function PulseTiles({ stats }: { stats: RetentionStats }) {
  const tiles: { label: string; value: string | number; icon: EywaIconName; tone: BigStatTone }[] = [
    { label: "위험 학생", value: stats.risk, icon: "userMinus", tone: "danger" },
    { label: "관심 학생", value: stats.warn, icon: "alertCircle", tone: "amber" },
    { label: "상담 예약", value: stats.scheduled, icon: "messages", tone: "blue" },
    // '재등록 위험'도 위험이다 — 바로 위 '위험 학생'이 danger인데 여기만 rose면 같은 타일 줄에서
    // "위험"이 두 색이 된다(campaign-board의 renewalTone==="risk"도 danger를 쓴다).
    { label: "재등록 위험", value: stats.renewalRisk, icon: "bell", tone: "danger" },
    { label: "매출 위험", value: formatWonShort(stats.revenueRisk), icon: "wallet", tone: "primary" },
  ];
  return (
    <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <BigStat
          key={t.label}
          label={t.label}
          value={t.value}
          tone={t.tone}
          icon={<MenuGlyph name={t.icon} size={22} />}
        />
      ))}
    </section>
  );
}
