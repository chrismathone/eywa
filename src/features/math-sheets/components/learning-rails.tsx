import { useId, type CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type LearningGoal, type LearningProgress, type LearningRecord } from "../lib/learning-plan";
import { LEARNING_LESSON_WIDTH, learningCurrentPosition, learningGoalTicks, learningTopicTicks } from "../lib/learning-axis";
import { learningBlockLabel } from "../lib/learning-label";
import styles from "./learning-rails.module.css";

/** One lesson has the same width everywhere; goals sit on their actual lesson. */
export function LearningRails({ progress, goal, recentBlock, recentGrade, recentRecord }: {
  progress?: LearningProgress;
  goal?: LearningGoal;
  recentBlock?: string | null;
  recentGrade?: string | null;
  recentRecord?: LearningRecord | null;
}) {
  const goalDescriptionId = useId();
  const current = progress?.current ?? null;
  const topicTicks = goal ? learningTopicTicks(goal, progress) : [];
  const stops = goal ? learningGoalTicks(goal, topicTicks) : [];
  const total = topicTicks.length;
  const axisCurrent = goal ? learningCurrentPosition(goal, progress, topicTicks) : null;
  const position = (value: number) => total ? value / total * 100 : 0;
  const currentPosition = position(axisCurrent ?? 0);
  const latestRecord = progress?.latestRecord ?? recentRecord;
  const currentBlock = progress?.currentBlock ?? latestRecord?.progress ?? recentBlock;
  const currentLabel = currentBlock ? learningBlockLabel(currentBlock, goal?.studyGrade ?? recentGrade) : "진도 기록 확인 필요";
  const finalStop = stops.at(-1);
  const finalLabel = finalStop ? learningBlockLabel(finalStop.endBlock, finalStop.studyGrade) : "전체 목표를 설정해 주세요";
  const describeStop = (index: number) => `${index + 1}차 목표 · ${learningBlockLabel(stops[index].endBlock, stops[index].studyGrade)} · ${stops[index].endDate ?? "완료일 미설정"}${stops[index].blockCount == null ? "" : ` · 누적 ${stops[index].blockCount}블록`}`;
  const currentText = axisCurrent == null ? "현재 진도 확인 필요" : `현재 ${axisCurrent} / 전체 ${total}차시 · ${currentLabel}`;
  const goalText = stops.length ? stops.map((_, index) => describeStop(index)).join("; ") : "전체 목표 미설정";
  const variables = { "--current-position": `${currentPosition}%`, "--target-position": `${position(finalStop?.position ?? 0)}%`,
    "--ruler-width": `${total * LEARNING_LESSON_WIDTH}px` } as CSSProperties;
  const carried = Boolean(progress?.currentDate && latestRecord && !progress.currentIsLatest);
  const sourceText = latestRecord
    ? `최근 발송 보고서 · ${latestRecord.date} 수업 · ${latestRecord.progress ? learningBlockLabel(latestRecord.progress, goal?.studyGrade ?? recentGrade) : "진도 입력 없음"}${carried ? ` · 진도선은 ${progress!.currentDate} 마지막 확인 단원 기준` : axisCurrent == null && goal ? " · 단원 위치 확인 필요" : ""}`
    : null;

  const guides = stops.slice(0, -1).map(stop => `M${stop.position / total * 1000} 36v48`).join("");
  return (
    <div className={styles.viewport}>
    <div className={styles.rails} style={variables} data-planned={total > 0}>
      <div className={styles.plot}>
        {total > 0 ? (
          <svg className={styles.ruler} viewBox="0 0 1000 122" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.guides} d={guides} vectorEffect="non-scaling-stroke" />
            <path className={styles.endTicks} d="M0 35v16M1000 35v16M0 69v16M1000 69v16" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
        <div className={`${styles.annotation} ${styles.currentAnnotation}`} title={`현재 진도 · ${currentLabel}${progress?.currentDate ? ` · ${progress.currentDate} 수업보고서 기준` : ""}`}>
          <span className={styles.annotationTag}>{carried ? "마지막 확인" : "현재"}</span><span className={styles.blockName}>{currentLabel}</span>
        </div>
        <div className={`${styles.track} ${styles.currentTrack}`}
          role={total > 0 && axisCurrent != null ? "progressbar" : "img"} aria-label="현재진도"
          aria-valuemin={total > 0 && axisCurrent != null ? 0 : undefined}
          aria-valuemax={total > 0 && axisCurrent != null ? total : undefined}
          aria-valuenow={total > 0 && axisCurrent != null ? axisCurrent : undefined}
          aria-valuetext={total > 0 && axisCurrent != null ? currentText : undefined} aria-description={currentText}>
          <span className={styles.currentFill} />
        </div>
        {total > 0 && axisCurrent != null ? (
          <Tooltip>
            <TooltipTrigger className={styles.currentMarker} delay={0} aria-label="현재 진도 상세"
              aria-describedby={`${goalDescriptionId}-current`} onClick={(event) => event.stopPropagation()} />
            <TooltipContent id={`${goalDescriptionId}-current`} role="tooltip" className={styles.currentTooltip} side="top" sideOffset={10}>
              <div>
                <strong>{carried ? "마지막 확인 진도" : "현재 진도"}</strong>
                <p>{currentLabel}</p>
                <small>기준 수업일 · {progress?.currentDate ?? "날짜 확인 필요"} · 누적 {current}블록</small>
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <div className={`${styles.track} ${styles.targetTrack}`} role="img" aria-label="목표진도" aria-describedby={goalDescriptionId}>
          <span className={styles.targetFill} />
        </div>
        <div role="list" aria-label="세부 차시 눈금">
          {topicTicks.map((tick) => {
            const label = learningBlockLabel(tick.lesson, tick.grade);
            return <span key={`${tick.grade}:${tick.lesson}`} role="listitem" aria-label={label} title={label}
              className={styles.topicTick} data-lesson={tick.lesson} style={{ left: `${position(tick.position)}%` }} />;
          })}
        </div>
        {stops.map((stop, index) => (
          <Tooltip key={index}>
            <TooltipTrigger className={styles.targetMarker} data-goal-number={index + 1}
              data-final={index === stops.length - 1 || undefined} delay={0}
              style={{ left: `${position(stop.position)}%` }} aria-label={`${index + 1}차 목표`}
              aria-describedby={`${goalDescriptionId}-stop-${index}`}
              onClick={(event) => event.stopPropagation()} />
            <TooltipContent id={`${goalDescriptionId}-stop-${index}`} role="tooltip" className={styles.goalTooltip} side="top" sideOffset={10}>
              <div>
                <strong>{index + 1}차 목표</strong>
                <p>{learningBlockLabel(stop.endBlock, stop.studyGrade)}</p>
                <small>{stop.endDate ? `완료 예정 · ${stop.endDate}` : "완료일 미설정"}{stop.blockCount == null ? "" : ` · 누적 ${stop.blockCount}블록`}</small>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        <div className={`${styles.annotation} ${styles.targetAnnotation}`} title={`최종 목표 · ${finalLabel}`}>
          <span className={styles.annotationTag}>{stops.length ? `${stops.length}차 목표` : "목표"}</span>
          <span className={styles.blockName}>{finalLabel}</span>
        </div>
      </div>
      <span id={goalDescriptionId} className={styles.description}>{goalText}</span>
      <div className={styles.values} aria-hidden="true">
        <span className={styles.currentValue}>{axisCurrent == null ? "—" : <><b>{axisCurrent}</b><small>차시</small></>}</span>
        <span className={styles.targetValue}>{stops.length ? <><b>{stops.length}</b><small>차 목표</small></> : "—"}</span>
      </div>
      <div className={styles.scale} aria-label="목표 수직선 눈금">
        <span>0</span>
        {stops.map(stop => <span key={stop.number} className={`${styles.scaleTick} ${styles.goalTick}`}
          style={{ left: `${position(stop.position)}%` }}>{stop.number}차</span>)}
        {!stops.length ? <span className={styles.goalTick}>전체 목표 미설정</span> : null}
      </div>
      {topicTicks.length ? <p className={styles.source}>이전 2학기 + 현재부터 4학기 · 최대 6학기 · 눈금 한 칸 = 세부 차시 1개 · 표시 {topicTicks.length}차시</p> : null}
      {sourceText ? <p className={styles.source}>{sourceText}</p> : null}
    </div>
    </div>
  );
}
