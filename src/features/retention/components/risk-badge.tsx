import { Pill, type PillColor } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { levelLabel, type RiskLevel } from "../risk";

/** 색은 의미색 캐논 — 위험=critical · 관심=caution · **안정=positive**(구 primary 네이비). */
export const LEVEL_COLOR: Record<RiskLevel, PillColor> = {
  risk: toneColor("critical"),
  warn: toneColor("caution"),
  ok: toneColor("positive"),
};

/** 위험 등급 배지 — 위험(빨강)/관심(앰버)/안정(초록) + 점수. */
export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <Pill color={LEVEL_COLOR[level]}>
      {levelLabel(level)}
      {score != null ? ` ${score}` : ""}
    </Pill>
  );
}
