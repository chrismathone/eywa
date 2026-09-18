"use client";

import { useMemo } from "react";
import { EmbedLink } from "@/components/embed-link";
import { LearningRails } from "@/features/math-sheets/components/learning-rails";
import { learningStatusLabel, type LearningGoal, type LearningProgress, type LearningRecord } from "@/features/math-sheets/lib/learning-plan";
import { learningBlockLabel } from "@/features/math-sheets/lib/learning-label";
import { learningTimelineTopicIndex } from "@/features/math-sheets/lib/learning-path";
import { buildLearningMap, learningSheetHref, lessonsInPeriod, mapPeriod, type LearningMapLesson } from "../learning-map";
import { buildLearningDashboard } from "../learning-dashboard";
import { ProgressMapSnapshot } from "./map-state";
import { useLinkedMapState } from "./linked-map-state";
import { PeriodSelector } from "./period-selector";
import { ProgressMapPanel } from "./progress-map-panel";
import { CurriculumTimelineCard } from "./timeline/curriculum-timeline-card";
import { LinkedCurriculumPosition, LinkedPlanVsActual } from "./linked-learning-panels";
import mapStyles from "./progress-map.module.css";
import styles from "./linked-learning-map.module.css";

type Props = {
  student: { studentId: string; name: string; school: string | null; grade: string | null };
  classId: string; className: string; month: string;
  goal: LearningGoal; progress: LearningProgress; records: LearningRecord[];
  initialQuery?: string;
};

export function LinkedLearningMap({ student, classId, className, month, goal, progress, records, initialQuery = "" }: Props) {
  const map = useMemo(() => buildLearningMap(goal, progress), [goal, progress]);
  const dashboard = useMemo(() => buildLearningDashboard(student, goal, progress, records, map), [student, goal, progress, records, map]);
  const { selection, select, state } = useLinkedMapState(dashboard, map, initialQuery);
  const period = mapPeriod(selection);
  const selectedLessons = lessonsInPeriod(map, period, selection.undated);
  const activeLesson = map.lessons.find(lesson => lesson.position === selection.lesson);
  const undated = map.lessons.filter(lesson => lesson.inGoal && !lesson.calendarDate);
  const metrics = map.metrics;
  const periodRecords = records.filter(record => record.date >= period.from && record.date <= period.to);
  const openLesson = (lesson: LearningMapLesson, date = lesson.calendarDate) => select({ lesson: lesson.position,
    ...(date ? { date, mode: "day" } : { undated: true }) });
  return <ProgressMapSnapshot value={state}><div className={`${styles.root} ${mapStyles.selectionTheme}`} data-linked-learning-map>
    <header className={styles.header}>
      <div><h2>{student.name} <span>학습 진도맵</span></h2><p>{student.school} {student.grade} · {className}</p></div>
      <div className={styles.overall} aria-label="전체 진도율"><span>전체 진도</span><strong>{metrics.percent == null ? "—" : `${metrics.percent}%`}</strong><span>{metrics.current ?? "—"} / {metrics.total}차시</span></div>
      <div className={styles.status}><strong>{learningStatusLabel(metrics, "차시")}</strong><span>기준일 계획 {metrics.target}차시</span></div>
      <div className={styles.status}><strong>수업당 {metrics.requiredPace == null ? "—" : `${metrics.requiredPace.toFixed(1)}차시`}</strong><span>남은 수업 {metrics.remainingDays}회</span></div>
      <EmbedLink href={learningSheetHref(classId, student.studentId, month)} className={styles.back}>MCS로 돌아가기</EmbedLink>
    </header>
    <section className={styles.rail} aria-label="MCS 학습 진도">
      <div className={styles.railTitle}><span>전체 목표 · {learningBlockLabel(goal.endBlock, goal.endStudyGrade ?? goal.studyGrade)}</span><time>{map.referenceDate} 기준</time></div>
      <LearningRails goal={goal} progress={progress} recentRecord={records.at(-1)}
        selectedPositions={activeLesson ? [activeLesson.position] : selectedLessons.map(lesson => lesson.position)}
        selectedActualPositions={activeLesson ? [activeLesson.position] : map.lessons.filter(lesson => !selection.undated && lesson.date && lesson.date >= period.from && lesson.date <= period.to).map(lesson => lesson.position)}
        onSelectPosition={(position, date, kind) => {
          const lesson = map.lessons.find(item => item.position === position);
          if (kind === "goal") select({ date: date ?? selection.date, mode: "month", lesson: lesson?.position ?? null });
          else if (lesson) openLesson(lesson, date ?? lesson.calendarDate);
        }} />
    </section>
    <div className={styles.periodControls}><PeriodSelector />
      <div className={styles.controls}>
        <label>날짜 <input type="date" aria-label="진도맵 날짜" value={selection.date} min={`${map.years[0]}-01-01`} max={`${map.years.at(-1)}-12-31`}
          onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) select({ date: event.target.value, mode: "day" }); }} /></label>
        <button onClick={() => select({ date: map.referenceDate, mode: "year" })}>기준일로</button>
        {undated.length ? <button aria-pressed={selection.undated} onClick={() => select({ undated: !selection.undated })}>날짜 미확정 {undated.length}차시</button> : null}
      </div>
    </div>
    <div className={styles.dashboardGrid}><ProgressMapPanel /><CurriculumTimelineCard /></div>
    <div className={styles.bottomGrid}>
      <LinkedPlanVsActual onLesson={openLesson} />
      <LinkedCurriculumPosition goal={goal} progress={progress} onLesson={openLesson} onSelectGoal={(date, lesson) => select({ date, mode: "month", lesson })} />
    </div>
    <section className={styles.detailPanel} aria-label="선택한 진도 상세">
      <div className={styles.panelHeading}><h3>{activeLesson?.label ?? `${selection.undated ? "날짜 미확정" : period.label} 학습 차시`}</h3><span>{selectedLessons.length}차시</span></div>
      {activeLesson ? <div className={styles.lessonDetail} aria-live="polite">
        <strong>{activeLesson.position}번째 눈금 · {activeLesson.reached == null ? "진도 확인 필요" : activeLesson.reached ? "현재 진도 도달 구간" : "앞으로 학습"}</strong>
        <p>계획일 {activeLesson.plannedDate ?? "미설정"}</p>
        <p>{activeLesson.date ? `${activeLesson.estimated ? "추정 수업일" : "수업보고서 확인일"} ${activeLesson.date}` : "수업일 확인 필요"}</p>
        {activeLesson.date ? <button onClick={() => openLesson(activeLesson, activeLesson.date)}>수업일 보기</button> : null}
        {activeLesson.plannedDate ? <button onClick={() => openLesson(activeLesson, activeLesson.plannedDate)}>계획일 보기</button> : null}
      </div> : null}
      <details open={selection.undated || selection.mode === "day"} className={styles.lessonList}>
        <summary>세부 차시 {selectedLessons.length}개</summary>
        <div className={styles.lessons}>
          {selectedLessons.length ? selectedLessons.map(lesson => <button key={lesson.position} data-lesson-row={lesson.position}
            aria-pressed={selection.lesson === lesson.position} onClick={() => openLesson(lesson)}>
            <span className={styles.lessonDot} data-reached={lesson.reached} />
            <span><strong>{lesson.label}</strong><small>{lesson.plannedDate ? `계획 ${lesson.plannedDate}` : lesson.date ? `${lesson.estimated ? "추정" : "확인"} ${lesson.date}` : "날짜 미확정"}</small></span>
            <span>{lesson.reached == null ? "확인 필요" : lesson.reached ? "도달" : "예정"}</span>
          </button>) : <p className={styles.empty}>이 기간에 배치된 목표 차시가 없습니다.</p>}
        </div>
      </details>
      {!selection.undated ? <details className={styles.records} open={selection.mode === "day"}>
        <summary>발송 수업보고서 {periodRecords.length}건</summary>
        {periodRecords.length ? periodRecords.map((record, index) => <article key={`${record.date}:${index}`}>
          <button onClick={() => {
            const index = learningTimelineTopicIndex(record.progress, goal, map.lessons);
            select({ date: record.date, mode: "day", lesson: index == null ? null : map.lessons[index].position });
          }}><time>{record.date}</time></button>
          <strong>{record.progress ? learningBlockLabel(record.progress, goal.studyGrade) : "진도 입력 없음"}</strong>
          {record.textbook ? <p>{record.textbook}</p> : null}{record.homework ? <p>과제: {record.homework}</p> : null}
        </article>) : <p>이 반에서 발송된 보고서가 없습니다.</p>}
      </details> : null}
    </section>
  </div></ProgressMapSnapshot>;
}
