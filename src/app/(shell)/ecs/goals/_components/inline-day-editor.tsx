"use client";

import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { getEcsDayPlan } from "@/features/class-sheets/server/day-plan";
import { ECS_PLAN_API } from "@/features/class-sheets/components/plan-api";
import { isMeaningfulPlanLine, normalizePlanText, type PlanLineTexts } from "@/features/class-sheets/lib/plan-codec";
import { buildSaveKey, type PlanFieldPatch } from "@/features/class-sheets/lib/save-keys";
import { useEditPresence } from "@/features/presence/edit-presence";
import { ecsPresenceScope } from "@/features/class-sheets/lib/presence-scope";
import type { MonthSlot } from "@/features/class-sheets/lib/month-assemble";
import type { PlanLineDTO } from "@/features/class-sheets/server/actions";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

type Field = keyof PlanLineTexts;
type DraftLine = PlanLineTexts & {
  id: string | null;
  slotStart: string;
  termMode: "regular" | "exam";
  lineNo: number;
  before: PlanLineTexts;
};
const FIELDS: { field: Field; column: PlanFieldPatch["field"]; label: "month.goal.book" | "plan.col.pageTime" | "plan.col.progress" | "plan.col.homework" }[] = [
  { field: "textbook", column: "textbook", label: "month.goal.book" },
  { field: "pageRange", column: "page_range", label: "plan.col.pageTime" },
  { field: "progress", column: "progress", label: "plan.col.progress" },
  { field: "homework", column: "homework", label: "plan.col.homework" },
];
const EMPTY: PlanLineTexts = { textbook: null, pageRange: null, progress: null, homework: null };

function toDraft(line: PlanLineDTO): DraftLine {
  const before = { textbook: line.textbook, pageRange: line.pageRange, progress: line.progress, homework: line.homework };
  return { ...before, id: line.id, slotStart: line.slotStart, termMode: line.termMode, lineNo: line.lineNo, before };
}

export function InlineDayEditor({ classId, area, date, weekMonday, slots, lang, onClose, onSaved }: {
  classId: string; area: string; date: string; weekMonday: string; slots: MonthSlot[];
  lang: SheetLang; onClose: () => void; onSaved: () => void;
}) {
  const feedback = useSheetFeedback();
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [knownIds, setKnownIds] = useState<Record<string, string[]>>({});
  const [showExamTerm, setShowExamTerm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const savedAny = useRef(false);
  const t = (key: Parameters<typeof sheetT>[1]) => sheetT(lang, key);
  useEditPresence(ecsPresenceScope(classId, weekMonday), true);

  useEffect(() => {
    let active = true;
    void getEcsDayPlan({ classId, planDate: date }).then((result) => {
      if (!active) return;
      if (!result.ok) { setError(feedback(result.error)); return; }
      if (!result.data.canEdit) { setError(feedback("이 반의 계획을 수정할 권한이 없습니다.")); return; }
      const all = slots.flatMap((slot) => result.data.linesBySlot[slot.slotStart] ?? []);
      const areaLines = all.filter((line) => line.skillArea === area);
      const meaningful = areaLines.filter(isMeaningfulPlanLine);
      const selected = meaningful.length > 0 ? meaningful : areaLines.slice(0, 1);
      setKnownIds(Object.fromEntries(slots.map((slot) => [slot.slotStart,
        (result.data.linesBySlot[slot.slotStart] ?? []).map((line) => line.id)])));
      setShowExamTerm(result.data.showExamTerm);
      setLines(selected.length > 0 ? selected.map(toDraft) : [{ ...EMPTY, id: null, slotStart: slots[0]!.slotStart,
        termMode: "regular", lineNo: 1, before: EMPTY }]);
    }).catch(() => { if (active) setError(feedback("일간 계획을 불러오지 못했습니다. 다시 시도해 주세요.")); });
    return () => { active = false; };
  }, [area, classId, date, feedback, slots]);

  const close = () => { if (savedAny.current) onSaved(); onClose(); };
  const save = async () => {
    if (busy.current || !lines) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const usedIds = new Set(Object.values(knownIds).flat());
      for (const line of lines) {
        const next = Object.fromEntries(FIELDS.map(({ field }) => [field, normalizePlanText(line[field])])) as PlanLineTexts;
        if (!line.id && !isMeaningfulPlanLine(next)) continue;
        const ref = { classId, planDate: date, slotStart: line.slotStart };
        let id = line.id;
        let before = line.before;
        if (!id) {
          const created = await ECS_PLAN_API.createLine(ref, { termMode: line.termMode, skillArea: area });
          if (!created.ok) { setError(feedback(created.error)); return; }
          const fresh = created.lines.find((item) => item.skillArea === area && !usedIds.has(item.id));
          if (!fresh) { setError(feedback("새 계획 줄을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.")); return; }
          id = fresh.id;
          usedIds.add(id);
          before = { textbook: fresh.textbook, pageRange: fresh.pageRange, progress: fresh.progress, homework: fresh.homework };
          savedAny.current = true;
        }
        const patches = FIELDS.flatMap(({ field, column }): PlanFieldPatch[] => {
          const previous = normalizePlanText(before[field]);
          if (previous === next[field]) return [];
          return [{ lineId: id!, saveKey: buildSaveKey(id!, column), field: column,
            expectedValue: previous, newValue: next[field], clientRev: 1 }];
        });
        if (patches.length === 0) continue;
        const result = await ECS_PLAN_API.flushPatches(ref, patches);
        if (!result.ok) { setError(feedback(result.error)); return; }
        if (result.results.some((item) => item.status === "applied" || item.status === "already_applied")) {
          savedAny.current = true;
        }
        const failed = result.results.find((item) => item.status !== "applied" && item.status !== "already_applied");
        if (failed) {
          setError(feedback(failed.status === "error" ? failed.error : "다른 화면에서 계획이 바뀌었습니다. 새로고침 후 다시 시도해 주세요."));
          return;
        }
      }
      close();
    } catch { setError(feedback("저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.")); }
    finally { busy.current = false; setSaving(false); }
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void save();
  };
  return <div className="min-w-0 space-y-1 rounded border border-primary bg-card p-1.5 text-xs" onBlur={onBlur}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy.current) close(); }
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); }
    }}>
    <b>{t("goals.day")}</b>
    {lines?.map((line, index) => <div key={line.id ?? `new-${index}`} className="space-y-1 border-t border-line pt-1">
      <span className="text-text-dim">{line.slotStart}{lines.length > 1 ? ` · ${line.lineNo}` : ""}</span>
      {!line.id && slots.length > 1 ? <select aria-label={`${t("goals.day")} ${index + 1} 시간`}
        className="border-line-strong w-full rounded border px-1 py-1" value={line.slotStart} disabled={saving}
        onChange={(event) => setLines((prev) => prev!.map((item, i) => i === index ? { ...item, slotStart: event.target.value } : item))}>
        {slots.map((slot) => <option key={slot.slotStart} value={slot.slotStart}>{slot.slotStart}</option>)}
      </select> : null}
      {!line.id && showExamTerm ? <select aria-label={t("plan.term.regular")} value={line.termMode}
        className="border-line-strong w-full rounded border px-1 py-1"
        onChange={(event) => setLines((prev) => prev!.map((item, i) => i === index ? { ...item, termMode: event.target.value as "regular" | "exam" } : item))}>
        <option value="regular">{t("plan.term.regular")}</option><option value="exam">{t("plan.term.exam")}</option>
      </select> : null}
      {FIELDS.map(({ field, label }) => <input key={field} autoFocus={index === 0 && field === "textbook"}
        aria-label={`${t("goals.day")} ${line.slotStart} ${t(label)}`} placeholder={t(label)}
        className="border-line-strong w-full rounded border px-1.5 py-1 outline-none focus:border-primary"
        value={line[field] ?? ""} maxLength={500} disabled={saving}
        onChange={(event) => setLines((prev) => prev!.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item))} />)}
    </div>)}
    {!lines && !error ? <span role="status" className="text-text-dim">{t("month.editor.loading")}</span> : null}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
    {lines ? <button type="button" className="text-primary underline" disabled={saving}
      onClick={() => setLines((prev) => [...prev!, { ...EMPTY, id: null, slotStart: slots[0]!.slotStart,
        termMode: "regular", lineNo: prev!.length + 1, before: EMPTY }])}>{t("plan.addRow")}</button> : null}
    <div className="flex justify-end gap-2">
      <button type="button" onClick={close} disabled={saving} className="text-text-dim underline">{t("goals.discard")}</button>
      {lines ? <button type="button" onClick={() => void save()} disabled={saving} className="text-primary font-semibold">{saving ? t("toolbar.saving") : t("me.save")}</button> : null}
    </div>
  </div>;
}
