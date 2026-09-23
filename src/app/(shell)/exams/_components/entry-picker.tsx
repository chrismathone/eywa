import { examSlotOptions } from "@/features/grades/exam-slots";
import { axisValueOf } from "@/features/grades/subject-axis";
import type { GradeSelection, GradeSheet } from "@/features/grades/types";
import type { FilterSelectOption } from "@/components/filter-select";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

const FIELD = `${CONTROL_H} ${CONTROL_LABEL} border-line bg-background rounded-lg border px-2`;

/** 시험 명단 고르기(년도·학기·과목·시험·날짜·만점·반) — [명단 보기]를 누르면 원장 맨 위에 그 명단이 선다. */
export function EntryPicker({ selection, sheet, subjectOptions, keep }: {
  selection: GradeSelection; sheet: GradeSheet; subjectOptions: FilterSelectOption[]; keep: Record<string, string>;
}) {
  return <form action="/exams" className="bg-primary-soft/40 border-primary/30 flex flex-wrap items-end gap-2 rounded-2xl border p-3 text-sm">
    <input type="hidden" name="entry" value="1" /><input type="hidden" name="tab" value="records" />
    {Object.entries(keep).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <p className="text-primary basis-full font-bold">새 시험 명단 — 고른 뒤 [명단 보기]를 누르면 아래 원장 맨 위에 학생 명단이 섭니다.</p>
    <label className="grid gap-1">년도<input name="entryYear" type="number" min="2000" max="2100" defaultValue={selection.year} className={`${FIELD} w-24`} /></label>
    <label className="grid gap-1">학기<select name="entryTerm" defaultValue={selection.term} className={FIELD}><option value="1">1학기</option><option value="2">2학기</option></select></label>
    <label className="grid gap-1">과목<select name="entrySubject" defaultValue={axisValueOf(selection)} className={FIELD}>{subjectOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label className="grid gap-1">시험<select name="entrySlot" defaultValue={selection.slot} className={FIELD}>{examSlotOptions(selection.subject).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label className="grid gap-1">시험일<input name="entryDate" type="date" defaultValue={selection.date} className={FIELD} /></label>
    <label className="grid gap-1">기본 만점<input name="entryMax" type="number" min="1" max="1000" step="1" defaultValue={selection.maxScore} className={`${FIELD} w-24`} /></label>
    <label className="grid gap-1">반<select name="entryClass" defaultValue={selection.classId ?? ""} className={FIELD}><option value="">전체</option>{sheet.classes.map((c) => <option key={c.id} value={c.id}>{c.className}</option>)}</select></label>
    <button className={`${CONTROL_H} ${CONTROL_LABEL} bg-primary text-primary-foreground rounded-lg px-4 font-semibold`}>명단 보기</button>
  </form>;
}
