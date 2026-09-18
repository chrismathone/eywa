"use client";

import { useEffect, useMemo, useState } from "react";
import { EmbedLink } from "@/components/embed-link";
import { LearningRails } from "@/features/math-sheets/components/learning-rails";
import { learningStatusLabel, type LearningGoal, type LearningProgress, type LearningRecord } from "@/features/math-sheets/lib/learning-plan";
import { learningBlockLabel } from "@/features/math-sheets/lib/learning-label";
import { goalMilestones } from "@/features/math-sheets/lib/learning-plan";
import { learningTimelineTopicIndex } from "@/features/math-sheets/lib/learning-path";
import { arcPath, polar, strokeArcPath, CX, CY } from "../geometry";
import { buildLearningMap, learningSheetHref, lessonsInPeriod, mapChildren, mapPeriod, periodMetrics, readMapSelection,
  type LearningMap, type LearningMapLesson, type MapMode, type MapPeriod, type MapSelection } from "../learning-map";
import styles from "./linked-learning-map.module.css";

type Props = {
  student: { studentId: string; name: string; school: string | null; grade: string | null };
  classId: string; className: string; month: string;
  goal: LearningGoal; progress: LearningProgress; records: LearningRecord[];
  initialQuery?: string;
};
const MODES: [MapMode, string][] = [["year", "연간"], ["quarter", "분기"], ["month", "월간"], ["week", "주간"], ["day", "일간"]];

export function LinkedLearningMap({ student, classId, className, month, goal, progress, records, initialQuery = "" }: Props) {
  const map = useMemo(() => buildLearningMap(goal, progress), [goal, progress]);
  const [selection, setSelection] = useState(() => readMapSelection(new URLSearchParams(initialQuery), map));
  useEffect(() => {
    const back = () => setSelection(readMapSelection(new URLSearchParams(window.location.search), map));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [map]);
  const select = (patch: Partial<MapSelection>) => {
    const next = { ...selection, lesson: null, undated: false, ...patch };
    const url = new URL(window.location.href);
    url.searchParams.set("date", next.date);
    url.searchParams.set("view", next.mode);
    const topic = map.lessons.find(lesson => lesson.position === next.lesson);
    if (topic) url.searchParams.set("topic", `${topic.grade}:${topic.lesson}`); else url.searchParams.delete("topic");
    url.searchParams.delete("lesson");
    if (next.undated) url.searchParams.set("undated", "1"); else url.searchParams.delete("undated");
    window.history.pushState(null, "", url);
    setSelection(next);
  };
  const period = mapPeriod(selection);
  const selectedLessons = lessonsInPeriod(map, period, selection.undated);
  const activeLesson = map.lessons.find(lesson => lesson.position === selection.lesson);
  const undated = map.lessons.filter(lesson => lesson.inGoal && !lesson.calendarDate);
  const metrics = map.metrics;
  const periodRecords = records.filter(record => record.date >= period.from && record.date <= period.to);
  const timelinePeriods = selection.mode === "year"
    ? Array.from({ length: 12 }, (_, index) => mapPeriod({ date: `${selection.date.slice(0, 4)}-${String(index + 1).padStart(2, "0")}-01`, mode: "month" }))
    : mapChildren(period);
  const openLesson = (lesson: LearningMapLesson, date = lesson.calendarDate) => select({ lesson: lesson.position,
    ...(date ? { date, mode: "day" } : { undated: true }) });
  const periodTitle = selection.undated ? "날짜 미확정" : period.label;
  return <div className={styles.root}>
    <header className={styles.header}>
      <div><h2>{student.name} <span>학습 진도맵</span></h2><p>{student.school} {student.grade} · {className}</p></div>
      <div className={styles.overall} aria-label="전체 진도율"><span>전체 진도</span><strong>{metrics.percent == null ? "—" : `${metrics.percent}%`}</strong><span>{metrics.current ?? "—"} / {metrics.total}차시</span></div>
      <div className={styles.status}><strong>{learningStatusLabel(metrics, "차시")}</strong><span>기준일 계획 {metrics.target}차시</span></div>
      <div className={styles.status}><strong>수업당 {metrics.requiredPace == null ? "—" : `${metrics.requiredPace.toFixed(1)}차시`}</strong><span>남은 수업 {metrics.remainingDays}회</span></div>
      <EmbedLink href={learningSheetHref(classId, student.studentId, month)} className={styles.back}>MCS로 돌아가기</EmbedLink>
    </header>
    <section className={styles.rail} aria-label="MCS 연동 진도">
      <div className={styles.railTitle}><span>전체 목표 · {learningBlockLabel(goal.endBlock, goal.endStudyGrade ?? goal.studyGrade)}</span><time>{map.referenceDate} 기준</time></div>
      <LearningRails goal={goal} progress={progress}
        selectedPositions={activeLesson ? [activeLesson.position] : selectedLessons.map(lesson => lesson.position)}
        selectedActualPositions={activeLesson ? [activeLesson.position] : map.lessons.filter(lesson => !selection.undated && lesson.date && lesson.date >= period.from && lesson.date <= period.to).map(lesson => lesson.position)}
        onSelectPosition={(position, date, kind) => {
          const lesson = map.lessons[position - 1];
          if (lesson && kind === "goal" && date) select({ date, mode: "month", lesson: position });
          else if (lesson) openLesson(lesson, date ?? lesson.calendarDate);
        }} />
    </section>
    <nav className={styles.controls} aria-label="진도맵 기간 선택">
      <label>연도 <select aria-label="진도맵 연도" value={selection.date.slice(0, 4)} onChange={event => select({ date: `${event.target.value}-01-01` })}>
        {map.years.map(year => <option key={year} value={year}>{year}년</option>)}
      </select></label>
      <div>{MODES.map(([mode, label]) => <button key={mode} aria-pressed={!selection.undated && selection.mode === mode} onClick={() => select({ mode })}>{label}</button>)}</div>
      <label>날짜 <input type="date" aria-label="진도맵 날짜" value={selection.date} min={`${map.years[0]}-01-01`} max={`${map.years.at(-1)}-12-31`}
        onChange={event => {
          const parsed = readMapSelection(new URLSearchParams({ date: event.target.value, view: "day" }), map);
          select(parsed);
        }} /></label>
      <button onClick={() => select({ date: map.referenceDate, mode: "year" })}>기준일로</button>
      {undated.length ? <button aria-pressed={selection.undated} onClick={() => select({ undated: true })}>날짜 미확정 {undated.length}차시</button> : null}
    </nav>
    <div className={styles.grid}>
      <section className={styles.dialPanel} aria-label="기간별 진도맵">
        <div className={styles.panelHeading}><h3>{periodTitle} 진도</h3><span className={styles.legend}>파랑 진행 · 빨강 도달</span></div>
        <LearningDial map={map} period={period} lessons={selectedLessons} undated={selection.undated}
          onSelect={next => select({ date: next.from, mode: next.mode })} />
        <p className={styles.periodCaption}>{periodTitle}에 배치된 목표 차시의 도달률</p>
        <div className={styles.periodList}>
          {!selection.undated && mapChildren(period).map(child => {
            const count = periodMetrics(lessonsInPeriod(map, child), metrics.current != null);
            return <button key={child.from} onClick={() => select({ date: child.from, mode: child.mode })}>
              <span>{child.label}</span><strong>{count.current ?? "—"} / {count.total}차시</strong>
            </button>;
          })}
        </div>
      </section>
      <section className={styles.detailPanel} aria-label="선택한 진도 상세">
        <div className={styles.panelHeading}><h3>{activeLesson?.label ?? `${periodTitle} 학습 차시`}</h3><span>{selectedLessons.length}차시</span></div>
        {activeLesson ? <div className={styles.lessonDetail} aria-live="polite">
          <strong>{activeLesson.position}번째 눈금 · {activeLesson.reached == null ? "진도 확인 필요" : activeLesson.reached ? "현재 진도 도달 구간" : "앞으로 학습"}</strong>
          <p>계획일 {activeLesson.plannedDate ?? "미설정"}</p>
          <p>{activeLesson.date ? `${activeLesson.estimated ? "추정 수업일" : "수업보고서 확인일"} ${activeLesson.date}` : "수업일 확인 필요"}</p>
          {activeLesson.date ? <button onClick={() => openLesson(activeLesson, activeLesson.date)}>수업일 보기</button> : null}
          {activeLesson.plannedDate ? <button onClick={() => openLesson(activeLesson, activeLesson.plannedDate)}>계획일 보기</button> : null}
        </div> : null}
        {!selection.undated && !activeLesson && timelinePeriods.length ? <div className={styles.months}>
          {timelinePeriods.map(child => {
            const lessons = lessonsInPeriod(map, child);
            const count = periodMetrics(lessons, metrics.current != null);
            const observed = map.lessons.filter(lesson => lesson.date && lesson.date >= child.from && lesson.date <= child.to);
            const reportCount = records.filter(record => record.date >= child.from && record.date <= child.to).length;
            if (!lessons.length && !observed.length && !reportCount) return null;
            const title = lessons.length ? `${lessons[0].label}${lessons.length > 1 ? ` ~ ${lessons.at(-1)!.label}` : ""}`
              : observed.at(-1)?.label ?? "수업보고서 확인";
            return <button key={child.from} onClick={() => select({ date: child.from, mode: child.mode })}>
              <time>{child.label.replace(/^\d{4}년 /, "")}</time>
              <span><strong>{title}</strong><small>{lessons.length ? `${count.current ?? "—"} / ${count.total}차시 도달` : "배치된 목표 없음"}{reportCount ? ` · 발송 보고서 ${reportCount}건` : ""}</small></span>
              <span className={styles.monthRate} data-completed={count.percent === 100}>{count.percent == null ? "—" : `${count.percent}%`}<i><b style={{ width: `${count.percent ?? 0}%` }} /></i></span>
            </button>;
          })}
          {!selectedLessons.length && !periodRecords.length ? <p className={styles.empty}>이 기간에 배치된 목표 차시가 없습니다.</p> : null}
        </div> : <div className={styles.lessons}>
          {selectedLessons.length ? selectedLessons.map(lesson => <button key={lesson.position} data-lesson-row={lesson.position}
            aria-pressed={selection.lesson === lesson.position} onClick={() => openLesson(lesson)}>
            <span className={styles.lessonDot} data-reached={lesson.reached} />
            <span><strong>{lesson.label}</strong><small>{lesson.plannedDate ? `계획 ${lesson.plannedDate}` : lesson.date ? `${lesson.estimated ? "추정" : "확인"} ${lesson.date}` : "날짜 미확정"}</small></span>
            <span>{lesson.reached == null ? "확인 필요" : lesson.reached ? "도달" : "예정"}</span>
          </button>) : <p className={styles.empty}>{selection.undated ? "날짜 미확정 차시가 없습니다." : "이 기간에 배치된 목표 차시가 없습니다."}</p>}
        </div>}
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
    </div>
    <section className={styles.milestones} aria-label="학습 목표 일정">
      <div><h3>학습 목표</h3><p>{progress.history?.enrolledAt ? `${progress.history.enrolledAt} 등록` : "등록일 미확인"}</p></div>
      {goalMilestones(goal).map((stop, index) => {
        const lesson = map.lessons.find(lesson => lesson.grade === stop.studyGrade && lesson.lesson === stop.endBlock);
        return <button key={`${stop.studyGrade}:${stop.endBlock}`} onClick={() => select({ date: stop.endDate, mode: "month", lesson: lesson?.position ?? null })}>
          <time>{stop.endDate}</time><strong>{index + 1}차 목표 · {learningBlockLabel(stop.endBlock, stop.studyGrade)}</strong>
        </button>;
      })}
    </section>
  </div>;
}

function LearningDial({ map, period, lessons, undated, onSelect }: {
  map: LearningMap; period: MapPeriod; lessons: LearningMapLesson[]; undated: boolean; onSelect: (period: MapPeriod) => void;
}) {
  const summary = periodMetrics(lessons, map.metrics.current != null);
  const children = undated ? [] : mapChildren(period);
  const segments = children.length ? children : [period];
  return <svg className={styles.dial} viewBox="0 0 1100 1100" role="group" aria-label={`${undated ? "날짜 미확정" : period.label} 차시 진도`}>
    {segments.map((child, index) => {
      const count = children.length ? periodMetrics(lessonsInPeriod(map, child), map.metrics.current != null) : summary;
      const start = index / segments.length * 360 + 1, end = (index + 1) / segments.length * 360 - 1;
      const label = polar(387, (start + end) / 2);
      const completed = count.percent === 100;
      return <g key={child.from} role={children.length ? "button" : undefined} tabIndex={children.length ? 0 : undefined}
        aria-label={`${child.label} · ${count.current ?? "확인 필요"} / ${count.total}차시`}
        onClick={() => children.length && onSelect(child)} onKeyDown={event => {
          if (children.length && ["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(child); }
        }} className={styles.sector} data-completed={completed}>
        <title>{child.label} · {count.percent == null ? "진도 확인 필요" : `${count.percent}%`} · {count.current ?? "—"} / {count.total}차시</title>
        <path d={arcPath(294, 477, start, end)} className={styles.sectorBase} />
        <path d={strokeArcPath(486, start, end)} className={styles.sectorTrack} />
        {count.percent != null && count.percent > 0 ? <path d={strokeArcPath(486, start, start + (end - start) * count.percent / 100)} className={styles.sectorFill} /> : null}
        <text x={label.x} y={label.y - 7} textAnchor="middle" className={styles.sectorLabel}>{children.length ? child.label.replace(/^\d{4}년 /, "") : "선택 구간"}</text>
        <text x={label.x} y={label.y + 30} textAnchor="middle" className={styles.sectorRate}>{count.percent == null ? "—" : `${count.percent}%`}</text>
      </g>;
    })}
    <circle cx={CX} cy={CY} r={263} className={styles.centerTrack} />
    {summary.percent != null && summary.percent > 0 ? <path d={strokeArcPath(263, 0, 360 * summary.percent / 100)} className={styles.centerFill} data-completed={summary.percent === 100} /> : null}
    <text x={CX} y={CY - 78} textAnchor="middle" className={styles.centerTitle}>{undated ? "날짜 미확정" : period.label}</text>
    <text x={CX} y={CY + 24} textAnchor="middle" className={styles.centerPercent}>{summary.percent == null ? "—" : `${summary.percent}%`}</text>
    <text x={CX} y={CY + 88} textAnchor="middle" className={styles.centerCount}>{summary.current ?? "—"} / {summary.total}차시</text>
  </svg>;
}
