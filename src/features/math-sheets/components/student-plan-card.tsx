"use client";

import type { ReactNode } from "react";
import type { MathStudentRow } from "../server/month-queries";
import { learningStatusLabel, type LearningGoal, type LearningProgress } from "../lib/learning-plan";
import type { LearningRailMetrics } from "../lib/learning-axis";
import { courseRangeLabel } from "../lib/learning-path";
import { learningBlockLabel } from "../lib/learning-label";
import { useMathTextbooks } from "./math-textbook-context";
import { StudentTextbookChip } from "./math-textbook-assign";
import { BookSection, SHOW_BOOK_PLAN, TodaySection } from "./plan-card-sections";
import css from "./plan-card.module.css";

const pct = (n: number, total: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, total)) * 100))}%`;

/**
 * 학생 계획 카드 — 전체 목표 / 교재 3개월 / 오늘 기준 세 구역(원장 2026-10-20 *"디자인을 저런느낌으로"*, 카드 시안).
 * 🔑 계획보다 밀린 만큼은 **빨간 빗금**(원장 *"밀린 차시만큼 되는건 붉은색계열로"*) — 막대·교재 타일이 같은 표시를 쓴다.
 * 판정은 서버·순수 함수가 끝낸 값(`LearningRailMetrics`, `BookWindow`)만 읽는다.
 */
export function StudentPlanCard({ student, goal, progress, summary, onOpen }: {
  student: MathStudentRow;
  goal?: LearningGoal;
  progress?: LearningProgress;
  summary?: LearningRailMetrics;
  onOpen: () => void;
}) {
  const w = useMathTextbooks()?.windows[student.studentId];
  const tone = student.rosterPhase !== "on" ? undefined : summary?.status;
  const badge = student.rosterPhase === "ended" ? "수강 종료"
    : student.rosterPhase === "upcoming" ? "수강 예정"
    : summary ? `전체 계획 · ${learningStatusLabel(summary, "차시")}` : "전체 목표 미설정";
  return (
    <article className={css.card} data-ended={student.rosterPhase === "ended" || undefined} aria-label={`${student.name} 진도`}>
      <header className={css.top}>
        <div className={css.who}>
          <button type="button" className={css.name} onClick={onOpen}>{student.name}</button>
          <span className={css.meta}>{[student.school, student.grade].filter(Boolean).join(" ")}</span>
          <StudentTextbookChip studentId={student.studentId} studentName={student.name} />
        </div>
        <span className={css.badge} data-tone={tone}>{badge}</span>
      </header>
      <Section title="전체 목표" hint="과정 전체에서 어디까지 갈지">
        <GoalBody goal={goal} progress={progress} summary={summary} />
      </Section>
      <Section title="교재 3개월" hint="주문일 +7일부터 3개월 안에 끝낼 교재">
        {w && w.total > 0 ? <BookSection w={w} /> : <p className={css.empty}>교재 주문 기록이 없습니다.</p>}
      </Section>
      {SHOW_BOOK_PLAN ? (
        <Section title="오늘 기준" hint="오늘 위치와 다음 수업">
          <TodaySection w={w && w.total > 0 ? w : undefined} fallbackNow={progress?.currentBlock ?? null} onOpen={onOpen} />
        </Section>
      ) : null}
    </article>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className={css.sec}>
      <div className={css.lab}><b>{title}</b><span>{hint}</span></div>
      <div className={css.body}>{children}</div>
    </section>
  );
}

function GoalBody({ goal, progress, summary }: { goal?: LearningGoal; progress?: LearningProgress; summary?: LearningRailMetrics }) {
  if (!goal) return <p className={css.empty}>전체 목표가 없습니다. 이름을 눌러 목표를 정해 주세요.</p>;
  const endGrade = goal.endStudyGrade ?? goal.studyGrade;
  const final = learningBlockLabel(goal.endBlock, endGrade);
  if (!summary || summary.current == null) {
    return (
      <>
        <div className={css.row}><h4>{courseRangeLabel(goal)}</h4><span className={css.right}>진도 확인 필요</span></div>
        <p className={css.empty}>최종 목표 · {final}</p>
      </>
    );
  }
  const { current, total, target } = summary;
  const now = progress?.currentBlock ? learningBlockLabel(progress.currentBlock, goal.studyGrade) : "—";
  return (
    <>
      <div className={css.row}>
        <h4>{courseRangeLabel(goal)}</h4>
        <span className={css.right}><b>{current}/{total}차시</b> · {summary.percent ?? 0}% · {Math.max(0, total - current)}차시 남음</span>
      </div>
      <div className={css.rail}>
        <span className={css.fill} style={{ width: pct(Math.min(current, target), total) }} />
        {current < target ? <span className={css.late} style={{ left: pct(current, total), width: pct(target - current, total) }} /> : null}
        {current > target ? <span className={css.ahead} style={{ left: pct(target, total), width: pct(current - target, total) }} /> : null}
        <span className={css.plan} style={{ left: pct(target, total) }}>
          <em>{summary.targetBeforeRail ? "오늘 계획 · 첫 기록보다 앞" : `오늘 계획 ${target}`}</em>
        </span>
        <span className={css.dot} style={{ left: pct(current, total) }} />
      </div>
      <div className={css.ends}>
        <div><b>현재 위치</b>{now}</div>
        <div><b>최종 목표</b>{final}</div>
      </div>
      <div className={css.facts}>
        <span>남은 수업<b>{summary.remainingDays}회</b></span>
        <span>기간<b>{goal.startDate.replaceAll("-", ".")} – {goal.endDate.replaceAll("-", ".")}</b></span>
      </div>
    </>
  );
}
