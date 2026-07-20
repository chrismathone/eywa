/**
 * Eyebrow — 섹션 상단 mono 라벨. 카피 데크 「하루의 결」의 타임스탬프 스파인을 시각화:
 * [HH:MM] 시각(faint) + 라벨(tone). 시각이 없는 섹션은 라벨만.
 */
type Tone = "primary" | "dim" | "gold" | "azure";

const TONE: Record<Tone, string> = {
  primary: "text-primary",
  dim: "text-text-faint",
  gold: "text-gold",
  azure: "text-[var(--azure)]",
};

export function Eyebrow({
  time,
  label,
  tone = "primary",
  className,
}: {
  time?: string;
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <p className={`flex items-center gap-2.5 font-mono text-[11px] font-bold tracking-[0.16em] uppercase ${className ?? ""}`}>
      {time ? (
        <span className={`${tone === "azure" ? "text-[var(--deep-dim)]" : "text-text-faint"} tracking-[0.08em]`}>
          {time}
        </span>
      ) : null}
      <span className={TONE[tone]}>{label}</span>
    </p>
  );
}
