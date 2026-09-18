import { useId, type CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { goalMilestones, type LearningGoal, type LearningProgress } from "../lib/learning-plan";
import { learningAxisLabel, learningAxisPosition, learningAxisTicks } from "../lib/learning-axis";
import { MATH_LEARNING_CADENCE } from "@/features/progress/learning-cadence";
import { learningBlockLabel } from "../lib/learning-label";
import styles from "./learning-rails.module.css";

/** Integer positions are fixed goals; fractional positions show actual progress. */
export function LearningRails({ progress, goal, recentBlock, recentGrade }: {
  progress?: LearningProgress;
  goal?: LearningGoal;
  recentBlock?: string | null;
  recentGrade?: string | null;
}) {
  const goalDescriptionId = useId();
  const stops = goal ? goalMilestones(goal) : [];
  const total = stops.length;
  const current = progress?.current ?? null;
  const axisCurrent = current == null ? null : learningAxisPosition(current, stops);
  const position = (value: number) => total ? value / total * 100 : 0;
  const currentPosition = position(axisCurrent ?? 0);
  const currentBlock = progress?.currentBlock ?? recentBlock;
  const currentLabel = currentBlock ? learningBlockLabel(currentBlock, goal?.studyGrade ?? recentGrade) : "진도 기록 확인 필요";
  const finalStop = stops.at(-1);
  const finalLabel = finalStop ? learningBlockLabel(finalStop.endBlock, finalStop.studyGrade) : "전체 목표를 설정해 주세요";
  const describeStop = (index: number) => `${index + 1}차 목표 · ${learningBlockLabel(stops[index].endBlock, stops[index].studyGrade)} · ${stops[index].endDate} · 누적 ${stops[index].blockCount}블록`;
  const currentText = axisCurrent == null ? "현재 진도 확인 필요" : `현재 ${learningAxisLabel(axisCurrent)} / 최종 목표 ${total} · ${currentLabel}`;
  const goalText = total ? stops.map((_, index) => describeStop(index)).join("; ") : "전체 목표 미설정";
  const variables = { "--current-position": `${currentPosition}%`, "--target-position": total ? "100%" : "0%" } as CSSProperties;

  const ticks = learningAxisTicks(stops);
  const monthlyBlocks = MATH_LEARNING_CADENCE[goal?.track ?? "regular"].monthlyBlocks;
  const labelStep = Math.max(1, Math.ceil(total / 4));
  let minorTicks = "", monthTicks = "", majorTicks = "", guides = "";
  for (const tick of ticks) {
    if (tick.position === total) continue;
    const x = (tick.position / total * 1000).toFixed(2);
    if (tick.goal) {
      majorTicks += `M${x} 30v8M${x} 83v8`;
      guides += `M${x} 38v45`;
    } else if (tick.block % monthlyBlocks === 0) {
      monthTicks += `M${x} 28v10M${x} 83v10`;
    } else {
      minorTicks += `M${x} 30v6M${x} 85v6`;
    }
  }
  return (
    <div className={styles.rails} style={variables} data-planned={total > 0} data-dense={total > 12 || undefined}>
      <div className={styles.plot}>
        {total > 0 ? (
          <svg className={styles.ruler} viewBox="0 0 1000 122" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.guides} d={guides} vectorEffect="non-scaling-stroke" />
            <path className={styles.minorTicks} d={minorTicks} vectorEffect="non-scaling-stroke" />
            <path className={styles.majorTicks} d={monthTicks} vectorEffect="non-scaling-stroke" />
            <path className={styles.majorTicks} d={majorTicks} vectorEffect="non-scaling-stroke" />
            <path className={styles.endTicks} d="M0 35v16M1000 35v16M0 69v16M1000 69v16" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
        <div className={`${styles.annotation} ${styles.currentAnnotation}`} title={`현재 진도 · ${currentLabel}`}>
          <span className={styles.annotationTag}>현재</span><span className={styles.blockName}>{currentLabel}</span>
        </div>
        <div className={`${styles.track} ${styles.currentTrack}`}
          role={total > 0 && axisCurrent != null ? "progressbar" : "img"} aria-label="현재진도"
          aria-valuemin={total > 0 && axisCurrent != null ? 0 : undefined}
          aria-valuemax={total > 0 && axisCurrent != null ? total : undefined}
          aria-valuenow={total > 0 && axisCurrent != null ? axisCurrent : undefined}
          aria-valuetext={total > 0 && axisCurrent != null ? currentText : undefined} aria-description={currentText}>
          <span className={styles.currentFill} />
          {total > 0 && axisCurrent != null ? <span className={styles.currentMarker} /> : null}
        </div>
        <div className={`${styles.track} ${styles.targetTrack}`} role="img" aria-label="목표진도" aria-describedby={goalDescriptionId}>
          <span className={styles.targetFill} />
        </div>
        {stops.map((stop, index) => (
          <Tooltip key={index}>
            <TooltipTrigger className={styles.targetMarker} data-goal-number={index + 1}
              data-final={index === total - 1 || undefined} delay={0}
              style={{ left: `${position(index + 1)}%` }} aria-label={`${index + 1}차 목표`}
              aria-describedby={`${goalDescriptionId}-stop-${index}`}
              onClick={(event) => event.stopPropagation()} />
            <TooltipContent id={`${goalDescriptionId}-stop-${index}`} role="tooltip" className={styles.goalTooltip} side="top" sideOffset={10}>
              <div>
                <strong>{index + 1}차 목표</strong>
                <p>{learningBlockLabel(stop.endBlock, stop.studyGrade)}</p>
                <small>완료 예정 · {stop.endDate} · 누적 {stop.blockCount}블록</small>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        <div className={`${styles.annotation} ${styles.targetAnnotation}`} title={`최종 목표 · ${finalLabel}`}>
          <span className={styles.annotationTag}>{total ? `${total}차 목표` : "목표"}</span>
          <span className={styles.blockName}>{finalLabel}</span>
        </div>
      </div>
      <span id={goalDescriptionId} className={styles.description}>{goalText}</span>
      <div className={styles.values} aria-hidden="true">
        <span className={styles.currentValue}>{axisCurrent == null ? "—" : <b>{learningAxisLabel(axisCurrent)}</b>}</span>
        <span className={styles.targetValue}>{total ? <><b>{total}</b><small>차 목표</small></> : "—"}</span>
      </div>
      <div className={styles.scale} aria-label="목표 수직선 눈금">
        <span>0</span>
        {ticks.filter(tick => tick.position < total && (tick.goal
          ? tick.position % labelStep === 0
          : total <= 4 && tick.block % monthlyBlocks === 0 && ticks.length <= 48
        )).map(tick => <span key={tick.block} className={`${styles.scaleTick} ${tick.goal ? styles.goalTick : styles.fractionTick}`}
          style={{ left: `${position(tick.position)}%` }}>{tick.goal ? `${tick.position}차` : `${tick.block}블록`}</span>)}
        <span className={styles.goalTick}>{total ? `${total}차` : "전체 목표 미설정"}</span>
      </div>
    </div>
  );
}
