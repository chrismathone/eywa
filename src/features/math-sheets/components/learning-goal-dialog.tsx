"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CURRICULUM_GRADES, flatLessons, semesterOfLesson, resolveStudyGrade } from "@/features/onescreen/curriculum";
import { MATH_LEARNING_CADENCE } from "@/features/progress/learning-cadence";
import { learningBlocks, learningDays, learningGoalError, goalMilestones, planLearningGoal, plannedAt, standardGoalDates, type LearningData, type LearningGoal } from "../lib/learning-plan";
import { learningTopics } from "../lib/learning-path";
import type { MathSheetMonthData } from "../server/month-queries";
import { resetMathLearningGoals, saveMathLearningGoals } from "../server/learning-actions";
import { LearningMilestones } from "./learning-milestones";
import styles from "./learning-overview.module.css";

export function LearningGoalDialog({ data, learning, studentId, onClose, canReset = false }: {
  data: MathSheetMonthData; learning: LearningData; studentId: string | null; onClose: () => void; canReset?: boolean;
}) {
  const router = useRouter();
  const eligible = data.students.filter((s) => s.rosterPhase !== "ended");
  const withoutGoal = eligible.filter((s) => !learning.goals[s.studentId]);
  const [scope, setScope] = useState(studentId ?? (withoutGoal.length ? "all" : eligible[0]?.studentId ?? "all"));
  const track = learning.track ?? "regular";
  const policy = MATH_LEARNING_CADENCE[track];
  const goalForStudent = (id: string): LearningGoal => {
    const student = data.students.find((s) => s.studentId === id) ?? withoutGoal[0] ?? eligible[0];
    const saved = learning.goals[student?.studentId ?? ""];
    if (saved) return { ...saved, track };
    const resolved = resolveStudyGrade(student?.rail?.nowGrade ?? student?.grade ?? "중1");
    const grade = CURRICULUM_GRADES.includes(resolved) ? resolved : "중1";
    const topics = flatLessons(grade);
    const recent = student?.rail?.nowLesson ?? "";
    const start = topics.includes(recent) ? recent : topics[0] ?? "";
    const semester = semesterOfLesson(grade, start);
    return {
      studentId: student?.studentId ?? "", studyGrade: grade, endStudyGrade: grade, startBlock: start,
      endBlock: track === "supplement" ? start : topics.filter((topic) => semesterOfLesson(grade, topic) === semester).at(-1) ?? start,
      ...standardGoalDates(data.month, track), track,
      textbook: data.goals[student?.studentId ?? ""]?.textbook ?? null,
    };
  };
  const [draft, setDraft] = useState<LearningGoal>(() => goalForStudent(scope));
  const previous = scope !== "all" && learning.goals[scope]?.blockCount ? learning.goals[scope] : undefined;
  const goal = planLearningGoal(draft, previous);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectedIds = scope === "all" ? withoutGoal.map((s) => s.studentId) : [scope];
  const validation = learningGoalError(goal);
  const preview = validation ? [] : learningDays({ ...goal, studentId: selectedIds[0] ?? "" }, learning.context);
  const total = learningBlocks(goal).length;
  const endGrade = draft.endStudyGrade ?? draft.studyGrade;
  const update = (patch: Partial<LearningGoal>) => {
    setDraft((value) => ({ ...value, ...patch })); setError(null); setConfirmReset(false);
  };
  const selectScope = (id: string) => {
    setScope(id); setDraft(goalForStudent(id)); setError(null); setConfirmReset(false);
  };
  const reset = () => startTransition(async () => {
    try {
      const result = await resetMathLearningGoals({ classId: data.classId, studentIds: selectedIds, track, startDate: draft.startDate, standard: draft.blockCount != null });
      if (!result.ok) { setError(result.error); setConfirmReset(false); return; }
      router.refresh(); onClose();
    } catch { setError("전체 목표를 초기화하지 못했습니다. 다시 시도해 주세요."); setConfirmReset(false); }
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (validation) { setError(validation); return; }
    if (!selectedIds.length) { setError("목표를 설정할 학생을 선택해 주세요."); return; }
    if (!preview.length) { setError("목표 기간에 수업이 없는 달이 있습니다. 반의 시간표와 수강 기간을 확인해 주세요."); return; }
    startTransition(async () => {
      try {
        const result = await saveMathLearningGoals({ ...goal, classId: data.classId, studentIds: selectedIds, mode: previous ? "extend" : "create" });
        if (!result.ok) { setError(result.error); return; }
        router.refresh(); onClose();
      } catch { setError("목표를 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요."); }
    });
  };
  const lessonOptions = (grade: string) => flatLessons(grade).map((lesson) => ({ value: lesson, label: `${/^[초중]/.test(grade) ? `${semesterOfLesson(grade, lesson)}학기 · ` : ""}${lesson}` }));
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className={`sm:max-w-2xl max-h-[90dvh] overflow-y-auto ${styles.goalDialog}`} showCloseButton={!pending}>
        <DialogTitle>{previous ? "다음 목표 확장" : "전체 목표 설정"}</DialogTitle>
        <DialogDescription>
          {previous ? "이전 목표를 정거장으로 남겨두고 다음 도착점을 추가합니다. 기존 구간과 목표일은 유지됩니다." : "현재 시작 단원부터 최종 도착점까지 정하세요. 학년과 과정을 넘어 목표를 설정할 수 있습니다."}
        </DialogDescription>
        <form onSubmit={submit} className={styles.goalForm}>
          <fieldset disabled={pending}>
            <label>적용 대상
              <select aria-label="목표 적용 대상" value={scope} onChange={(e) => selectScope(e.target.value)}>
                {withoutGoal.length ? <option value="all">목표 없는 학생 전체 · {withoutGoal.length}명</option> : null}
                {data.students.map((s) => <option key={s.studentId} value={s.studentId}>{s.name}{s.rosterPhase === "ended" ? " (수강 종료)" : ""}</option>)}
              </select>
            </label>
            {previous ? <div><span className={styles.fieldLabel}>이전 목표 정거장</span><LearningMilestones goal={previous} progress={learning.progress[scope]} /></div> : (
              <section className={styles.goalEndpoint}>
                <h3>시작 지점</h3>
                <div className={styles.formPair}>
                  <label>시작 과정<select aria-label="시작 과정" value={draft.studyGrade} onChange={(e) => {
                    const topics = flatLessons(e.target.value);
                    update({ studyGrade: e.target.value, startBlock: topics[0] ?? "", endStudyGrade: e.target.value, endBlock: topics.at(-1) ?? "" });
                  }}>{CURRICULUM_GRADES.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
                  <label>시작 월<input aria-label="목표 시작 월" type="month" required value={draft.startDate.slice(0, 7)} onChange={(e) => {
                    if (/^\d{4}-\d{2}$/.test(e.target.value)) update(standardGoalDates(e.target.value, track));
                  }} /></label>
                </div>
                <div><span className={styles.fieldLabel}>시작 단원</span><SearchableSelect ariaLabel="시작 단원" value={draft.startBlock} options={lessonOptions(draft.studyGrade)} onValueChange={(startBlock) => update({ startBlock })} searchPlaceholder="시작 단원 검색" /></div>
              </section>
            )}
            <section className={styles.goalEndpoint}>
              <h3>{previous ? `${goalMilestones(previous).length + 1}차 목표` : "1차 목표"} · 최종 도착점</h3>
              <label>최종 목표 과정<select aria-label="최종 목표 과정" value={endGrade} onChange={(e) => update({ endStudyGrade: e.target.value, endBlock: flatLessons(e.target.value).at(-1) ?? "" })}>
                {CURRICULUM_GRADES.map((grade) => <option key={grade}>{grade}</option>)}
              </select></label>
              <div><span className={styles.fieldLabel}>최종 목표 단원</span><SearchableSelect ariaLabel="최종 목표 단원" value={draft.endBlock} options={lessonOptions(endGrade)} onValueChange={(endBlock) => update({ endBlock })} searchPlaceholder="최종 목표 단원 검색" /></div>
            </section>
            <label>교재<input aria-label="목표 교재" value={draft.textbook ?? ""} maxLength={500} onChange={(e) => update({ textbook: e.target.value || null })} placeholder="교재 이름 (선택)" list="mcs-goal-books" /></label>
            <datalist id="mcs-goal-books">{data.bookOptions.map((book) => <option key={book} value={book} />)}</datalist>
          </fieldset>
          <div className={styles.planPreview} aria-live="polite">
            <strong>{validation ? (previous ? "이전 도착점 이후의 목표를 선택해 주세요" : "시작 지점과 최종 도착점을 확인해 주세요") : `전체 ${total}블록 · 월 ${policy.monthlyBlocks}블록`}</strong>
            <p>{[...new Set(learningTopics(goal).map((topic) => topic.grade))].join(" → ")}</p>
            {!validation ? <p>{goal.startDate} 시작 – {goal.endDate} 최종 도착</p> : null}
            {!validation && preview.length ? <p>오늘까지 {plannedAt(preview, data.today)}블록 · 수업당 평균 {(total / preview.length).toFixed(1)}블록</p> : null}
            <p>{track === "regular" ? `각 학기·과정 구간을 ${policy.totalBlocks}블록·${policy.months}개월로 나누고 월 ${policy.monthlyBlocks}블록씩 배분합니다.` : "복습 심화는 월 4블록이며, 수업 기록을 날짜별로 누적합니다."} 이 반의 모든 수업 요일과 휴강일·수강 기간을 반영합니다.</p>
          </div>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <div className={styles.formActions}>
            {canReset && scope !== "all" && learning.goals[scope] ? <button type="button" className={`${styles.button} ${styles.resetButton}`} data-danger={confirmReset || undefined} disabled={pending} onClick={() => confirmReset ? reset() : setConfirmReset(true)}>{confirmReset ? "정말 초기화할까요?" : "초기화"}</button> : null}
            <button type="button" className={styles.button} disabled={pending} onClick={onClose}>취소</button>
            <button type="submit" className={styles.primaryButton} disabled={pending}>{pending ? "저장 중…" : previous ? "다음 목표 추가" : "전체 목표 저장"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
