"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CURRICULUM_GRADES, flatLessons, semesterOfLesson } from "@/features/onescreen/curriculum";
import { goalMilestones, learningDays } from "../lib/learning-plan";
import { addDays } from "@/lib/date-kst";
import type { LearningMilestone } from "../lib/learning-path";
import { learningBlockLabel } from "../lib/learning-label";
import { reviseLearningGoal, revisionBoundary } from "../lib/learning-revision";
import { loadMathLearningGoalRevision, reviseMathLearningGoal, type GoalRevisionData } from "../server/learning-revision-actions";
import styles from "./learning-overview.module.css";

type Props = { classId: string; studentId: string; studentName: string; startDate: string; track: "regular" | "supplement"; goalNumber: number; onClose: () => void };
export function LearningGoalRevisionDialog(props: Props) {
  const [loaded, setLoaded] = useState<GoalRevisionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    loadMathLearningGoalRevision({ classId: props.classId, studentId: props.studentId, startDate: props.startDate, track: props.track })
      .then(result => { if (active) { if (result.ok) setLoaded(result.data); else setLoadError(result.error); } })
      .catch(() => { if (active) setLoadError("현재 계획을 불러오지 못했습니다. 창을 다시 열어 주세요."); });
    return () => { active = false; };
  }, [props.classId, props.studentId, props.startDate, props.track]);
  return <Dialog open onOpenChange={open => { if (!open && !saving) props.onClose(); }}>
    <DialogContent className={`sm:max-w-3xl max-h-[90dvh] overflow-y-auto ${styles.goalDialog}`} showCloseButton={!saving}>
      <DialogTitle>{props.studentName} · 남은 계획 수정</DialogTitle>
      <DialogDescription>목표의 과정·단원·완료일·구간별 분량을 바꾸세요. 적용일부터 남은 수업일에 배분합니다. 지난 수업보고서와 도달한 이전 목표는 보존됩니다.</DialogDescription>
      {loaded ? <RevisionForm {...props} loaded={loaded} onSavingChange={setSaving} />
        : loadError ? <><p role="alert" className={styles.error}>{loadError}</p><button className={styles.button} onClick={props.onClose}>닫기</button></>
        : <p role="status">현재 목표와 진도를 불러오는 중입니다…</p>}
    </DialogContent>
  </Dialog>;
}

function RevisionForm({ loaded, onSavingChange, ...props }: Props & { loaded: GoalRevisionData; onSavingChange: (value: boolean) => void }) {
  const { goal: saved, progress, context, today } = loaded;
  const { lockedStops } = revisionBoundary(saved, progress, today);
  const [stops, setStops] = useState(() => goalMilestones(saved).map((stop, index, list) => ({ ...stop, blocks: stop.blockCount - (list[index - 1]?.blockCount ?? 0) })));
  const [textbook, setTextbook] = useState(saved.textbook ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [navigating, setNavigating] = useState(false);
  const busy = pending || navigating;
  const selectedField = useRef<HTMLInputElement>(null);
  useEffect(() => { selectedField.current?.focus(); }, []);
  const milestones = stops.reduce<LearningMilestone[]>((items, { blocks, ...stop }) => [...items,
    { ...stop, blockCount: (items.at(-1)?.blockCount ?? 0) + blocks }], []);
  const revised = reviseLearningGoal(saved, progress, milestones, textbook.trim() || null, today);
  const days = revised.ok ? learningDays(revised.goal, context) : [];
  const upcoming = days.filter(day => day.date > today);
  const change = (index: number, patch: Partial<typeof stops[number]>) => { setStops(items => items.map((stop, i) => i === index ? { ...stop, ...patch } : stop)); setError(null); };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!revised.ok) { setError(revised.error); return; }
    if (!days.length && milestones.some(stop => stop.endDate > today)) { setError("목표 구간에 수업이 없습니다. 완료일과 수강 기간을 확인해 주세요."); return; }
    onSavingChange(true);
    startTransition(async () => {
      try {
        const result = await reviseMathLearningGoal({ classId: props.classId, studentId: props.studentId, startDate: saved.startDate,
          updatedAt: saved.updatedAt!, track: props.track, expectedCurrentBlock: progress.currentBlock, expectedCurrentDate: progress.currentDate,
          milestones, textbook: textbook.trim() || null });
        if (!result.ok) { setError(result.error); onSavingChange(false); return; }
        setNavigating(true); window.location.reload();
      } catch { setError("남은 계획을 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요."); onSavingChange(false); }
    });
  };
  return <form className={styles.goalForm} onSubmit={save}>
    <p className={styles.meta}>적용일 {today} · 현재 진도 {progress.currentBlock ? learningBlockLabel(progress.currentBlock, saved.studyGrade) : "미확인 (시작 지점부터 배분)"}</p>
    <div className={styles.revisionStops} data-single={stops.length === 1 || undefined}>
      {stops.map((stop, index) => <fieldset key={index} disabled={busy || index < lockedStops} className={styles.revisionStop}>
        <legend>{index + 1}차 목표{index < lockedStops ? " · 이전 목표 유지" : ""}</legend>
        <label>목표 과정<select aria-label={`${index + 1}차 목표 과정`} value={stop.studyGrade} onChange={event => change(index, { studyGrade: event.target.value, endBlock: flatLessons(event.target.value).at(-1)! })}>
          {CURRICULUM_GRADES.map(grade => <option key={grade}>{grade}</option>)}
        </select></label>
        <label>완료 예정일<input ref={index === Math.max(lockedStops, props.goalNumber - 1) ? selectedField : undefined} aria-label={`${index + 1}차 목표 완료 예정일`} type="date" required value={stop.endDate} onChange={event => change(index, { endDate: event.target.value })} /></label>
        <div className={styles.revisionLesson}><span className={styles.fieldLabel}>목표 단원</span>{busy || index < lockedStops ? <input aria-label={`${index + 1}차 목표 단원`} value={learningBlockLabel(stop.endBlock, stop.studyGrade)} disabled readOnly /> : <SearchableSelect ariaLabel={`${index + 1}차 목표 단원`} value={stop.endBlock}
          options={flatLessons(stop.studyGrade).map(lesson => ({ value: lesson, label: `${/^[초중]/.test(stop.studyGrade) ? `${semesterOfLesson(stop.studyGrade, lesson)}학기 · ` : ""}${lesson}` }))}
          onValueChange={endBlock => change(index, { endBlock })} searchPlaceholder="목표 단원 검색" />}</div>
        <label>이 구간의 분량 (블록)<input aria-label={`${index + 1}차 목표 구간 블록 수`} type="number" min={1} max={480} step={1} required value={stop.blocks} onChange={event => change(index, { blocks: Number(event.target.value) })} /></label>
        {index >= lockedStops && stops.length > Math.max(1, lockedStops) ? <button type="button" className={styles.button} onClick={() => { setStops(items => items.filter((_, i) => i !== index)); setError(null); }}>이 목표 제거</button> : null}
      </fieldset>)}
    </div>
    <button type="button" className={styles.button} disabled={busy || stops.length >= 100} onClick={() => {
      const last = stops.at(-1)!;
      setStops(items => [...items, { ...last, endBlock: flatLessons(last.studyGrade).at(-1)!, endDate: addDays([last.endDate, today].sort().at(-1)!, 30), blocks: saved.track === "supplement" ? 4 : 12 }]); setError(null);
    }}>+ 다음 목표 추가</button>
    <label>교재<input aria-label="수정 목표 교재" value={textbook} maxLength={500} disabled={busy} onChange={event => setTextbook(event.target.value)} /></label>
    <div className={styles.planPreview} aria-live="polite">
      <strong>{revised.ok ? `수정 후 남은 수업 ${upcoming.length}회 · 최종 목표 ${revised.goal.endDate}` : revised.error}</strong>
      <p>블록은 진도를 배분하는 계획 단위입니다. 실제 수업 횟수와 다르며, 이 수정 계획에는 월 4블록 자동 기준을 적용하지 않습니다.</p>
      {revised.ok && upcoming.length ? <details><summary>수업일별 변경 계획 보기</summary><div className={styles.revisionPreview}>{upcoming.map(day => <p key={day.date}><time>{day.date}</time> · {day.block ?? "복습·준비"}</p>)}</div></details> : null}
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.formActions}><button type="button" className={styles.button} disabled={busy} onClick={props.onClose}>취소</button>
      <button type="submit" className={styles.primaryButton} disabled={busy || !revised.ok}>{navigating ? "화면 갱신 중…" : pending ? "저장 중…" : "남은 계획 저장"}</button></div>
  </form>;
}
