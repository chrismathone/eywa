"use client";

import { useState, type ReactNode } from "react";
import type { MathStudentRow } from "../server/month-queries";
import { learningStatusLabel, type LearningGoal, type LearningProgress } from "../lib/learning-plan";
import type { LearningRailMetrics } from "../lib/learning-axis";
import { courseRangeLabel } from "../lib/learning-path";
import { learningBlockLabel } from "../lib/learning-label";
import { useMathTextbooks } from "./math-textbook-context";
import { StudentTextbookChip } from "./math-textbook-assign";
import { BookSection, SHOW_TODAY_SECTION, TodaySection } from "./plan-card-sections";
import { RoadmapGoal } from "./roadmap-goal";
import { OtherBookBody } from "./other-book";
import { roadmapStatusLabel } from "../lib/roadmap-status";
import css from "./plan-card.module.css";
import { StudentBasics } from "./student-basics";

const pct = (n: number, total: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, total)) * 100))}%`;

/**
 * 학생 계획 카드 — 전체 목표 / 교재 3개월 / 오늘 기준 세 구역(원장 2026-10-20 *"디자인을 저런느낌으로"*, 카드 시안).
 * 🔑 계획보다 밀린 만큼은 **빨간 빗금**(원장 *"밀린 차시만큼 되는건 붉은색계열로"*) — 막대·교재 타일이 같은 표시를 쓴다.
 * 🔑 전체 목표 = 교재 로드맵(주문일+7일부터 내신 뺀 3개월에 2권 · 중3 11월 말까지, book-roadmap.ts). 주문이 없으면
 *    저장된 전체 목표(블록 계획)를 그대로 보인다.
 * 🔑 교재가 여럿이면 머리 줄에 교재 이름을 나란히 두고 눌러서 바꿔 본다(원장 *"옆에 교재이름대로 나열해서 클릭해서"*).
 * 판정은 서버·순수 함수가 끝낸 값(`LearningRailMetrics`, `BookRoadmap`)만 읽는다.
 */
export function StudentPlanCard({ student, goal, progress, summary, onOpen }: {
  student: MathStudentRow;
  goal?: LearningGoal;
  progress?: LearningProgress;
  summary?: LearningRailMetrics;
  onOpen: () => void;
}) {
  const plans = useMathTextbooks()?.plans[student.studentId];
  const roadmaps = plans?.roadmaps ?? [];
  const others = plans?.others ?? [];
  // 주문이 없으면 저장된 전체 목표가 첫 탭 — 다른 교재 칩이 그 목표를 가리지 않게.
  const tabs = [
    ...(roadmaps.length === 0 && others.length ? [{ key: "", label: "전체 목표" }] : []),
    ...roadmaps.map((r) => ({ key: `r:${r.series}`, label: `${r.series} ${r.window.books[0]!.title.replace(/^\S+\s*/, "").replace(/\s*\d+권$/, "")}` })),
    ...others.map((o) => ({ key: `o:${o.name}`, label: o.name })),
  ];
  const [pick, setPick] = useState(tabs[0]?.key ?? "");
  const r = roadmaps.find((x) => `r:${x.series}` === pick) ?? (pick.startsWith("o:") ? undefined : roadmaps[0]);
  const other = pick.startsWith("o:") ? others.find((o) => `o:${o.name}` === pick) : undefined;
  const w = r?.window;
  const tone = student.rosterPhase !== "on" ? undefined : r ? r.status : summary?.status;
  const badge = student.rosterPhase === "ended" ? "수강 종료"
    : student.rosterPhase === "upcoming" ? "수강 예정"
    : r ? `교재 목표 · ${roadmapStatusLabel(r)}`
    : other ? "차시표 없는 교재"
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
        <StudentBasics info={student.basicInfo} studentName={student.name} />
        {tabs.length > 1 || others.length > 0 ? (
          <div className={css.bookTabs} role="tablist" aria-label={`${student.name} 교재`}>
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={(other ? `o:${other.name}` : r ? `r:${r.series}` : "") === t.key}
                onClick={() => setPick(t.key)}>{t.label}</button>
            ))}
          </div>
        ) : null}
      </header>
      {other ? (
        <Section title="수업 기록" hint="교재목록에 차시표가 없는 교재 — 최근 보고서">
          <OtherBookBody book={other} />
        </Section>
      ) : (
        <>
          <Section title="전체 목표" hint={r ? "중3 11월 말까지 3개월에 2권 · 내신기간 제외" : "과정 전체에서 어디까지 갈지"}>
            {r ? <RoadmapGoal r={r} studentId={student.studentId} studentName={student.name} /> : <GoalBody goal={goal} progress={progress} summary={summary} />}
          </Section>
          <Section title="교재 3개월" hint="두 권씩 · 내신기간을 뺀 3개월 안에 끝낼 교재">
            {w && w.total > 0 ? <BookSection w={w} /> : <p className={css.empty}>교재 주문 기록이 없습니다.</p>}
          </Section>
          {SHOW_TODAY_SECTION ? (
            <Section title="오늘 기준" hint="오늘 위치와 다음 수업">
              <TodaySection w={w && w.total > 0 ? w : undefined} fallbackNow={progress?.currentBlock ?? null} onOpen={onOpen} />
            </Section>
          ) : null}
        </>
      )}
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
