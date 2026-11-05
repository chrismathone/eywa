"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Plus, Save, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import {
  createStudentGoal,
  deleteStudentGoal,
  type GoalState,
} from "@/features/students/server/actions";
import type { GradeGoalRow } from "@/features/students/server/queries";
import { goalAchievementRate } from "@/features/students/detail/grades-meta";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { examSlotOptions, isExamSlot, slotUsesMonth } from "@/features/grades/exam-slots";
import { TERM_OPTIONS, defaultTermOf, normalizeTerm, termMonths, termYearOptions } from "@/features/grades/term";
import { GoalBadge } from "@/features/grades/components/goal-badge";
import { kstToday } from "@/lib/date-kst";

const inputCls =
  "border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

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
  // 성적 입력과 **같은 칸 축**(원장 2026-09-24) — 년도·학기·과목·시험(월말평가면 월). 서버가 같은 규칙(parseGoalAxis)으로 다시 본다.
  const today = kstToday();
  const base = defaultTermOf(today);
  const [year, setYear] = useState(String(base.year));
  const [term, setTerm] = useState(String(base.term));
  const slots = examSlotOptions(subject);
  const [slotRaw, setSlot] = useState("");
  const slot = slots.some((o) => o.value === slotRaw) ? slotRaw : slots[0]?.value ?? "";
  const months = termMonths(normalizeTerm(term, base.term));
  const thisMonth = Number(today.slice(5, 7));
  const [monthRaw, setMonth] = useState(String(thisMonth));
  const month = months.includes(Number(monthRaw)) ? monthRaw : String(months[0]);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-bold">목표 설정</h2>
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
              <span className="text-foreground block text-sm font-medium">년도</span>
              <select name="year" value={year} onChange={(e) => setYear(e.target.value)} className={inputCls}>
                {termYearOptions(today).map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">학기</span>
              <select name="term" value={term} onChange={(e) => setTerm(e.target.value)} className={inputCls}>
                {TERM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">과목</span>
              <select name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls}>
                {subjects.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">시험</span>
              <select name="slot" value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
                {slots.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {isExamSlot(slot) && slotUsesMonth(slot) ? <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">월</span>
              <select name="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
                {months.map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
            </label> : <input type="hidden" name="month" value="0" />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">목표 점수 *</span>
              <input name="targetScore" type="number" step="0.01" className={`${inputCls} num`} />
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">만점 *</span>
              <input
                name="maxScore"
                required
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
            이 시험의 성적이 입력되면 달성 여부가 자동 표시됩니다(성적관리·원생 상세 같은 칸).
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

/**
 * canWrite = 서버 `requireGradeWrite`(students full|scoped)와 같은 판정 — page.tsx의 `canWriteTenant(role, "students")`.
 * 읽기 권한이면 '추가'·삭제를 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */
export function GoalsSection({ studentId, goals, canWrite }: { studentId: string; goals: GradeGoalRow[]; canWrite: boolean }) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(false);
  const rate = goalAchievementRate(goals);

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground text-sm font-bold">시험 목표</h3>
          {rate.resolved > 0 ? (
            <span className="text-muted-foreground num text-xs">
              달성률{" "}
              <span className="text-primary font-bold">{rate.pct}%</span> ({rate.achieved}/
              {rate.resolved})
            </span>
          ) : null}
        </div>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" />
            추가
          </Button>
        ) : null}
      </header>

      {goals.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-2xl border border-dashed py-6 text-center text-xs">
          설정된 목표가 없습니다
        </p>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
              <li key={g.id} className="bg-card border-border rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={subjects.colorOf(g.subject)} soft>
                      {subjects.labelOf(g.subject)}
                    </Pill>
                    <span className="text-foreground text-sm font-bold">{g.examName}</span>
                    <GoalBadge goal={{ target: g.targetScore, max: g.maxScore, status: g.status }} />
                    {g.actualScore != null ? (
                      <span className="num text-muted-foreground text-xs">
                        실제 <b className="text-foreground">{g.actualScore}점{g.actualMaxScore != null ? ` / ${g.actualMaxScore}점` : ""}</b>
                      </span>
                    ) : null}
                  </div>
                  {canWrite ? <DeleteGoalBtn id={g.id} studentId={studentId} /> : null}
                </div>
                {g.reason ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">{g.reason}</p>
                ) : null}
              </li>
          ))}
        </ul>
      )}

      {open && canWrite ? <GoalDialog studentId={studentId} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
