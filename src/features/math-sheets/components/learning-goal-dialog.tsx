"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  CURRICULUM_GRADES,
  curriculumForGradeSemester,
  semesterOfLesson,
  semestersForGrade,
  type Semester,
  resolveStudyGrade,
} from "@/features/onescreen/curriculum";
import { MATH_LEARNING_CADENCE } from "@/features/progress/learning-cadence";
import {
  learningBlocks,
  learningDays,
  learningGoalError,
  plannedAt,
  standardGoalDates,
  type LearningData,
  type LearningGoal,
} from "../lib/learning-plan";
import type { MathSheetMonthData } from "../server/month-queries";
import { resetMathLearningGoals, saveMathLearningGoals } from "../server/learning-actions";
import styles from "./learning-overview.module.css";

export function LearningGoalDialog({
  data,
  learning,
  studentId,
  onClose,
  canReset = false,
}: {
  data: MathSheetMonthData;
  learning: LearningData;
  studentId: string | null;
  onClose: () => void;
  /** 전체 목표 '초기화'(배정 취소) — **원장 이상급**만(원장 2026-09-18). 서버가 같은 함수로 다시 본다([[#77]]). */
  canReset?: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState(studentId ?? "all");
  const eligible = data.students.filter((s) => s.rosterPhase !== "ended");
  const track = learning.track ?? "regular";
  const policy = MATH_LEARNING_CADENCE[track];
  const goalForStudent = (id: string | null): LearningGoal => {
    const student = data.students.find((s) => s.studentId === id) ?? eligible[0];
    const saved = learning.goals[student?.studentId ?? ""];
    if (saved?.blockCount) return saved;
    const resolved = resolveStudyGrade(saved?.studyGrade ?? student?.rail?.nowGrade ?? student?.grade ?? "중1");
    const grade = CURRICULUM_GRADES.includes(resolved) ? resolved : "중1";
    const recent = saved?.startBlock ?? student?.rail?.nowLesson ?? "";
    const semester = semesterOfLesson(grade, recent);
    const topics = curriculumForGradeSemester(grade, semester).flatMap((unit) => unit.lessons);
    const reviewTopic = topics.includes(recent) ? recent : topics[0] ?? "";
    return {
      studentId: student?.studentId ?? "",
      studyGrade: grade,
      startBlock: track === "supplement" ? reviewTopic : topics[0] ?? "",
      endBlock: track === "supplement" ? reviewTopic : topics.at(-1) ?? "",
      ...standardGoalDates(data.month, track),
      track,
      blockCount: policy.totalBlocks,
      textbook: saved?.textbook ?? data.goals[student?.studentId ?? ""]?.textbook ?? null,
    };
  };
  const [goal, setGoal] = useState<LearningGoal>(
    () => goalForStudent(studentId),
  );
  const [error, setError] = useState<string | null>(null);
  /** 초기화는 **되돌릴 수 없어** 그 자리에서 한 번 더 묻는다(회의록 '더보기'와 같은 규약). */
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();
  const semester = semesterOfLesson(goal.studyGrade, goal.startBlock);
  const blocks = useMemo(() => curriculumForGradeSemester(goal.studyGrade, semester).flatMap((unit) => unit.lessons), [goal.studyGrade, semester]);
  const selectedIds =
    scope === "all" ? eligible.map((s) => s.studentId) : [scope];
  const previewGoal = { ...goal, studentId: selectedIds[0] ?? "" };
  const preview = learningDays(previewGoal, learning.context);
  const total = learningBlocks(goal).length;
  const validation = learningGoalError(goal);
  const update = (patch: Partial<LearningGoal>) => {
    setGoal((previous) => ({ ...previous, ...patch }));
    setError(null);
    // 🔴 지울 대상(구분·시작월)이 바뀌면 확인 단계를 내린다 — 안 내리면 방금 본 문장과 다른 달이 지워진다.
    if (patch.startDate !== undefined || patch.track !== undefined) setConfirmReset(false);
  };
  const selectScope = (id: string) => {
    setScope(id);
    setError(null);
    setConfirmReset(false);
    setGoal(goalForStudent(id));
  };
  const reset = () => {
    if (!selectedIds.length) {
      setError("초기화할 학생을 선택해 주세요.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await resetMathLearningGoals({
          classId: data.classId,
          studentIds: selectedIds,
          track,
          startDate: goal.startDate,
          standard: goal.blockCount != null,
        });
        if (!result.ok) {
          setError(result.error);
          setConfirmReset(false);
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError("전체 목표를 초기화하지 못했습니다. 다시 시도해 주세요.");
        setConfirmReset(false);
      }
    });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (validation) {
      setError(validation);
      return;
    }
    if (!selectedIds.length) {
      setError("목표를 설정할 학생을 선택해 주세요.");
      return;
    }
    if (!preview.length) {
      setError(
        "목표 기간에 수업이 없는 달이 있습니다. 선택한 반의 수업 요일과 수강 기간을 확인해 주세요.",
      );
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveMathLearningGoals({
          ...goal,
          classId: data.classId,
          studentIds: selectedIds,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError(
          "전체 목표를 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요.",
        );
      }
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!pending}>
        <DialogTitle>전체 목표 설정</DialogTitle>
        <DialogDescription>
          {track === "regular" ? "한 학기의 단원을 24블록으로 나눠 월 8블록씩, 3개월에 완료합니다." : "기존 학습이나 현행 심화 내용을 수요일 월 4블록으로 복습합니다. 정규 진도에는 합산하지 않습니다."}
        </DialogDescription>
        <form onSubmit={submit} className={styles.goalForm}>
          <fieldset disabled={pending}>
            <div className={styles.formPair}>
              <label>
                적용 대상
                <select
                  aria-label="목표 적용 대상"
                  value={scope}
                  onChange={(e) => selectScope(e.target.value)}
                >
                  <option value="all">반 전체 · {eligible.length}명</option>
                  {data.students.map((s) => (
                    <option key={s.studentId} value={s.studentId}>
                      {s.name}
                      {s.rosterPhase === "ended" ? " (수강 종료)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                학습 과정
                <select
                  aria-label="학습 과정"
                  value={goal.studyGrade}
                  onChange={(e) => {
                    const next = curriculumForGradeSemester(e.target.value, 1).flatMap((unit) => unit.lessons);
                    update({
                      studyGrade: e.target.value,
                      startBlock: next[0] ?? "",
                      endBlock: next.at(-1) ?? "",
                    });
                  }}
                >
                  {CURRICULUM_GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.formPair}>
              <label>
                학기
                <select aria-label="목표 학기" value={semester} onChange={(e) => {
                  const topics = curriculumForGradeSemester(goal.studyGrade, Number(e.target.value) as Semester).flatMap((unit) => unit.lessons);
                  update({ startBlock: topics[0] ?? "", endBlock: topics.at(-1) ?? "" });
                }}>
                  {semestersForGrade(goal.studyGrade).map((s) => <option key={s} value={s}>{s}학기</option>)}
                </select>
              </label>
              <label>
                {track === "regular" ? "시작 월" : "복습 월"}
                <input aria-label="목표 시작 월" type="month" required value={goal.startDate.slice(0, 7)} onChange={(e) => {
                  if (/^\d{4}-\d{2}$/.test(e.target.value)) update(standardGoalDates(e.target.value, track));
                }} />
              </label>
            </div>
            <div>
              <span className={styles.fieldLabel}>시작 단원</span>
              <SearchableSelect
                ariaLabel="시작 단원"
                value={goal.startBlock}
                options={blocks.map((b) => ({
                  value: b,
                  label: b,
                }))}
                onValueChange={(value) => update({ startBlock: value })}
                searchPlaceholder="기존 진도표에서 단원 검색"
              />
            </div>
            <div>
              <span className={styles.fieldLabel}>{track === "regular" ? "완료 목표 단원" : "복습·심화 목표 단원"}</span>
              <SearchableSelect
                ariaLabel="완료 목표 단원"
                value={goal.endBlock}
                options={blocks.map((b) => ({
                  value: b,
                  label: b,
                }))}
                onValueChange={(value) => update({ endBlock: value })}
                searchPlaceholder="기존 진도표에서 단원 검색"
              />
            </div>
            <label>
              교재
              <input
                aria-label="목표 교재"
                value={goal.textbook ?? ""}
                maxLength={500}
                onChange={(e) => update({ textbook: e.target.value || null })}
                placeholder="교재 이름 (선택)"
                list="mcs-goal-books"
              />
            </label>
            <datalist id="mcs-goal-books">
              {data.bookOptions.map((book) => (
                <option key={book} value={book} />
              ))}
            </datalist>
          </fieldset>
          <div className={styles.planPreview} aria-live="polite">
            <strong>
              {validation
                ? "시작·완료 블록과 기간을 확인해 주세요"
                : `전체 ${total}블록 · 월 ${policy.monthlyBlocks}블록 · ${policy.months}개월`}
            </strong>
            <p>{goal.startDate} – {goal.endDate}</p>
            {!validation && preview.length > 0 ? (
              <p>
                오늘까지 {plannedAt(preview, data.today)}블록 · {track === "supplement"
                  ? `수요일 수업 ${preview.length}회 중 4블록 목표`
                  : `수업당 평균 ${(total / preview.length).toFixed(1)}블록`}
                <br />
                {preview.find((day) => day.target === total)?.date} 수업까지 전체 목표 도달
              </p>
            ) : null}
            <p>
              {track === "regular" ? "기존 단원을 24블록에 균등 배분합니다. 월별 8블록을 정규 수업일에 나누고 수요일은 제외합니다." : "수요일 수업 기록을 한 회당 1블록으로 집계합니다. 같은 단원을 반복해도 복습 횟수는 누적됩니다."}
              {" "}휴강일과 수강 기간을 반영합니다.
              {scope === "all"
                ? " 미리보기는 첫 학생 기준이며 학생별 수강 기간에 따라 배분됩니다. 반 전체에 저장하면 기존 전체 목표를 새 설정으로 바꿉니다."
                : ""}
            </p>
          </div>
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          <div className={styles.formActions}>
            {/* 🔴 '초기화'는 **왼쪽 끝**(공용 삭제 규약 `[삭제][취소][저장]`) — 저장 옆에 두지 말 것.
                🔴 원장 이상급에게만 **버튼 자체가 없다**(서버도 같은 함수로 다시 본다 — 화면은 게이트가 아니다). */}
            {canReset ? (
              <button
                type="button"
                className={`${styles.button} ${styles.resetButton}`}
                data-danger={confirmReset || undefined}
                disabled={pending}
                onClick={() => (confirmReset ? reset() : setConfirmReset(true))}
                title={
                  scope === "all"
                    ? "이 반 학생 전체의 이 달 전체 목표를 지웁니다."
                    : "선택한 학생의 이 달 전체 목표를 지웁니다."
                }
              >
                {pending && confirmReset ? "초기화 중…" : confirmReset ? "정말 초기화할까요?" : "초기화"}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.button}
              disabled={pending}
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={pending}
            >
              {pending ? "저장 중…" : "전체 목표 저장"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
