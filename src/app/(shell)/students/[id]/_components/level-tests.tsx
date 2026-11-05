"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, Loader2, Plus, Save, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill, type PillColor } from "@/components/atoms/pill";
import {
  createStudentLevelTest,
  deleteStudentLevelTest,
  type LevelTestState,
} from "@/features/students/server/actions";
import type { LevelTestRow } from "@/features/students/server/queries";
import { useSubjectMaps } from "@/features/owner/operations-context";

// 과목별 세부점수 키 — 서버 액션(LEVEL_SUBSCORE_KEYS)과 동기 유지.
// ⚠️ 알려진 예외: 세부점수 차원은 operations 스키마 밖 도메인 메타라 하드코딩 유지(과목 라벨/선택지는 설정 기반).
const SUBSCORE_KEYS: Record<string, string[]> = {
  math: ["계산", "이해", "추론", "문제해결"],
  english: ["어휘", "문법", "청해", "독해"],
};
const TYPE_META: Record<string, { label: string; color: PillColor }> = {
  placement: { label: "배치", color: "blue" },
  promotion: { label: "승급", color: "primary" },
  diagnostic: { label: "진단", color: "amber" },
};
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

function Dialog({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<LevelTestState, FormData>(
    createStudentLevelTest,
    undefined,
  );
  const [subject, setSubject] = useState(subjects.options[0]?.value ?? "");
  const today = kstToday();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-bold">레벨테스트 추가</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="studentId" value={studentId} />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">유형</span>
              <select name="testType" defaultValue="placement" className={inputCls}>
                <option value="placement">배치</option>
                <option value="promotion">승급</option>
                <option value="diagnostic">진단</option>
              </select>
            </label>
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">시험일 *</span>
              <input name="testedOn" type="date" defaultValue={today} className={inputCls} />
            </label>
            <label className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">결과 레벨/반</span>
              <input name="level" className={inputCls} placeholder="예: 상위반, Lv.5" />
            </label>
          </div>

          <div className="border-border rounded-md border p-3">
            <p className="micro mb-2">세부 점수 ({subjects.labelOf(subject)})</p>
            <div className="grid grid-cols-2 gap-2">
              {(SUBSCORE_KEYS[subject] ?? []).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <span className="text-muted-foreground w-16 text-xs">{k}</span>
                  {/* step="1"이면 브라우저가 67.5를 유효하지 않다고 막는다(서버는 Number로 이미 소수를 받는다). */}
                  <input
                    name={`sub_${k}`}
                    type="number"
                    step="0.01"
                    className={`${inputCls} num text-right`}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-foreground block text-sm font-medium">메모</span>
            <textarea name="notes" rows={2} className={`${inputCls} resize-y`} placeholder="선택" />
          </label>

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

function DeleteBtn({ id, studentId }: { id: string; studentId: string }) {
  const [, action] = useActionState<LevelTestState, FormData>(deleteStudentLevelTest, undefined);
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
 * canWrite = 서버 `createStudentLevelTest`·`deleteStudentLevelTest`와 같은 판정(`canWriteTenant(role, "students")`) — page.tsx가 내린다.
 * 읽기 권한이면 '추가'·삭제를 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */
export function LevelTests({ studentId, tests, canWrite }: { studentId: string; tests: LevelTestRow[]; canWrite: boolean }) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(false);
  // 폼 닫힘은 제출 후 라우터 revalidate로 목록 갱신되며, 사용자가 닫기/취소로 닫는다.

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-bold">레벨테스트</h3>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" />
            추가
          </Button>
        ) : null}
      </header>

      {tests.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-2xl border border-dashed py-6 text-center text-xs">
          기록된 레벨테스트가 없습니다
        </p>
      ) : (
        <ul className="space-y-2">
          {tests.map((t) => {
            const meta = TYPE_META[t.testType] ?? { label: t.testType, color: "neutral" as PillColor };
            const subs = t.subscores ? Object.entries(t.subscores) : [];
            return (
              <li key={t.id} className="bg-card border-border rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={meta.color} soft>
                      {meta.label}
                    </Pill>
                    <span className="text-foreground text-sm font-bold">
                      {subjects.labelOf(t.subject)}
                    </span>
                    {t.level ? <span className="text-primary text-xs font-bold">{t.level}</span> : null}
                    <span className="text-muted-foreground num text-xs">{t.testedOn}</span>
                  </div>
                  {canWrite ? <DeleteBtn id={t.id} studentId={studentId} /> : null}
                </div>
                {subs.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {subs.map(([k, v]) => (
                      <span key={k} className="bg-bg-soft text-text-dim num rounded-full px-1.5 py-0.5 text-xs">
                        {k} <span className="text-foreground font-bold">{v}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {t.notes ? <p className="text-muted-foreground mt-1.5 text-xs">{t.notes}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      {open && canWrite ? <Dialog studentId={studentId} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
