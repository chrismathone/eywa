"use client";

import { useRef, useState, type FocusEvent } from "react";
import { upsertGoal } from "@/features/class-sheets/server/actions";
import { useEditPresence } from "@/features/presence/edit-presence";
import { ecsPresenceScope } from "@/features/class-sheets/lib/presence-scope";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";
import type { GoalsBoardRole, RoleGoal } from "@/features/class-sheets/lib/goals-board";

type Owner = "homeroom" | "assistant";
type Fields = { textbook: string; targetProgress: string };
type Draft = Record<Owner, Fields>;

function initialDraft(items: RoleGoal[]): Draft {
  const goal = (owner: Owner) => items.find((item) => item.role === owner)?.goal;
  return {
    homeroom: { textbook: goal("homeroom")?.textbook ?? "", targetProgress: goal("homeroom")?.targetProgress ?? "" },
    assistant: { textbook: goal("assistant")?.textbook ?? "", targetProgress: goal("assistant")?.targetProgress ?? "" },
  };
}

export function InlineGoalEditor({ classId, area, scope, periodStart, weekMonday, items, role, lang, onClose, onSaved }: {
  classId: string; area: string; scope: "month" | "week"; periodStart: string; weekMonday: string;
  items: RoleGoal[]; role: GoalsBoardRole; lang: SheetLang; onClose: () => void; onSaved: () => void;
}) {
  const [initial] = useState<Draft>(() => initialDraft(items));
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const savedAny = useRef(false);
  const owners: Owner[] = role === "all" ? ["homeroom", "assistant"] : [role];
  const t = (key: Parameters<typeof sheetT>[1]) => sheetT(lang, key);
  useEditPresence(ecsPresenceScope(classId, weekMonday), true);

  const close = () => { if (savedAny.current) onSaved(); onClose(); };
  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      for (const owner of owners) {
        const before = initial[owner];
        const next = draft[owner];
        if (before.textbook.trim() === next.textbook.trim() && before.targetProgress.trim() === next.targetProgress.trim()) continue;
        const result = await upsertGoal({ classId, skillArea: area, scope, periodStart, role: owner,
          textbook: next.textbook, targetProgress: next.targetProgress });
        if (!result.ok) { setError(result.error); return; }
        savedAny.current = true;
      }
      close();
    } catch { setError("저장 결과를 확인하지 못했습니다. 다시 시도해 주세요."); }
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
    <b>{t(scope === "month" ? "goals.month" : "goals.week")}</b>
    {owners.map((owner, index) => <div key={owner} className="space-y-1">
      {role === "all" ? <span className="text-text-dim font-semibold">{t(owner === "homeroom" ? "goals.role.homeroom" : "goals.role.assistant")}</span> : null}
      <input autoFocus={index === 0} aria-label={`${t(owner === "homeroom" ? "goals.role.homeroom" : "goals.role.assistant")} ${t("month.goal.book")}`}
        className="border-line-strong w-full rounded border px-1.5 py-1 outline-none focus:border-primary" placeholder={t("month.goal.book")}
        value={draft[owner].textbook} maxLength={500} disabled={saving}
        onChange={(event) => setDraft((prev) => ({ ...prev, [owner]: { ...prev[owner], textbook: event.target.value } }))} />
      <input aria-label={`${t(owner === "homeroom" ? "goals.role.homeroom" : "goals.role.assistant")} ${t("month.goal.target")}`}
        className="border-line-strong w-full rounded border px-1.5 py-1 outline-none focus:border-primary" placeholder={t("month.goal.target")}
        value={draft[owner].targetProgress} maxLength={500} disabled={saving}
        onChange={(event) => setDraft((prev) => ({ ...prev, [owner]: { ...prev[owner], targetProgress: event.target.value } }))} />
    </div>)}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
    <div className="flex justify-end gap-2">
      <button type="button" onClick={close} disabled={saving} className="text-text-dim underline">{t("goals.discard")}</button>
      <button type="button" onClick={() => void save()} disabled={saving} className="text-primary font-semibold">{saving ? t("toolbar.saving") : t("me.save")}</button>
    </div>
  </div>;
}
