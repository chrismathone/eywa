"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditingBadge } from "@/features/presence/editing-badge";
import { useEditPresence } from "@/features/presence/edit-presence";
import { ecsPresenceScope } from "@/features/class-sheets/lib/presence-scope";
import { useMonthGoals, type GoalRole } from "@/features/class-sheets/components/use-month-goals";
import type { MonthGoalMap } from "@/features/class-sheets/lib/goal-match";
import type { GoalsBoardRole, RoleGoal } from "@/features/class-sheets/lib/goals-board";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { classNameFor } from "@/features/teacher-view/class-name";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

/** 표의 월·주 줄은 반 시트와 같은 `upsertGoal` 자동저장 큐를 사용한다. */
export function GoalsGoalEditor({
  classId,
  className,
  area,
  scope,
  periodStart,
  items,
  role,
  weekMonday,
  lang,
  onClose,
  onSaved,
}: {
  classId: string;
  className: string;
  area: SkillAreaSetting;
  scope: "month" | "week";
  periodStart: string;
  items: RoleGoal[];
  role: GoalsBoardRole;
  weekMonday: string;
  lang: SheetLang;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = (key: Parameters<typeof sheetT>[1]) => sheetT(lang, key);
  const initial = (owner: GoalRole): MonthGoalMap => {
    const goal = items.find((item) => item.role === owner)?.goal;
    return { [area.key]: { textbook: goal?.textbook ?? null, targetProgress: goal?.targetProgress ?? null } };
  };
  const { goals, setField, flushAll, discardPending, error, savedAt, getError } = useMonthGoals({
    classId,
    scope,
    periodStart,
    initial: { homeroom: initial("homeroom"), assistant: initial("assistant") },
  });
  const [closing, setClosing] = useState(false);
  const [lastEditAt, setLastEditAt] = useState(0);
  const presenceScope = ecsPresenceScope(classId, weekMonday);
  useEditPresence(presenceScope, true);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    await flushAll();
    if (getError()) {
      setClosing(false);
      return;
    }
    onSaved();
    onClose();
  };
  const owners: GoalRole[] = role === "all" ? ["homeroom", "assistant"] : [role];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void close(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            {classNameFor(className, lang)} · {area.label} · {t(scope === "month" ? "goals.month" : "goals.week")}
          </DialogTitle>
          <p className="text-text-dim text-sm">{t("goals.editAutosave")}</p>
        </DialogHeader>
        <EditingBadge scope={presenceScope} />
        <div className="space-y-3">
          {owners.map((owner) => {
            const goal = goals[owner][area.key];
            return (
              <fieldset key={owner} className="border-line-strong space-y-2 rounded-xl border p-3">
                <legend className="px-1 text-sm font-bold">{t(owner === "homeroom" ? "goals.role.homeroom" : "goals.role.assistant")}</legend>
                <label className="block text-sm">
                  <span className="font-semibold">{t("month.goal.book")}</span>
                  <input
                    autoFocus={owner === owners[0]}
                    className="border-line-strong bg-card mt-1 w-full rounded-lg border px-2 py-1.5 outline-none focus:border-primary"
                    value={goal?.textbook ?? ""}
                    maxLength={500}
                    onChange={(e) => { setLastEditAt(Date.now()); setField(owner, area.key, "textbook", e.target.value); }}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold">{t("month.goal.target")}</span>
                  <input
                    className="border-line-strong bg-card mt-1 w-full rounded-lg border px-2 py-1.5 outline-none focus:border-primary"
                    value={goal?.targetProgress ?? ""}
                    maxLength={500}
                    onChange={(e) => { setLastEditAt(Date.now()); setField(owner, area.key, "targetProgress", e.target.value); }}
                  />
                </label>
              </fieldset>
            );
          })}
        </div>
        {error ? <p role="alert" className="text-danger text-sm font-semibold">{error}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <span role="status" className="text-text-dim text-sm">{error ? "" : closing || lastEditAt > (savedAt ?? 0) ? t("toolbar.saving") : savedAt ? t("toolbar.saved") : ""}</span>
          <div className="flex items-center gap-2">
            {error ? (
              <button type="button" onClick={() => { discardPending(); onClose(); }} className="text-text-dim px-2 py-1 text-sm underline">
                {t("goals.discard")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void close()}
              disabled={closing}
              className="border-line-strong hover:border-primary rounded-full border px-3 py-1 text-sm font-bold disabled:opacity-60"
            >
              {t("popup.close")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
