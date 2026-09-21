import { StatStrip } from "@/components/atoms/stat-strip";
import type { AywaIconName } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { BigStat, type BigStatTone } from "@/components/atoms/big-stat";
import { formatWonShort } from "../format";
import type { RetentionStats } from "../server/queries";

/** 건강 분포 아래에서 상담 예약·재등록 위험·해당 월 수강료를 요약한다. */
export function PulseTiles({ stats }: { stats: RetentionStats }) {
  const tiles: { label: string; value: string | number; icon: AywaIconName; tone: BigStatTone }[] = [
    { label: "상담 예약", value: stats.scheduled, icon: "messages", tone: "blue" },
    // '재등록 위험'도 위험이다 — 바로 위 '위험 학생'이 danger인데 여기만 rose면 같은 타일 줄에서
    // "위험"이 두 색이 된다(campaign-board의 renewalTone==="risk"도 danger를 쓴다).
    { label: "재등록 위험", value: stats.renewalRisk, icon: "bell", tone: "danger" },
    { label: "위험·관심 학생 월 수강료", value: formatWonShort(stats.revenueRisk), icon: "wallet", tone: "primary" },
  ];
  return (
    <StatStrip label="후속 관리 현황">
      {tiles.map((t) => (
        <BigStat
          key={t.label}
          label={t.label}
          value={t.value}
          tone={t.tone}
          icon={<MenuGlyph name={t.icon} size={22} />}
          sub={t.icon === "wallet" ? "해당 학생의 등록 월 수강료 합계" : undefined}
        />
      ))}
    </StatStrip>
  );
}
