"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  SheetBarDivider,
  SheetClassPicker,
} from "@/features/class-sheets/components/sheet-chrome";
import { SHEET_BAR } from "@/features/class-sheets/chrome";
import { PeriodNav } from "@/components/period-nav";
import { HrefSelect } from "@/components/href-select";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { EyIcon } from "@/components/icons/aywa-icons";
import { shiftMonth } from "@/lib/date-kst";
import type {
  MathSheetMonthData,
  MathStudentRow,
} from "../server/month-queries";
import {
  learningStatusLabel,
  goalMilestones,
  type LearningData,
  type LearningProgress,
} from "../lib/learning-plan";
import {
  MCS_FONT_SIZES,
  MCS_FONT_SIZE_LABEL,
  MCS_FONT_SIZE_ZOOM,
  type McsFontSize,
} from "../font-size";
import { setMyMcsFontSize } from "../server/actions";
import styles from "./learning-overview.module.css";
import { ClassTextbookBar, StudentTextbookChip } from "./math-textbook-assign";
import { BookWindowBar } from "./book-window-bar";
import { StudentPlanCard } from "./student-plan-card";
import { StudentBasics } from "./student-basics";
import { SchoolExamButton } from "./school-exam-dialog";
import { useMathTextbooks } from "./math-textbook-context";
import { MATH_LEARNING_CADENCE, type MathLearningTrack } from "@/features/progress/learning-cadence";
import { learningBlocks } from "../lib/learning-plan";
import { courseRangeLabel } from "../lib/learning-path";
import { learningBlockLabel } from "../lib/learning-label";
import { setMathClassLearningTrack } from "../server/learning-actions";
import { LearningReportList } from "@/features/math-progress-map/components/learning-report-list";
import { learningRailMetrics, learningTopicTicks, type LearningRailMetrics } from "../lib/learning-axis";
import { learningGoalPlanKey } from "../lib/learning-goal-comparison";

const GoalDialog = dynamic(() =>
  import("./learning-goal-dialog").then((m) => m.LearningGoalDialog),
);
const GoalRevisionDialog = dynamic(() => import("./learning-goal-revision-dialog").then(module => module.LearningGoalRevisionDialog));
const StudentLearningMap = dynamic(() => import("@/features/math-progress-map/components/linked-learning-map").then(m => m.LinkedLearningMap), {
  loading: () => <p role="status">학생 진도맵을 불러오는 중입니다…</p>,
});
type Filter = "all" | "behind" | "on" | "ahead" | "missing";
const shortDate = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function Status({
  progress,
  student,
}: {
  progress?: Pick<LearningProgress, "status" | "difference">;
  student: MathStudentRow;
}) {
  return (
    <span className={styles.status}>
      {student.rosterPhase === "ended"
        ? "수강 종료"
        : student.rosterPhase === "upcoming"
          ? "수강 예정"
          : learningStatusLabel(progress, "차시")}
    </span>
  );
}

export function LearningOverview({
  data,
  learning,
  classOptions,
  initialStudentId,
  initialQuery = "",
  canResetGoals = false,
}: {
  data: MathSheetMonthData;
  learning: LearningData;
  classOptions: { id: string; name: string }[];
  initialStudentId?: string;
  initialQuery?: string;
  /** 전체 목표 '초기화'(배정 취소) — **원장 이상급**만(원장 2026-09-18). 서버가 같은 함수로 다시 본다. */
  canResetGoals?: boolean;
}) {
  const track = learning.track ?? "regular";
  const router = useRouter();
  const [trackEditor, setTrackEditor] = useState(false);
  const [nextTrack, setNextTrack] = useState<MathLearningTrack>(track);
  const [trackPending, startTrackTransition] = useTransition();
  const [trackError, setTrackError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() =>
    data.students.some((s) => s.studentId === initialStudentId)
      ? initialStudentId!
      : null,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [focusQuery, setFocusQuery] = useState(initialQuery);
  const [query, setQuery] = useState("");
  const [goalEditor, setGoalEditor] = useState<{
    studentId: string | null;
  } | null>(null);
  const [fontSize, setFontSize] = useState<McsFontSize>(data.fontSize);
  const [revisionEditor, setRevisionEditor] = useState<{ studentId: string; goalNumber: number } | null>(null);
  const inFrame = useInFrame();
  const navigate = (href: string) =>
    window.location.assign(inFrame ? withEmbed(href) : href);
  const selectStudent = (studentId: string | null) => {
    if (studentId === selected) return;
    setSelected(studentId);
    setGoalEditor(null);
    setRevisionEditor(null);
    const url = new URL(window.location.href);
    if (studentId) url.searchParams.set("student", studentId);
    else url.searchParams.delete("student");
    for (const key of ["date", "view", "display", "topic", "lesson", "undated"]) url.searchParams.delete(key);
    setFocusQuery(url.searchParams.toString());
    window.history.pushState(window.history.state, "", url);
  };
  useEffect(() => {
    const onBack = () => {
      const params = new URL(window.location.href).searchParams;
      setSelected(params.get("student"));
      setFocusQuery(params.toString());
      setGoalEditor(null);
      setRevisionEditor(null);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  const { summaries } = useMemo(() => {
    const summaries: Record<string, LearningRailMetrics> = {};
    for (const [id, goal] of Object.entries(learning.goals)) {
      const progress = learning.progress[id];
      const topics = learningTopicTicks(goal, progress);
      if (progress) summaries[id] = learningRailMetrics(goal, progress, topics);
    }
    return { summaries };
  }, [learning.goals, learning.progress]);
  // 카드 배지와 **같은 판정**으로 센다 — 교재 로드맵이 있으면 그 판정, 없으면 저장된 전체 목표(블록 계획).
  const bookPlans = useMathTextbooks()?.plans;
  const statusOf = (studentId: string) => bookPlans?.[studentId]?.roadmaps[0]?.status ?? summaries[studentId]?.status;
  const matches = (student: MathStudentRow, kind: Filter) => {
    const status = statusOf(student.studentId);
    if (kind === "all") return true;
    if (student.rosterPhase !== "on") return false;
    if (kind === "missing")
      return (
        !status ||
        ["no-data", "no-schedule", "not-started"].includes(status)
      );
    return status === kind || (kind === "on" && status === "done");
  };
  const shown = data.students.filter(
    (s) =>
      matches(s, filter) &&
      `${s.name} ${s.school ?? ""}`.includes(query.trim()),
  );
  const student = data.students.find((s) => s.studentId === selected);
  const goals = Object.values(learning.goals);
  const uniqueGoals = new Set(
    goals.map(learningGoalPlanKey),
  );
  const common = uniqueGoals.size === 1 ? goals[0] : null;
  const thisMonth = data.today.slice(0, 7);
  const hrefFor = (month: string) =>
    `/mcs/${data.classId}/month?month=${month}${selected ? `&student=${selected}` : ""}`;
  const editable = data.canEdit && learning.status === "ok";
  return (
    <div className={styles.root}>
      <div className={SHEET_BAR}>
        <SheetClassPicker
          classId={data.classId}
          classLabel={data.className}
          teacherName={data.teacherName}
          classOptions={classOptions}
          listHref="/mcs"
          onNavigate={navigate}
          hrefForClass={(id) => `/mcs/${id}/month?month=${data.month}`}
        />
        <SheetBarDivider />
        <PeriodNav
          label={data.monthLabel}
          prevHref={hrefFor(shiftMonth(data.month, -1))}
          nextHref={hrefFor(shiftMonth(data.month, 1))}
          currentHref={hrefFor(thisMonth)}
          relation={
            data.month === thisMonth
              ? "current"
              : data.month < thisMonth
                ? "past"
                : "future"
          }
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="이번 달로"
          onNavigate={navigate}
        />
        <span className="flex-1" />
        <HrefSelect
          axisLabel="글씨"
          ariaLabel="수학 진도 글씨 크기"
          value={fontSize}
          onSelect={(v) => {
            setFontSize(v as McsFontSize);
            void setMyMcsFontSize(v as McsFontSize);
          }}
          options={MCS_FONT_SIZES.map((f) => ({
            value: f,
            label: MCS_FONT_SIZE_LABEL[f],
          }))}
        />
      </div>
      {learning.status !== "ok" ? (
        <p role="status" className={styles.notice}>
          {learning.status === "missing-table"
            ? "전체 목표 저장 기능을 준비 중입니다. 학생을 눌러 기존 수업 기록을 확인할 수 있습니다."
            : "전체 목표 또는 진도 기록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요."}
        </p>
      ) : null}
      <div
        className={styles.surface}
        style={
          fontSize === "sm" ? undefined : { zoom: MCS_FONT_SIZE_ZOOM[fontSize] }
        }
      >
        <header className={styles.heading}>
          <div>
            {student ? (
              <button
                className={styles.back}
                onClick={() => selectStudent(null)}
              >
                ‹ 반 전체 진도
              </button>
            ) : null}
            <div className={styles.headingTitle}>
              <h2>{student ? "학생 집중 보기" : "수학 진도 관리"}</h2>
              <span className={styles.trackBadge}>{track === "regular" ? "정규 진도" : "복습 심화"}</span>
              <span className={styles.trackCaption}>{student && learning.goals[student.studentId]?.revision ? "직접 수정한 계획" : `월 ${MATH_LEARNING_CADENCE[track].monthlyBlocks}블록`}</span>
            </div>
          </div>
          {editable ? <div className={styles.headingActions}>
            <SchoolExamButton schools={data.students.map((s) => s.school)} today={data.today} />
            <button type="button" className={styles.button} disabled={trackPending} onClick={() => { setNextTrack(track); setTrackEditor(!trackEditor); }}>수업 유형 설정</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={trackPending}
              onClick={() =>
                setGoalEditor({ studentId: student?.studentId ?? null })
              }
            >
              전체 목표 설정
            </button>
          </div> : null}
        </header>
        {trackEditor ? <form className={styles.trackEditor} onSubmit={(event) => {
          event.preventDefault(); setTrackError(null);
          startTrackTransition(async () => {
            try {
              const result = await setMathClassLearningTrack({ classId: data.classId, track: nextTrack });
              if (!result.ok) { setTrackError(result.error); return; }
              setTrackEditor(false); setFilter("all"); setRevisionEditor(null); router.refresh();
            } catch { setTrackError("수업 유형을 저장하지 못했습니다. 다시 시도해 주세요."); }
          });
        }}>
          <label>이 반의 수업 유형 <select aria-label="이 반의 수업 유형" value={nextTrack} disabled={trackPending} onChange={(e) => setNextTrack(e.target.value as MathLearningTrack)}><option value="regular">정규 진도</option><option value="supplement">복습 심화</option></select></label>
          <p>반 전체에 적용됩니다. 기존 유형의 목표는 보관되며, 선택한 유형의 목표와 수업 기록을 표시합니다.</p>
          {trackError ? <p role="alert">{trackError}</p> : null}
          <button type="button" className={styles.button} disabled={trackPending} onClick={() => setTrackEditor(false)}>취소</button>
          <button className={styles.primaryButton} disabled={trackPending}>{trackPending ? "저장 중…" : "유형 저장"}</button>
        </form> : null}
        {!student ? (
          <>
            <div className={styles.goalSummary}>
              <div>
                <small>
                  전체 학습 목표
                  {goals.length ? ` · ${goals.length}명 설정` : ""}
                </small>
                <strong>
                  {common
                    ? `${courseRangeLabel(common)}${learning.progress[common.studentId] ? ` · ${learning.progress[common.studentId].total}블록` : ""}`
                    : goals.length
                      ? "학생별 목표"
                      : "시작·완료 블록과 기간을 설정해 주세요"}
                </strong>
              </div>
              {common ? (
                <p>
                  {common.startDate} – {common.endDate}
                  <span>최종 목표: {common.endStudyGrade ?? common.studyGrade} · {common.endBlock}</span>
                </p>
              ) : (
                <p>
                  전체 목표를 정하면 월간·주간·일간 계획이 자동으로 나뉩니다.
                </p>
              )}
              <span className={styles.autoBadge}>월·주·일 자동 배분</span>
            </div>
            <ClassTextbookBar />
            <div className={styles.filters}>
              <div>
                {(
                  [
                    ["all", "전체"],
                    ["behind", "계획보다 느림"],
                    ["on", "계획대로"],
                    ["ahead", "계획보다 빠름"],
                    ["missing", "목표·진도 확인"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={
                      filter === key ? styles.activeFilter : styles.filter
                    }
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                    <span>
                      {data.students.filter((s) => matches(s, key)).length}
                    </span>
                  </button>
                ))}
              </div>
              <label className={styles.search}>
                <EyIcon name="search" size={14} />
                <input
                  type="search"
                  aria-label="수학 시트 학생 검색"
                  placeholder="학생 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {/* 학생 계획 카드(원장 2026-10-20 카드 시안) — 전체 목표 / 교재 3개월 / 오늘 기준. */}
            <div className={styles.cardList}>
              {shown.map((s) => (
                <StudentPlanCard
                  key={s.studentId}
                  student={s}
                  goal={learning.goals[s.studentId]}
                  progress={learning.progress[s.studentId]}
                  summary={summaries[s.studentId]}
                  onOpen={() => selectStudent(s.studentId)}
                />
              ))}
              {shown.length === 0 ? (
                <p className={styles.empty}>
                  표시할 학생이 없습니다. 검색어와 필터를 확인해 주세요.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <StudentFocus
            data={data}
            learning={learning}
            summaries={summaries}
            student={student}
            initialQuery={focusQuery}
            onSelect={selectStudent}
            onEdit={
              editable && !trackPending
                ? () => setGoalEditor({ studentId: student.studentId })
                : undefined
            }
            onEditGoal={editable && !trackPending ? goalNumber => setRevisionEditor({ studentId: student.studentId, goalNumber }) : undefined}
          />
        )}
        <footer className={styles.footer}>
          <span>
            <i className={styles.blueDot} />
            현재 진도 <i className={styles.targetDot} />
            단계별 목표
          </span>
          <span>
            {learning.referenceDate} 기준
          </span>
        </footer>
      </div>
      {goalEditor && !trackPending ? (
        <GoalDialog
          key={track}
          data={data}
          learning={learning}
          studentId={goalEditor.studentId}
          canReset={canResetGoals}
          onClose={() => setGoalEditor(null)}
        />
      ) : null}
      {revisionEditor && !trackPending && learning.goals[revisionEditor.studentId] ? <GoalRevisionDialog
        key={`${track}:${revisionEditor.studentId}:${revisionEditor.goalNumber}`}
        classId={data.classId} studentId={revisionEditor.studentId} studentName={data.students.find(student => student.studentId === revisionEditor.studentId)?.name ?? "학생"}
        startDate={learning.goals[revisionEditor.studentId].startDate} track={track} goalNumber={revisionEditor.goalNumber} onClose={() => setRevisionEditor(null)} /> : null}
    </div>
  );
}

function StudentFocus({
  data,
  learning,
  summaries,
  student,
  initialQuery,
  onSelect,
  onEdit,
  onEditGoal,
}: {
  data: MathSheetMonthData;
  learning: LearningData;
  summaries: Record<string, LearningRailMetrics>;
  student: MathStudentRow;
  initialQuery: string;
  onSelect: (id: string) => void;
  onEdit?: () => void;
  onEditGoal?: (goalNumber: number) => void;
}) {
  const goal = learning.goals[student.studentId],
    progress = learning.progress[student.studentId];
  const summary = summaries[student.studentId];
  const records = learning.records[student.studentId] ?? [];
  const legacyGoal = learning.track === "supplement" ? undefined : data.goals[student.studentId];
  return (
    <div className={styles.focusLayout}>
      <aside className={styles.studentList} aria-label="학생 선택">
        <p>학생 {data.students.length}명</p>
        {data.students.map((s) => (
          <button
            key={s.studentId}
            className={
              s.studentId === student.studentId
                ? styles.selectedStudent
                : styles.selectStudent
            }
            aria-pressed={s.studentId === student.studentId}
            onClick={() => onSelect(s.studentId)}
          >
            <strong>
              {s.name}
              <small>
                {summaries[s.studentId]?.percent == null
                  ? "—"
                  : `${summaries[s.studentId].percent}%`}
              </small>
            </strong>
            <span>
              {s.school} {s.grade}
            </span>
            <Status student={s} progress={summaries[s.studentId]} />
          </button>
        ))}
      </aside>
      <section
        className={styles.focusMain}
        aria-label={`${student.name} 진도 상세`}
      >
        {student.basicInfo ? <div className={styles.stickyBasics}>
          <StudentBasics info={student.basicInfo} studentName={student.name} identity={[student.name, student.school, student.grade].filter(Boolean).join(" · ")} />
        </div> : null}
        {!goal || !progress ? <><div className={styles.focusTitle}>
          <h3>{student.name}</h3>
          <Status student={student} progress={summary} />
          {onEdit ? (
            <button className={styles.button} onClick={onEdit}>
              {goal ? "목표 확장" : "목표 설정"}
            </button>
          ) : null}
        </div>
        <p className={styles.meta}>
          {student.school} {student.grade}
          {goal?.textbook ? ` · ${goal.textbook}` : ""}
        </p>
        <StudentTextbookChip studentId={student.studentId} studentName={student.name} />
        <BookWindowBar studentId={student.studentId} /></> : null}
        {goal && progress ? (
          <>
            <StudentLearningMap
              key={JSON.stringify([data.classId, student.studentId, data.month, goal, progress.referenceDate, progress.currentBlock, progress.history?.start])}
              student={student} classId={data.classId} className={data.className} month={data.month}
              goal={goal} progress={progress} records={records} reportScores={student.records}
              context={learning.context}
              initialQuery={initialQuery} embedded
              onEditGoal={goal.blockCount ? onEditGoal : undefined}
              headerActions={<>
                {student.rosterPhase !== "on" ? <Status student={student} progress={summary} /> : null}
                {onEdit ? <button className={styles.button} onClick={onEdit}>목표 확장</button> : null}
              </>}
            />
            <details className={styles.planArchive}>
              <summary>블록별 계획과 일간 목표</summary>
              <p className={styles.meta}>{courseRangeLabel(goal)} · {goal.startDate} 시작 – {goal.endDate} 완료</p>
            {goal.blockCount && learning.track !== "supplement" ? (
              <details className={styles.dailyPlan}>
                <summary>전체 {goal.blockCount}블록 진도표 · {goal.revision ? "목표별 직접 배분" : `월 ${MATH_LEARNING_CADENCE.regular.monthlyBlocks}블록`}</summary>
                <p className={styles.meta}>{goal.revision ? `${goal.revision.effectiveDate}부터 수정한 목표 날짜와 구간별 분량을 반영합니다.` : "과정별 단원을 배분한 계획입니다. 목표 확장 시 이전 정거장의 배분은 유지됩니다."}</p>
                <div>
                  <table>
                    <thead><tr><th>{goal.revision ? "목표 구간" : "월"}</th><th>블록</th><th>학습 단원</th></tr></thead>
                    <tbody>{learningBlocks(goal).map((label, index) => <tr key={index}><td>{goal.revision ? `${goalMilestones(goal).findIndex(stop => stop.blockCount >= index + 1) + 1}차 목표` : `${Math.floor(index / MATH_LEARNING_CADENCE.regular.monthlyBlocks) + 1}개월차`}</td><td>{index + 1}블록</td><td>{label}</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
            ) : null}
            <div className={styles.hierarchy}>
              {[
                {
                  label: "전체 목표",
                  value: progress.total,
                  date: goal.endDate,
                  note: learningBlockLabel(goal.endBlock, goal.endStudyGrade ?? goal.studyGrade),
                },
                {
                  label: `${Number(data.month.slice(5))}월 계획`,
                  value: progress.month.to,
                  date: progress.month.endDate,
                  note: `${progress.month.to - progress.month.from}블록 학습`,
                },
                {
                  label: "이번 주 계획",
                  value: progress.week.to,
                  date: progress.week.endDate,
                  note: `${progress.week.to - progress.week.from}블록 학습`,
                },
                {
                  label: "기준일 계획",
                  value: progress.target,
                  date: learning.referenceDate,
                  note:
                    progress.current == null
                      ? "실제 진도 확인 필요"
                      : `실제 ${progress.current}블록`,
                },
              ].map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>
                    {item.value}
                    <small>블록까지</small>
                  </strong>
                  <p>{item.date.slice(0, 4) === data.month.slice(0, 4) ? shortDate(item.date) : item.date}까지</p>
                  <p title={item.note}>{item.note}</p>
                </div>
              ))}
            </div>
            <details className={styles.dailyPlan}>
              <summary>
                자동 배분된 일간 목표 · 수업 {progress.days.length}회
              </summary>
              <div>
                <table>
                  <thead>
                    <tr>
                      <th>수업일</th>
                      <th>누적 목표</th>
                      <th>목표 블록</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progress.days.map((day) => (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td>{day.target}블록</td>
                        <td>{day.block ?? "복습·준비"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            </details>
          </>
        ) : learning.status === "ok" ? (
          <div className={styles.noGoal}>
            <h4>전체 학습 목표를 설정해 주세요.</h4>
            <p>
              시작·완료 블록과 기간을 정하면 학생의 수업 일정에 맞춰 월·주·일
              목표를 계산합니다.
            </p>
            {onEdit ? (
              <button className={styles.primaryButton} onClick={onEdit}>
                전체 목표 설정
              </button>
            ) : null}
          </div>
        ) : <p role="status" className={styles.notice}>목표 또는 수업보고서를 불러오지 못했습니다. 새로고침해 주세요.</p>}
        {legacyGoal?.targetProgress || legacyGoal?.textbook ? (
          <details className={styles.legacyGoal}>
            <summary>{data.monthLabel} 기존 월간 목표</summary>
            <p>{legacyGoal.textbook}</p>
            <p>{legacyGoal.targetProgress}</p>
          </details>
        ) : null}
        {learning.status === "ok" && (!goal || !progress) ? <LearningReportList key={student.studentId} records={records} scores={student.records} grade={goal?.studyGrade} open /> : null}
      </section>
    </div>
  );
}
