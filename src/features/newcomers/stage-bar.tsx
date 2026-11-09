import type { CSSProperties } from "react";
import styles from "./stage-bar.module.css";

/** 90일 정착 단계 = 퇴원보고서 단계 막대와 같은 결 — 칸마다 지나온 만큼 차오른다. 경계는 `currentStage`와 같다. */
const STAGES = [
  { name: "첫 적응", from: 0, to: 7 },
  { name: "30일", from: 7, to: 30 },
  { name: "60일", from: 30, to: 60 },
  { name: "90일", from: 60, to: 90 },
] as const;

export function StageBar({ elapsed, label }: { elapsed: number; label: string }) {
  const fill = (s: (typeof STAGES)[number]) => Math.max(0, Math.min(1, (elapsed - s.from) / (s.to - s.from)));
  const now = elapsed < 0 ? -1 : STAGES.findIndex((s) => elapsed <= s.to);
  return (
    <div className={styles.root}>
      <div role="img" aria-label={`${label} · ${elapsed < 0 ? "등록 예정" : elapsed > 90 ? "90일 지남" : `${STAGES[now]?.name ?? "90일"} 단계 · ${elapsed}일째`}`} className={styles.cells}>
        {STAGES.map((s, i) => (
          <span key={s.name} className={styles.cell} data-state={i < now || elapsed > 90 ? "done" : i === now ? "now" : "todo"}>
            <i style={{ "--fill": `${fill(s) * 100}%` } as CSSProperties} />
          </span>
        ))}
      </div>
      <div aria-hidden className={styles.names}>
        {STAGES.map((s, i) => <span key={s.name} data-state={i < now || elapsed > 90 ? "done" : i === now ? "now" : "todo"}>{s.name}</span>)}
      </div>
    </div>
  );
}
