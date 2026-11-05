"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { Loader2, Plus } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { createStudentGrade, type CreateGradeState } from "@/features/students/server/actions";
import { examSlotOptions } from "@/features/grades/exam-slots";
import { TERM_OPTIONS, defaultExamDate, defaultTermOf, normalizeTerm, termYearOptions } from "@/features/grades/term";
import { writeLockedPlaceholder } from "@/lib/write-lock";

/**
 * 학생 상세 '성적' 한 줄 추가 폼 — **성적관리 격자와 같은 어휘**(원장 2026-09-22).
 *
 * 🔴 시험명 자유 입력을 없앴다: 같은 시험이 `중간`·`중간고사`·`1학기 중간`으로 갈리면 추이 차트·성적 급락
 *    감지가 서로 다른 것을 본다. 이제 `년도 · 학기 · 과목 · 시험 칸`이 칸 하나를 가리키고, 그 칸은
 *    성적관리(`/exams`) 격자가 쓰는 칸과 **같다**(같은 칸을 다시 적으면 덮어쓴다).
 * ⚠️ 축 4개는 상태(state)라 저장 뒤에도 그대로 남고, 점수·만점·메모만 비워진다 — 한 학생의 여러 시험을
 *    연달아 적는 흐름이라 축을 매번 다시 고르게 하지 않는다.
 * canWrite = 서버 `createStudentGrade`와 같은 판정(`canWriteTenant(role, "students")`) — page.tsx가 내린다.
 *    읽기 권한이면 칸은 비활성 + 메모 칸에 안내, '성적 추가'는 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      성적 추가
    </Button>
  );
}

const FIELD = "border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60";

export function GradeForm({
  studentId,
  subjectOptions,
  canWrite,
}: {
  studentId: string;
  subjectOptions: { value: string; label: string }[];
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState<CreateGradeState, FormData>(
    createStudentGrade,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const success = state && !state.error;

  const today = kstToday();
  const base = defaultTermOf(today);
  const years = termYearOptions(today);
  const [year, setYear] = useState(base.year);
  const [term, setTerm] = useState(base.term);
  const [subject, setSubject] = useState(subjectOptions[0]?.value ?? "");
  const [slot, setSlot] = useState<string>("");

  // 과목을 바꾸면 그 과목에 없는 칸이 남을 수 있다 — **렌더 중 보정**한다(effect에서 setState 금지, [[#25]]).
  const slots = examSlotOptions(subject);
  const activeSlot = slots.some((s) => s.value === slot) ? slot : (slots[0]?.value ?? "");

  useEffect(() => {
    if (success) formRef.current?.reset();
  }, [success]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-bg-soft/30 border-border rounded-2xl border p-3"
    >
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {/* 시험일 — 년도·학기를 바꾸면 그 학기 기본일로 다시 선다(key 교체 = 비제어 입력 재마운트). */}
        <input
          key={`${year}-${term}`}
          name="takenOn"
          type="date"
          required
          defaultValue={defaultExamDate(year, term, today)}
          disabled={!canWrite}
          className={`${FIELD} num`}
          aria-label="시험일"
        />
        <select
          name="year"
          disabled={!canWrite}
          value={String(year)}
          onChange={(e) => setYear(Number(e.target.value))}
          className={FIELD}
          aria-label="년도"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <select
          name="term"
          disabled={!canWrite}
          value={String(term)}
          onChange={(e) => setTerm(normalizeTerm(e.target.value, base.term))}
          className={FIELD}
          aria-label="학기"
        >
          {TERM_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          name="subject"
          disabled={!canWrite}
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={FIELD}
          aria-label="과목"
        >
          {subjectOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          name="slot"
          disabled={!canWrite}
          required
          value={activeSlot}
          onChange={(e) => setSlot(e.target.value)}
          className={FIELD}
          aria-label="시험"
        >
          {slots.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          name="score"
          disabled={!canWrite}
          type="number"
          step="0.01"
          required
          placeholder="점수"
          className={`${FIELD} num`}
          aria-label="점수"
        />
        <input
          name="maxScore"
          disabled={!canWrite}
          type="number"
          step="0.01"
          placeholder="만점"
          className={`${FIELD} num`}
          aria-label="만점"
        />
        {canWrite ? <Submit /> : null}
      </div>
      <input
        name="notes"
        type="text"
        disabled={!canWrite}
        placeholder={canWrite ? "메모 (선택)" : writeLockedPlaceholder("students")}
        className={`${FIELD} mt-2 w-full`}
        aria-label="메모"
      />
      {state?.error ? <p className="text-chart-4 mt-2 text-xs">{state.error}</p> : null}
    </form>
  );
}
