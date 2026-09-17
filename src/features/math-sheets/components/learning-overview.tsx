"use client";

import { useEffect, useState } from "react";
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
import { EyIcon } from "@/components/icons/eywa-icons";
import { shiftMonth } from "@/lib/date-kst";
import type {
  MathSheetMonthData,
  MathStudentRow,
} from "../server/month-queries";
import {
  learningStatusLabel,
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
import {
  TEST_KIND_LABEL,
  testCountLabel,
  testScoresOf,
} from "../lib/test-score";
import styles from "./learning-overview.module.css";

const GoalDialog = dynamic(() =>
  import("./learning-goal-dialog").then((m) => m.LearningGoalDialog),
);
type Filter = "all" | "behind" | "on" | "ahead" | "missing";
const shortDate = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function Status({
  progress,
  student,
}: {
  progress?: LearningProgress;
  student: MathStudentRow;
}) {
  return (
    <span className={styles.status}>
      {student.rosterPhase === "ended"
        ? "수강 종료"
        : student.rosterPhase === "upcoming"
          ? "수강 예정"
          : learningStatusLabel(progress)}
    </span>
  );
}

export function LearningRails({ progress }: { progress?: LearningProgress }) {
  return (
    <div className={styles.rails}>
      <div className={styles.railRow}>
        <span>현재진도</span>
        <div className={styles.track}>
          <i
            className={styles.currentFill}
            data-visible={Boolean(progress?.percent)}
            style={{ width: `${progress?.percent ?? 0}%` }}
          />
        </div>
        <b>{progress?.current == null ? "—" : `${progress.current}블록`}</b>
      </div>
      <div className={`${styles.railRow} ${styles.targetRow}`}>
        <span>목표진도</span>
        <div className={styles.track}>
          <i
            className={styles.targetFill}
            style={{ width: `${progress?.targetPercent ?? 0}%` }}
          />
        </div>
        <b>{progress ? `${progress.target}블록` : "—"}</b>
      </div>
      <div className={styles.scale}>
        <span>시작 0</span>
        <span>
          {progress ? `전체 ${progress.total}블록` : "전체 목표 미설정"}
        </span>
      </div>
    </div>
  );
}

export function LearningOverview({
  data,
  learning,
  classOptions,
  initialStudentId,
}: {
  data: MathSheetMonthData;
  learning: LearningData;
  classOptions: { id: string; name: string }[];
  initialStudentId?: string;
}) {
  const [selected, setSelected] = useState<string | null>(() =>
    data.students.some((s) => s.studentId === initialStudentId)
      ? initialStudentId!
      : null,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [goalEditor, setGoalEditor] = useState<{
    studentId: string | null;
  } | null>(null);
  const [fontSize, setFontSize] = useState<McsFontSize>(data.fontSize);
  const inFrame = useInFrame();
  const navigate = (href: string) =>
    window.location.assign(inFrame ? withEmbed(href) : href);
  const selectStudent = (studentId: string | null) => {
    setSelected(studentId);
    const url = new URL(window.location.href);
    if (studentId) url.searchParams.set("student", studentId);
    else url.searchParams.delete("student");
    window.history.pushState(null, "", url);
  };
  useEffect(() => {
    const onBack = () =>
      setSelected(new URL(window.location.href).searchParams.get("student"));
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  const matches = (student: MathStudentRow, kind: Filter) => {
    const progress = learning.progress[student.studentId];
    if (kind === "all") return true;
    if (student.rosterPhase !== "on") return false;
    if (kind === "missing")
      return (
        !progress ||
        ["no-data", "no-schedule", "not-started"].includes(progress.status)
      );
    return (
      progress?.status === kind ||
      (kind === "on" && progress?.status === "done")
    );
  };
  const shown = data.students.filter(
    (s) =>
      matches(s, filter) &&
      `${s.name} ${s.school ?? ""}`.includes(query.trim()),
  );
  const student = data.students.find((s) => s.studentId === selected);
  const goals = Object.values(learning.goals);
  const uniqueGoals = new Set(
    goals.map((g) => JSON.stringify({ ...g, studentId: "" })),
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
            <h2>{student ? "학생 집중 보기" : "수학 진도 관리"}</h2>
            <p>
              {data.className} <span>{data.teacherName ?? "담임 미지정"}</span>
            </p>
          </div>
          {editable ? (
            <button
              className={styles.primaryButton}
              onClick={() =>
                setGoalEditor({ studentId: student?.studentId ?? null })
              }
            >
              전체 목표 설정
            </button>
          ) : null}
        </header>
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
                    ? `${common.studyGrade}${learning.progress[common.studentId] ? ` · ${learning.progress[common.studentId].total}블록` : ""}`
                    : goals.length
                      ? `학생별 개별 목표 ${goals.length}명`
                      : "시작·완료 블록과 기간을 설정해 주세요"}
                </strong>
              </div>
              {common ? (
                <p>
                  {common.startDate} – {common.endDate}
                  <br />
                  최종 목표: {common.endBlock}
                </p>
              ) : (
                <p>
                  전체 목표를 정하면 월간·주간·일간 계획이 자동으로 나뉩니다.
                </p>
              )}
              <span className={styles.autoBadge}>월·주·일 자동 배분</span>
            </div>
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
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>학생</th>
                    <th>전체 학습 구간 · 기준일 계획과 비교</th>
                    <th>전체 진도율</th>
                    <th>계획 대비</th>
                    <th>남은 수업당 필요</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => {
                    const progress = learning.progress[s.studentId],
                      goal = learning.goals[s.studentId];
                    return (
                      <tr
                        key={s.studentId}
                        className={
                          s.rosterPhase === "ended" ? styles.ended : undefined
                        }
                        onClick={() => selectStudent(s.studentId)}
                      >
                        <td>
                          <button
                            className={styles.studentName}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectStudent(s.studentId);
                            }}
                          >
                            {s.name}
                          </button>
                          <p className={styles.meta}>
                            {s.school} {s.grade}
                          </p>
                        </td>
                        <td>
                          <div className={styles.course}>
                            <strong>
                              {goal?.studyGrade ??
                                s.rail?.nowGrade ??
                                "현재 수업"}
                            </strong>
                            <span>
                              {progress?.currentBlock ??
                                s.rail?.nowLesson ??
                                "아직 진도 기록이 없습니다"}
                            </span>
                          </div>
                          <LearningRails progress={progress} />
                        </td>
                        <td>
                          <strong className={styles.rate}>
                            {progress?.percent == null ? (
                              "—"
                            ) : (
                              <>
                                {progress.percent}
                                <small>%</small>
                              </>
                            )}
                          </strong>
                          <p className={styles.meta}>
                            {progress?.current == null
                              ? goal
                                ? "진도 확인 필요"
                                : "전체 목표 미설정"
                              : `${progress.current} / ${progress.total}블록`}
                          </p>
                        </td>
                        <td>
                          <Status student={s} progress={progress} />
                          <p className={styles.meta}>
                            {progress
                              ? `목표 ${progress.target}블록`
                              : "학생을 눌러 목표 설정"}
                          </p>
                        </td>
                        <td>
                          <strong className={styles.pace}>
                            {progress?.requiredPace == null
                              ? "—"
                              : `${progress.requiredPace.toFixed(1)}블록`}
                          </strong>
                          <p className={styles.meta}>
                            {progress
                              ? `남은 수업 ${progress.remainingDays}회`
                              : "전체 목표 미설정"}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
            student={student}
            onSelect={selectStudent}
            onEdit={
              editable
                ? () => setGoalEditor({ studentId: student.studentId })
                : undefined
            }
          />
        )}
        <footer className={styles.footer}>
          <span>
            <i className={styles.blueDot} />
            현재 진도 <i className={styles.targetDot} />
            목표 진도
          </span>
          <span>
            {learning.referenceDate} 기준 · 수업 당일 목표는 수업 종료까지의
            계획입니다.
          </span>
        </footer>
      </div>
      {goalEditor ? (
        <GoalDialog
          data={data}
          learning={learning}
          studentId={goalEditor.studentId}
          onClose={() => setGoalEditor(null)}
        />
      ) : null}
    </div>
  );
}

function StudentFocus({
  data,
  learning,
  student,
  onSelect,
  onEdit,
}: {
  data: MathSheetMonthData;
  learning: LearningData;
  student: MathStudentRow;
  onSelect: (id: string) => void;
  onEdit?: () => void;
}) {
  const goal = learning.goals[student.studentId],
    progress = learning.progress[student.studentId];
  const records =
    learning.records[student.studentId] ??
    Object.entries(student.records)
      .filter(([date]) => date <= learning.referenceDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, r]) => ({
        date,
        progress: r.progress,
        textbook: r.textbook,
        homework: r.homework,
      }));
  const legacyGoal = data.goals[student.studentId];
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
                {learning.progress[s.studentId]?.percent == null
                  ? "—"
                  : `${learning.progress[s.studentId].percent}%`}
              </small>
            </strong>
            <span>
              {s.school} {s.grade}
            </span>
            <Status student={s} progress={learning.progress[s.studentId]} />
          </button>
        ))}
      </aside>
      <section
        className={styles.focusMain}
        aria-label={`${student.name} 진도 상세`}
      >
        <div className={styles.focusTitle}>
          <h3>{student.name}</h3>
          <Status student={student} progress={progress} />
          {onEdit ? (
            <button className={styles.button} onClick={onEdit}>
              목표 조정
            </button>
          ) : null}
        </div>
        <p className={styles.meta}>
          {student.school} {student.grade}
          {goal?.textbook ? ` · ${goal.textbook}` : ""}
        </p>
        {goal && progress ? (
          <>
            <div className={styles.focusCourse}>
              <strong>
                {goal.studyGrade} · {progress.total}블록
              </strong>
              <span>
                {shortDate(goal.startDate)} 시작 – {shortDate(goal.endDate)}{" "}
                완료
              </span>
            </div>
            <LearningRails progress={progress} />
            <p className={styles.currentBlock}>
              {progress.currentBlock ?? "현재 진도 확인 필요"}
              {progress.currentDate
                ? ` (${shortDate(progress.currentDate)} 기록)`
                : ""}
            </p>
            <div className={styles.hierarchy}>
              {[
                {
                  label: "전체 목표",
                  value: progress.total,
                  date: goal.endDate,
                  note: goal.endBlock,
                },
                {
                  label: `${Number(data.month.slice(5))}월 목표`,
                  value: progress.month.to,
                  date: progress.month.endDate,
                  note: `${progress.month.to - progress.month.from}블록 학습`,
                },
                {
                  label: "이번 주 목표",
                  value: progress.week.to,
                  date: progress.week.endDate,
                  note: `${progress.week.to - progress.week.from}블록 학습`,
                },
                {
                  label: "기준일 목표",
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
                  <p>{shortDate(item.date)}까지</p>
                  <p title={item.note}>{item.note}</p>
                </div>
              ))}
            </div>
            <div className={styles.insight}>
              <strong>{learningStatusLabel(progress)}.</strong>
              {progress.status === "done"
                ? " 설정한 전체 학습 목표를 마쳤습니다."
                : progress.requiredPace == null
                  ? progress.status === "no-data"
                    ? " 수업보고서의 진도 기록을 확인해 주세요."
                    : progress.remainingDays === 0
                      ? " 목표 기간의 수업이 끝났습니다. 완료일과 수업 계획을 확인해 주세요."
                      : " 시간표와 목표 기간을 확인해 주세요."
                  : ` ${shortDate(goal.endDate)}까지 목표를 마치려면 남은 ${progress.remainingDays}회 수업에서 평균 ${progress.requiredPace.toFixed(1)}블록씩 진행하면 됩니다.`}
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
          </>
        ) : (
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
        )}
        {legacyGoal?.targetProgress || legacyGoal?.textbook ? (
          <details className={styles.legacyGoal}>
            <summary>{data.monthLabel} 기존 월간 목표</summary>
            <p>{legacyGoal.textbook}</p>
            <p>{legacyGoal.targetProgress}</p>
          </details>
        ) : null}
        <div className={styles.records}>
          <h4>
            최근 수업 기록 <span>{records.length}건</span>
          </h4>
          {records.length ? (
            records.map((r, i) => {
              const scores = student.records[r.date];
              return (
                <div className={styles.record} key={`${r.date}:${i}`}>
                  <time>{shortDate(r.date)}</time>
                  <div>
                    <strong>{r.progress || "진도 입력 없음"}</strong>
                    {r.textbook ? <p>{r.textbook}</p> : null}
                    {r.homework ? <p>과제: {r.homework}</p> : null}
                    {scores ? (
                      <p>
                        {testScoresOf(scores)
                          .map(
                            (score) =>
                              `${TEST_KIND_LABEL[score.kind]} ${testCountLabel(score)}`,
                          )
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className={styles.empty}>
              기준일까지 작성된 수업 기록이 없습니다.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
