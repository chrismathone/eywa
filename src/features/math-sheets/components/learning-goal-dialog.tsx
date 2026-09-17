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
  flatLessons,
  resolveStudyGrade,
} from "@/features/onescreen/curriculum";
import { addDays } from "@/lib/date-kst";
import {
  goalBlocks,
  learningDays,
  learningGoalError,
  plannedAt,
  recordBlockIndex,
  type LearningData,
  type LearningGoal,
} from "../lib/learning-plan";
import type { MathSheetMonthData } from "../server/month-queries";
import { saveMathLearningGoals } from "../server/learning-actions";
import styles from "./learning-overview.module.css";

export function LearningGoalDialog({
  data,
  learning,
  studentId,
  onClose,
}: {
  data: MathSheetMonthData;
  learning: LearningData;
  studentId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scope, setScope] = useState(studentId ?? "all");
  const eligible = data.students.filter((s) => s.rosterPhase !== "ended");
  const initialStudent =
    data.students.find((s) => s.studentId === studentId) ?? eligible[0];
  const initialGrade = resolveStudyGrade(
    initialStudent?.rail?.nowGrade ?? initialStudent?.grade ?? "중1",
  );
  const grade = CURRICULUM_GRADES.includes(initialGrade) ? initialGrade : "중1";
  const initialBlocks = flatLessons(grade);
  const recent = initialStudent?.rail?.nowLesson ?? "";
  const recentIndex = recordBlockIndex(recent, grade);
  const legacyTarget =
    data.goals[initialStudent?.studentId ?? ""]?.targetProgress ?? "";
  const legacyEnd = recordBlockIndex(legacyTarget, grade);
  const fallback: LearningGoal = {
    studentId: initialStudent?.studentId ?? "",
    studyGrade: grade,
    startBlock:
      initialBlocks[
        recentIndex == null
          ? 0
          : Math.min(recentIndex + 1, initialBlocks.length - 1)
      ] ?? "",
    endBlock:
      initialBlocks[
        legacyEnd != null && legacyEnd > (recentIndex ?? -1)
          ? legacyEnd
          : initialBlocks.length - 1
      ] ?? "",
    startDate: data.today,
    endDate: addDays(data.today, 90),
    textbook: data.goals[initialStudent?.studentId ?? ""]?.textbook ?? null,
  };
  const [goal, setGoal] = useState<LearningGoal>(
    () => learning.goals[initialStudent?.studentId ?? ""] ?? fallback,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blocks = useMemo(() => flatLessons(goal.studyGrade), [goal.studyGrade]);
  const selectedIds =
    scope === "all" ? eligible.map((s) => s.studentId) : [scope];
  const previewGoal = { ...goal, studentId: selectedIds[0] ?? "" };
  const preview = learningDays(previewGoal, learning.context);
  const total = goalBlocks(goal).length;
  const validation = learningGoalError(goal);
  const update = (patch: Partial<LearningGoal>) => {
    setGoal((previous) => ({ ...previous, ...patch }));
    setError(null);
  };
  const selectScope = (id: string) => {
    setScope(id);
    setError(null);
    if (learning.goals[id]) setGoal(learning.goals[id]);
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
        "목표 기간에 수업이 없습니다. 기간과 반 시간표를 확인해 주세요.",
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
          시작·완료 블록과 기간을 정하면 반 시간표와 학원 휴강일에 맞춰
          월간·주간·일간 목표를 자동 배분합니다.
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
                    const next = flatLessons(e.target.value);
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
            <div>
              <span className={styles.fieldLabel}>시작 블록</span>
              <SearchableSelect
                ariaLabel="시작 블록"
                value={goal.startBlock}
                options={blocks.map((b, i) => ({
                  value: b,
                  label: b,
                  hint: `${i + 1}블록`,
                }))}
                onValueChange={(value) => update({ startBlock: value })}
                searchPlaceholder="시작 블록 검색"
              />
            </div>
            <div>
              <span className={styles.fieldLabel}>완료 목표 블록</span>
              <SearchableSelect
                ariaLabel="완료 목표 블록"
                value={goal.endBlock}
                options={blocks.map((b, i) => ({
                  value: b,
                  label: b,
                  hint: `${i + 1}블록`,
                }))}
                onValueChange={(value) => update({ endBlock: value })}
                searchPlaceholder="목표 블록 검색"
              />
            </div>
            <div className={styles.formPair}>
              <label>
                시작일
                <input
                  aria-label="목표 시작일"
                  type="date"
                  required
                  value={goal.startDate}
                  onChange={(e) => update({ startDate: e.target.value })}
                />
              </label>
              <label>
                완료 예정일
                <input
                  aria-label="목표 완료 예정일"
                  type="date"
                  required
                  min={goal.startDate}
                  value={goal.endDate}
                  onChange={(e) => update({ endDate: e.target.value })}
                />
              </label>
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
                : `전체 ${total}블록 · 수업 ${preview.length}회`}
            </strong>
            {!validation && preview.length > 0 ? (
              <p>
                오늘까지 {plannedAt(preview, data.today)}블록 · 수업당 평균{" "}
                {(total / preview.length).toFixed(1)}블록
                <br />
                마지막 수업 {preview.at(-1)!.date}에 전체 목표 도달
              </p>
            ) : null}
            <p>
              반 시간표와 학생의 수강 기간을 반영하고 휴강일은 제외합니다.
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
