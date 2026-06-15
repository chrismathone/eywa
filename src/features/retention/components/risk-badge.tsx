import { Pill, type PillColor } from "@/components/atoms/pill";
import { levelLabel, type RiskLevel } from "../risk";

const LEVEL_COLOR: Record<RiskLevel, PillColor> = {
  risk: "danger",
  warn: "amber",
  ok: "primary",
};

/** 위험 등급 배지 — 위험(danger)/관심(amber)/안정(primary) + 점수. */
export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <Pill color={LEVEL_COLOR[level]}>
      {levelLabel(level)}
      {score != null ? ` ${score}` : ""}
    </Pill>
  );
}
