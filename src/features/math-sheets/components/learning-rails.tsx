import type { CSSProperties } from "react";
import {
  learningBlocks,
  type LearningGoal,
  type LearningProgress,
} from "../lib/learning-plan";
import styles from "./learning-rails.module.css";

/** A shared block ruler: positions use exact counts, not rounded display percentages. */
export function LearningRails({
  progress,
  goal,
  recentBlock,
}: {
  progress?: LearningProgress;
  goal?: LearningGoal;
  recentBlock?: string | null;
}) {
  const total = progress?.total ?? 0;
  const current = progress?.current ?? null;
  const target = progress?.target ?? 0;
  const position = (count: number) =>
    total ? Math.max(0, Math.min(100, (count / total) * 100)) : 0;
  const currentPosition = position(current ?? 0);
  const targetPosition = position(target);
  const currentLabel =
    progress?.currentBlock ?? recentBlock ?? "진도 기록 확인 필요";
  const targetLabel = !total
    ? "전체 목표를 설정해 주세요"
    : target === 0
      ? "아직 배분된 블록 없음"
      : (goal && learningBlocks(goal)[target - 1]) || `누적 ${target}블록`;

  // Each minor tick is a block; long courses thin ticks at whole-block intervals.
  // Three SVG paths keep a class full of rulers inexpensive to render.
  const step = Math.max(1, Math.ceil(total / 120));
  const majorStep = goal?.blockCount === 24 ? 8 : total > 60 ? 10 : total > 20 ? 5 : total > 8 ? 2 : 1;
  let minorTicks = "", majorTicks = "", guides = "";
  for (let block = 1; block < total; block++) {
    const x = ((block / total) * 1000).toFixed(2);
    if (block % majorStep === 0) {
      majorTicks += `M${x} 30v8M${x} 83v8`;
      guides += `M${x} 38v45`;
    } else if (block % step === 0) {
      minorTicks += `M${x} 32v4M${x} 85v4`;
    }
  }
  const labelStep = Math.max(majorStep, Math.ceil(total / 4 / majorStep) * majorStep);
  const labels: number[] = [];
  for (let block = labelStep; block < total * 0.8; block += labelStep) {
    if (block / total > 0.18) labels.push(block);
  }
  const currentText = current == null ? "현재 진도 확인 필요" : `${current} / ${total}블록 · ${currentLabel}`;
  const targetText = total ? `${target} / ${total}블록 · ${targetLabel}` : "전체 목표 미설정";
  const variables = {
    "--current-position": `${currentPosition}%`,
    "--target-position": `${targetPosition}%`,
    "--interval-start": `${Math.min(currentPosition, targetPosition)}%`,
    "--interval-width": `${Math.abs(currentPosition - targetPosition)}%`,
  } as CSSProperties;

  return (
    <div className={styles.rails} style={variables} data-planned={total > 0}>
      <div className={styles.plot}>
        {total > 0 ? (
          <svg className={styles.ruler} viewBox="0 0 1000 122" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.guides} d={guides} vectorEffect="non-scaling-stroke" />
            <path className={styles.minorTicks} d={minorTicks} vectorEffect="non-scaling-stroke" />
            <path className={styles.majorTicks} d={majorTicks} vectorEffect="non-scaling-stroke" />
            <path className={styles.endTicks} d="M0 35v16M1000 35v16M0 69v16M1000 69v16" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
        {total > 0 && current != null ? <div className={styles.interval} aria-hidden="true" /> : null}
        {total > 0 ? <div className={styles.targetGuide} aria-hidden="true" /> : null}

        <div className={`${styles.annotation} ${styles.currentAnnotation}`} title={`현재 진도 · ${currentLabel}`}>
          <span className={styles.annotationTag}>현재</span>
          <span className={styles.blockName}>{currentLabel}</span>
        </div>
        <div
          className={`${styles.track} ${styles.currentTrack}`}
          role={total > 0 && current != null ? "progressbar" : "img"}
          aria-label="현재진도"
          aria-valuemin={total > 0 && current != null ? 0 : undefined}
          aria-valuemax={total > 0 && current != null ? total : undefined}
          aria-valuenow={total > 0 && current != null ? current : undefined}
          aria-valuetext={total > 0 && current != null ? currentText : undefined}
          aria-description={currentText}
        >
          <span className={styles.currentFill} />
          {total > 0 && current != null ? <span className={styles.currentMarker} /> : null}
        </div>
        <div
          className={`${styles.track} ${styles.targetTrack}`}
          role={total > 0 ? "progressbar" : "img"}
          aria-label="목표진도"
          aria-valuemin={total > 0 ? 0 : undefined}
          aria-valuemax={total > 0 ? total : undefined}
          aria-valuenow={total > 0 ? target : undefined}
          aria-valuetext={total > 0 ? targetText : undefined}
          aria-description={targetText}
        >
          <span className={styles.targetFill} />
          {total > 0 ? <span className={styles.targetMarker} /> : null}
        </div>
        <div className={`${styles.annotation} ${styles.targetAnnotation}`} title={`기준일 목표 진도 · ${targetLabel}`}>
          <span className={styles.annotationTag}>목표</span>
          <span className={styles.blockName}>{targetLabel}</span>
        </div>
      </div>
      <div className={styles.values} aria-hidden="true">
        <span className={styles.currentValue}>{current == null ? "—" : <><b>{current}</b><small>블록</small></>}</span>
        <span className={styles.targetValue}>{total ? <><b>{target}</b><small>블록</small></> : "—"}</span>
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>시작 0</span>
        {labels.map((block) => <span key={block} className={styles.scaleTick} style={{ left: `${position(block)}%` }}>{block}</span>)}
        <span>{total ? `전체 ${total}블록` : "전체 목표 미설정"}</span>
      </div>
    </div>
  );
}
