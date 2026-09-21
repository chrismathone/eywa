"use client";

import { goalMilestones, learningStatusLabel, type LearningGoal, type LearningProgress } from "@/features/math-sheets/lib/learning-plan";
import { learningBlockLabel } from "@/features/math-sheets/lib/learning-label";
import type { LearningMapLesson } from "../learning-map";
import { semesterLabel, unitOfLesson } from "../learning-dashboard";
import { CurriculumCarousel } from "./curriculum-carousel";
import { useProgressMap } from "./map-state";
import styles from "./linked-learning-map.module.css";

type OpenLesson = (lesson: LearningMapLesson, date?: string | null) => void;

export function LinkedPlanVsActual({ onLesson }: { onLesson: OpenLesson }) {
  const { sourceProgress } = useProgressMap();
  const { metrics, lessons } = sourceProgress.learningMap!;
  const planned = lessons.find(lesson => lesson.position === metrics.target);
  const actual = lessons.find(lesson => lesson.position === metrics.current);
  // 레일은 등록 이후 첫 기록부터라 계획 위치가 그보다 앞일 수 있다 — 그때는 '계획 시작 전'이 아니고, 0차시 숫자·0% 마커도 거짓이다.
  const planBeforeRail = metrics.targetBeforeRail;
  const pct = (position: number) => `${Math.min(100, Math.max(0, position / Math.max(1, metrics.total) * 100))}%`;
  return <section className={styles.bottomPanel} aria-label="계획 대비 실제">
    <div className={styles.bottomHeading}><h3>계획 대비 실제</h3><strong>{learningStatusLabel(metrics, "차시")}</strong></div>
    <div className={styles.comparison}>
      <button disabled={!planned} onClick={() => planned && onLesson(planned)}><span>계획 위치</span><strong>{planned?.label ?? (planBeforeRail ? "첫 기록보다 앞" : "계획 시작 전")}</strong><b>{planBeforeRail ? "—" : `${metrics.target}차시`}</b></button>
      <button disabled={!actual} onClick={() => actual && onLesson(actual, actual.date)}><span>실제 위치</span><strong>{actual?.label ?? "진도 확인 필요"}</strong><b>{metrics.current ?? "—"}차시</b></button>
    </div>
    <div className={styles.comparisonTrack}>
      <span style={{ width: pct(metrics.current ?? 0) }} />
      {planBeforeRail ? null : <button className={styles.plannedMarker} style={{ left: pct(metrics.target) }} aria-label={`계획 위치 ${metrics.target}차시`} disabled={!planned} onClick={() => planned && onLesson(planned)} />}
      {actual ? <button className={styles.actualMarker} style={{ left: pct(actual.position) }} aria-label={`실제 위치 ${actual.position}차시`} onClick={() => onLesson(actual, actual.date)} /> : null}
    </div>
    <div className={styles.comparisonScale}><span>0차시</span><span>전체 목표 {metrics.total}차시</span></div>
    <p className={styles.comparisonDates}>{sourceProgress.asOf} 기준 · 남은 수업 {metrics.remainingDays}회 · 수업당 {metrics.requiredPace == null ? "—" : metrics.requiredPace.toFixed(1)}차시</p>
  </section>;
}

export function LinkedCurriculumPosition({ goal, progress, onLesson, onSelectGoal }: {
  goal: LearningGoal; progress: LearningProgress; onLesson: OpenLesson; onSelectGoal: (date: string, lesson: number | null) => void;
}) {
  const { sourceProgress } = useProgressMap();
  const { metrics, lessons } = sourceProgress.learningMap!;
  const actual = lessons.find(lesson => lesson.position === metrics.current);
  const next = actual ? lessons.find(lesson => lesson.position > actual.position && lesson.inGoal && (lesson.grade !== actual.grade || unitOfLesson(lesson) !== unitOfLesson(actual))) : null;
  const stops = goalMilestones(goal);
  return <section className={`${styles.bottomPanel} ${styles.mcsTones}`} aria-label="입학부터 종강까지">
    <div className={styles.bottomHeading}><h3>입학부터 종강까지</h3>
      <span>{progress.history?.enrolledAt ? `${progress.history.enrolledAt} 등록` : "등록일 미확인"} → <button onClick={() => onSelectGoal(goal.endDate, metrics.total)}>{goal.endDate} 목표</button></span>
    </div>
    <CurriculumCarousel steps={sourceProgress.roadmap?.steps ?? []} />
    <div className={styles.currentNext}>
      <div><span>지금 학습</span>{actual ? <button onClick={() => onLesson(actual, actual.date)}><strong>{actual.label}</strong><small>{actual.date ? `${actual.estimated ? "추정" : "마지막 확인"} ${actual.date}` : "수업일 확인 필요"} · {actual.position} / {metrics.total}차시</small></button> : <strong>진도 확인 필요</strong>}</div>
      <div><span>다음 단원</span>{next ? <button onClick={() => onLesson(next)}><strong>{semesterLabel(next)}, {unitOfLesson(next)}</strong><small>{next.plannedDate ? `계획 ${next.plannedDate}` : "계획일 미확정"}</small></button> : <strong>{actual ? "마지막 목표 단원" : "진도 확인 필요"}</strong>}</div>
    </div>
    <details className={styles.goalList}><summary>학습 목표 {stops.length}개</summary>{stops.map((stop, index) => {
      const lesson = lessons.find(lesson => lesson.grade === stop.studyGrade && lesson.lesson === stop.endBlock);
      return <button key={`${index}:${stop.endDate}`} onClick={() => onSelectGoal(stop.endDate, lesson?.position ?? null)}><time>{stop.endDate}</time><strong>{index + 1}차 목표 · {learningBlockLabel(stop.endBlock, stop.studyGrade)}</strong></button>;
    })}</details>
  </section>;
}
