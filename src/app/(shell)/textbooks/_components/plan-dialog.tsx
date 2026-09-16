"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  deleteClassTextbookPlan,
  saveClassTextbookPlan,
} from "@/features/textbooks/server/plan-actions";
import type { ClassTextbookPlanRow, LessonPace, SlotAxis } from "@/features/textbooks/types";
import type { AssignableClass } from "@/features/textbooks/server/queries";
import { DialogShell, Field, FIELD, FormError, SELECT, useRun } from "./form-bits";

/**
 * 반 교재 배정 — 반 · 교재 · 축 · 차수 단위 · 시작일 · 시작 차수.
 *
 * 🔑 **차수 단위는 여기서 고른다**(원장 2026-09-16 *"반에 배정할 때마다 선택"*) — 같은 책을 반마다 다른
 *    속도로 태울 수 있어야 해서 교재에 고정하지 않았다.
 * 🔑 **축(정규/JJ)도 여기서** — JJ는 자습실이라 정규와 차수가 따로 흐른다(원장 *"JJ실의 경우 자습실이라 별도"*).
 * ⚠️ 저장 게이트는 **그 반의 ECS 쓰기 권한**이다 — 담당이 아닌 반을 골라 저장하면 서버가 한글로 거절한다.
 */
export function PlanDialog({
  plan,
  classes,
  books,
  onClose,
}: {
  plan: ClassTextbookPlanRow | null;
  classes: AssignableClass[];
  books: { id: string; title: string; skillArea: string | null; sessionCount: number }[];
  onClose: () => void;
}) {
  const { busy, error, run } = useRun();
  const [classId, setClassId] = useState(plan?.classId ?? classes[0]?.id ?? "");
  const [textbookId, setTextbookId] = useState(plan?.textbookId ?? books[0]?.id ?? "");
  const [slotAxis, setSlotAxis] = useState<SlotAxis>(plan?.slotAxis ?? "class");
  const [pace, setPace] = useState<LessonPace>(plan?.pace ?? "period");
  const [termMode, setTermMode] = useState<"regular" | "exam">(plan?.termMode ?? "regular");
  const [startDate, setStartDate] = useState(plan?.startDate ?? "");
  const [startLessonNo, setStartLessonNo] = useState(plan?.startLessonNo ?? 1);

  const book = books.find((b) => b.id === textbookId);

  async function onSave() {
    const res = await run(
      () =>
        saveClassTextbookPlan({
          id: plan?.id ?? null,
          classId,
          textbookId,
          slotAxis,
          pace,
          termMode,
          startDate,
          startLessonNo,
        }),
      plan ? "배정을 수정했습니다" : "배정했습니다",
    );
    if (res) onClose();
  }

  return (
    <DialogShell
      title={plan ? `배정 수정 — ${plan.className}` : "새 배정"}
      description="배정만으로는 시트가 바뀌지 않습니다. 목록에서 [미리보기]를 열어 확인한 뒤 기입하세요."
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <FormError error={error} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="반">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className={SELECT}>
              {classes.length === 0 ? <option value="">담당 반이 없습니다</option> : null}
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="교재" hint={book ? `${book.sessionCount}차수` : "구분·차수가 정해진 교재만 고를 수 있습니다"}>
            <select value={textbookId} onChange={(e) => setTextbookId(e.target.value)} className={SELECT}>
              {books.length === 0 ? <option value="">배정할 교재가 없습니다</option> : null}
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="축"
            hint="JJ(자습실)는 정규 수업과 차수가 따로 흐릅니다. 랩실(LAB)은 강사 시트에서 빼 둔 자리라 대상이 아닙니다."
          >
            <select value={slotAxis} onChange={(e) => setSlotAxis(e.target.value as SlotAxis)} className={SELECT}>
              <option value="class">정규 수업 교시</option>
              <option value="jj">JJ 자습실 교시</option>
            </select>
          </Field>
          <Field
            label="차수 단위"
            hint="하루 2교시인 반에서 '교시마다'면 하루에 2차수, '하루에 1차수'면 그 날 두 교시에 같은 차수가 들어갑니다."
          >
            <select value={pace} onChange={(e) => setPace(e.target.value as LessonPace)} className={SELECT}>
              <option value="period">교시마다 1차수 (1시간씩)</option>
              <option value="day">하루에 1차수 (2시간씩)</option>
            </select>
          </Field>

          <Field label="시작일" hint="이 날짜부터 수업이 있는 날에 차례로 들어갑니다. 휴일은 건너뜁니다.">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="시작 차수" hint="중간부터 이어서 태울 때 바꿉니다.">
            <input
              type="number"
              min={1}
              max={book?.sessionCount ?? 200}
              value={startLessonNo}
              onChange={(e) => setStartLessonNo(Number(e.target.value))}
              className={`${FIELD} num`}
            />
          </Field>

          <Field label="시기" hint="시트의 평시/내신 구획 중 어디에 넣을지." className="sm:col-span-2">
            <select
              value={termMode}
              onChange={(e) => setTermMode(e.target.value as "regular" | "exam")}
              className={SELECT}
            >
              <option value="regular">평시</option>
              <option value="exam">내신</option>
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={busy || !classId || !textbookId || !startDate} onClick={() => void onSave()}>
            {busy ? "저장 중…" : plan ? "배정 저장" : "배정"}
          </Button>
          {plan ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("이 배정을 지울까요? 이미 시트에 기입된 내용은 그대로 남습니다.")) return;
                void run(() => deleteClassTextbookPlan(plan.id), "배정을 지웠습니다").then((r) => {
                  if (r) onClose();
                });
              }}
            >
              배정 삭제
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
