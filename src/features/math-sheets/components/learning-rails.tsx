import { useId, type CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { goalMilestones, type LearningGoal, type LearningProgress, type LearningRecord } from "../lib/learning-plan";
import { LEARNING_LESSON_WIDTH, learningCurrentPosition, learningGoalTicks, learningMilestoneTicks, learningTargetPosition, learningTopicTicks } from "../lib/learning-axis";
import { learningBlockLabel } from "../lib/learning-label";
import styles from "./learning-rails.module.css";

/** Students share a responsive lesson width; goals sit on their actual lesson. */
export function LearningRails({ progress, goal, recentBlock, recentGrade, recentRecord, scaleLessons, selectedPositions, selectedActualPositions, onSelectPosition, onEditGoal }: {
  progress?: LearningProgress;
  goal?: LearningGoal;
  recentBlock?: string | null;
  recentGrade?: string | null;
  recentRecord?: LearningRecord | null;
  scaleLessons?: number;
  selectedPositions?: readonly number[];
  selectedActualPositions?: readonly number[];
  onSelectPosition?: (position: number, date?: string | null, kind?: "current" | "goal" | "history") => void;
  onEditGoal?: (goalNumber: number) => void;
}) {
  const goalDescriptionId = useId();
  const topicTicks = goal ? learningTopicTicks(goal, progress) : [];
  const stops = goal ? learningGoalTicks(goal, topicTicks) : [];
  const goalStops = goal ? learningMilestoneTicks(goal, topicTicks) : [];
  const total = topicTicks.length;
  const targetPosition = goal ? learningTargetPosition(goal, topicTicks) : 0;
  const axisCurrent = goal ? learningCurrentPosition(goal, progress, topicTicks) : null;
  const currentLessons = axisCurrent;
  const targetLessons = goal ? targetPosition : null;
  const pastStops = stops.filter(stop => stop.semesterEndPosition <= (axisCurrent ?? 0)
    && !goalStops.some(goal => goal.position === stop.semesterEndPosition));
  const position = (value: number) => total ? value / total * 100 : 0;
  const currentPosition = position(axisCurrent ?? 0);
  const latestRecord = progress?.latestRecord ?? recentRecord;
  const currentBlock = progress?.currentBlock ?? latestRecord?.progress ?? recentBlock;
  const currentLabel = currentBlock ? learningBlockLabel(currentBlock, goal?.studyGrade ?? recentGrade) : "진도 기록 확인 필요";
  const finalGoalNumber = goal ? goalMilestones(goal).length : 1;
  const finalLabel = goal ? learningBlockLabel(goal.endBlock, goal.endStudyGrade ?? goal.studyGrade) : "전체 목표를 설정해 주세요";
  const currentText = currentLessons == null ? "현재 진도 확인 필요" : `현재 ${currentLessons} / 목표 ${targetLessons}차시 · ${currentLabel}`;
  const goalText = goalStops.length ? goalStops.map(stop => `${stop.goalNumber}차 목표 · ${learningBlockLabel(stop.endBlock, stop.studyGrade)} · ${stop.endDate}`).join("; ") : goal ? `전체 목표 · ${finalLabel} · ${goal.endDate}` : "전체 목표 미설정";
  const variables = { "--current-position": `${currentPosition}%`, "--target-position": `${position(targetPosition)}%`,
    "--lesson-count": total, "--scale-lessons": Math.max(1, total, scaleLessons ?? total),
    "--lesson-max-width": `${LEARNING_LESSON_WIDTH}px` } as CSSProperties;
  const carried = Boolean(progress?.currentDate && latestRecord && !progress.currentIsLatest);
  const sourceText = latestRecord
    ? `최근 발송 보고서 · ${latestRecord.date} 수업 · ${latestRecord.progress ? learningBlockLabel(latestRecord.progress, goal?.studyGrade ?? recentGrade) : "진도 입력 없음"}${carried ? ` · 진도선은 ${progress!.currentDate} 마지막 확인 단원 기준` : axisCurrent == null && goal ? " · 단원 위치 확인 필요" : ""}`
    : null;

  const guides = [...goalStops.map(stop => stop.position), ...pastStops.map(stop => stop.semesterEndPosition)]
    .map(position => `M${position / total * 1000} 36v48`).join("");
  return (
    <div className={styles.viewport}>
    <div className={styles.rails} style={variables} data-planned={total > 0}>
      <div className={styles.plot}>
        {total > 0 ? (
          <svg className={styles.ruler} viewBox="0 0 1000 136" preserveAspectRatio="none" aria-hidden="true">
            <path className={styles.guides} d={guides} vectorEffect="non-scaling-stroke" />
            <path className={styles.endTicks} d="M0 35v16M1000 35v16M0 69v16M1000 69v16" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
        <div className={`${styles.annotation} ${styles.currentAnnotation}`} title={sourceText ?? `현재 진도 · ${currentLabel}${progress?.currentDate ? ` · ${progress.currentDate} 수업보고서 기준` : ""}`}>
          <span className={styles.annotationTag}>{carried ? "마지막 확인" : "현재"}</span><span className={styles.blockName}>{currentLabel}</span>
        </div>
        <div className={`${styles.track} ${styles.currentTrack}`}
          role={total > 0 && currentLessons != null ? "progressbar" : "img"} aria-label="현재진도"
          aria-valuemin={total > 0 && currentLessons != null ? 0 : undefined}
          aria-valuemax={total > 0 && currentLessons != null ? total : undefined}
          aria-valuenow={total > 0 && currentLessons != null ? currentLessons : undefined}
          aria-valuetext={total > 0 && currentLessons != null ? currentText : undefined} aria-description={currentText}>
          <span className={styles.currentFill} />
        </div>
        {total > 0 && axisCurrent != null ? (
          <Tooltip>
            <TooltipTrigger className={styles.currentMarker} delay={0} aria-label="현재 진도 상세"
              aria-describedby={`${goalDescriptionId}-current`} onClick={(event) => { event.stopPropagation(); onSelectPosition?.(axisCurrent, progress?.currentDate, "current"); }} />
            <TooltipContent id={`${goalDescriptionId}-current`} role="tooltip" className={styles.currentTooltip} side="top" sideOffset={10}>
              <div>
                <strong>{carried ? "마지막 확인 진도" : "현재 진도"}</strong>
                <p>{currentLabel}</p>
                <small>기준 수업일 · {progress?.currentDate ?? "날짜 확인 필요"} · {currentLessons ?? "—"} / {targetLessons ?? "—"}차시</small>
                {sourceText ? <p className={styles.reportSource}>{sourceText}</p> : null}
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
            const description = `${label}${tick.date ? ` · ${tick.estimated ? "추정" : "수업보고서"} ${tick.date}` : ""}`;
            return <span key={`${tick.grade}:${tick.lesson}`} role="listitem" aria-label={description} title={description}
              className={styles.topicTick} data-lesson={tick.lesson} data-selected={selectedPositions?.includes(tick.position) || undefined}
              data-actual-selected={selectedActualPositions?.includes(tick.position) || undefined}
              style={{ left: `${position(tick.position)}%` }}>
              {onSelectPosition ? <button className={styles.topicHit} aria-label={`${label} 진도맵에서 보기`}
                onClick={event => { event.stopPropagation(); onSelectPosition(tick.position); }} /> : null}
            </span>;
          })}
        </div>
        {goalStops.map((stop, index) => (
          <Tooltip key={index}>
            <TooltipTrigger className={styles.targetMarker} data-goal-number={stop.goalNumber}
              data-final={index === goalStops.length - 1 || undefined} delay={0}
              style={{ left: `${position(stop.position)}%` }} aria-label={`${stop.goalNumber}차 목표`}
              aria-describedby={`${goalDescriptionId}-stop-${index}`}
              data-editable={Boolean(onEditGoal) || undefined}
              onClick={(event) => { event.stopPropagation(); if (onEditGoal) onEditGoal(stop.goalNumber); else onSelectPosition?.(stop.position, stop.endDate, "goal"); }} />
            <TooltipContent id={`${goalDescriptionId}-stop-${index}`} role="tooltip" className={styles.goalTooltip} side="top" sideOffset={10}>
              <div>
                <strong>{stop.goalNumber}차 목표</strong>
                <p>{learningBlockLabel(stop.endBlock, stop.studyGrade)}</p>
                <small>{stop.endDate ? `완료 예정 · ${stop.endDate}` : "완료일 미설정"} · 누적 {stop.blockCount}블록</small>
                {onEditGoal ? <p>클릭하여 남은 계획 수정</p> : null}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        {pastStops.map(stop => (
          <Tooltip key={`semester-${stop.number}`}>
            <TooltipTrigger className={styles.targetMarker} data-semester-end={stop.number} delay={0}
              style={{ left: `${position(stop.semesterEndPosition)}%` }} aria-label={`${stop.studyGrade} ${stop.semester}학기 진도`}
              onClick={event => { event.stopPropagation(); onSelectPosition?.(stop.semesterEndPosition, stop.observedDate, "history"); }} />
            <TooltipContent role="tooltip" className={styles.goalTooltip} side="top" sideOffset={10}>
              <div>
                <strong>{stop.studyGrade} {stop.semester}학기</strong>
                <p>{learningBlockLabel(topicTicks[stop.semesterEndPosition - 1].lesson, stop.studyGrade)}</p>
                <small>{stop.observedDate ? `${stop.estimated ? "추정 수업일" : "수업보고서"} · ${stop.observedDate}` : "학기 종료일 확인 필요"}</small>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        <div className={styles.scale} aria-label="목표 수직선 눈금">
          {stops.map(stop => <span key={stop.number} className={styles.scaleTick}
            title={stop.observedDate ? `${stop.estimated ? "추정" : "수업보고서"} ${stop.observedDate}` : undefined}
            style={{ left: `${position(stop.semesterEndPosition)}%` }}><span>{stop.studyGrade}</span>{" "}<span>{stop.semester}학기</span></span>)}
        </div>
        <div className={`${styles.annotation} ${styles.targetAnnotation}`} title={`최종 목표 · ${finalLabel}`}>
          <span className={styles.annotationTag}>{goal ? `${finalGoalNumber}차 목표` : "목표"}</span>
          <span className={styles.blockName}>{finalLabel}</span>
          {onEditGoal ? <button type="button" className={styles.editGoalHit} aria-label={`${finalGoalNumber}차 목표 남은 계획 수정`}
            onClick={event => { event.stopPropagation(); onEditGoal(finalGoalNumber); }} /> : null}
        </div>
      </div>
      <span id={goalDescriptionId} className={styles.description}>{goalText}</span>
      <div className={styles.values} aria-hidden="true">
        <span className={styles.currentValue}>{currentLessons == null ? "—" : <><b>{currentLessons}</b><small>차시</small></>}</span>
        <span className={styles.targetValue}>{targetLessons == null ? "—" : <><b>{targetLessons}</b><small>차시 목표</small></>}</span>
      </div>
    </div>
    </div>
  );
}
