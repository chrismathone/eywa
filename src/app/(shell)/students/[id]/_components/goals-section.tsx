"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Plus, Save, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import {
  createStudentGoal,
  deleteStudentGoal,
  type GoalState,
} from "@/features/students/server/actions";
import type { GradeGoalRow } from "@/features/students/server/queries";
import { goalAchievementRate, scorePct } from "@/features/students/grades-meta";
import { useSubjectMaps } from "@/features/owner/operations-context";

const inputCls =
  "border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

function GoalDialog({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<GoalState, FormData>(createStudentGoal, undefined);
  const [subject, setSubject] = useState(subjects.options[0]?.value ?? "");

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-semibold">목표 설정</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="studentId" value={studentId} />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">과목</span>
              <select
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              >
                {subjects.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">시험명 *</span>
              <input name="examName" className={inputCls} placeholder="예: 3월 모의고사" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">목표 점수 *</span>
              <input name="targetScore" type="number" step="0.01" className={`${inputCls} num`} />
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">만점</span>
              <input
                name="maxScore"
                type="number"
                step="0.01"
                defaultValue={100}
                className={`${inputCls} num`}
              />
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">사유 / 메모</span>
            <textarea name="reason" rows={2} className={`${inputCls} resize-y`} placeholder="선택" />
          </label>

          <p className="text-muted-foreground text-xs">
            시험명·과목이 일치하는 성적이 입력되면 달성 여부가 자동 표시됩니다.
          </p>

          {state?.error ? (
            <p className="text-danger inline-flex items-center gap-1.5 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <SubmitBtn />
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteGoalBtn({ id, studentId }: { id: string; studentId: string }) {
  const [, action] = useActionState<GoalState, FormData>(deleteStudentGoal, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="studentId" value={studentId} />
      <button type="submit" className="text-muted-foreground hover:text-danger p-1" aria-label="삭제">
        <Trash2 className="size-3.5" />
      </button>
    </form>
  );
}

export function GoalsSection({ studentId, goals }: { studentId: string; goals: GradeGoalRow[] }) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(false);
  const rate = goalAchievementRate(goals);

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground text-sm font-semibold">시험 목표</h3>
          {rate.resolved > 0 ? (
            <span className="text-muted-foreground num text-xs">
              달성률{" "}
              <span className="text-primary font-bold">{rate.pct}%</span> ({rate.achieved}/
              {rate.resolved})
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          추가
        </Button>
      </header>

      {goals.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed py-6 text-center text-xs">
          설정된 목표가 없습니다
        </p>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => {
            const targetPct = scorePct(g.targetScore, g.maxScore);
            const actualPct = scorePct(g.actualScore, g.actualMaxScore ?? g.maxScore);
            return (
              <li key={g.id} className="bg-card border-border rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={subjects.colorOf(g.subject)} soft>
                      {subjects.labelOf(g.subject)}
                    </Pill>
                    <span className="text-foreground text-[13px] font-semibold">{g.examName}</span>
                    <span className="num text-muted-foreground text-[12px]">
                      목표{" "}
                      <span className="text-foreground font-semibold">
                        {g.targetScore}
                        {g.maxScore ? `/${g.maxScore}` : ""}
                      </span>
                      {targetPct != null ? ` (${targetPct}%)` : ""}
                    </span>
                    {g.achieved == null ? (
                      <Pill color="neutral" soft>
                        대기
                      </Pill>
                    ) : g.achieved ? (
                      <span className="text-chart-2 inline-flex items-center gap-1 text-[12px] font-semibold">
                        <Check className="size-3.5" /> 달성 {g.actualScore}
                        {actualPct != null ? ` (${actualPct}%)` : ""}
                      </span>
                    ) : (
                      <span className="text-chart-4 inline-flex items-center gap-1 text-[12px] font-semibold">
                        <X className="size-3.5" /> 미달 {g.actualScore}
                        {actualPct != null ? ` (${actualPct}%)` : ""}
                      </span>
                    )}
                  </div>
                  <DeleteGoalBtn id={g.id} studentId={studentId} />
                </div>
                {g.reason ? (
                  <p className="text-muted-foreground mt-1.5 text-[12px]">{g.reason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {open ? <GoalDialog studentId={studentId} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
