"use client";

// 수업계획 표 — 시기(평시/내신) 그룹 헤더 + 가변 행. 행 추가/삭제/시기 이동은 RPC(구조 변경),
// 셀 텍스트는 CAS 자동저장(plan-row). ⚠️ <col/>과 같은 줄에 주석 금지(하이드레이션, onescreen 선례).
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PlanRow } from "./plan-row";

const TERMS: { key: "regular" | "exam"; label: string; tone: string }[] = [
  { key: "regular", label: "평시", tone: "border-line text-text-dim" },
  { key: "exam", label: "내신", tone: "border-amber/60 text-amber bg-amber-soft" },
];

export function PlanTable({
  date,
  slotStart,
  lines,
  skillAreas,
  store,
  handlers,
  canEdit,
}: {
  date: string;
  slotStart: string;
  lines: PlanLineDTO[];
  skillAreas: SkillAreaSetting[];
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
}) {
  const defaultArea = skillAreas[0]?.key ?? "vocab";
  return (
    <div className="space-y-1.5">
      {TERMS.map((term) => {
        const rows = lines.filter((l) => l.termMode === term.key);
        if (rows.length === 0 && term.key === "exam" && !canEdit) return null;
        return (
          <div key={term.key}>
            <div className="flex items-center gap-1.5 py-0.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${term.tone}`}>
                {term.label}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="text-text-faint hover:text-primary text-[11px]"
                  onClick={() => handlers.addLine(date, slotStart, term.key, defaultArea)}
                >
                  + 줄 추가
                </button>
              ) : null}
            </div>
            {rows.length > 0 ? (
              <table className="w-full border-collapse text-[12px]" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 86 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 74 }} />
                  <col />
                  <col />
                  <col style={{ width: 26 }} />
                </colgroup>
                <thead>
                  <tr className="text-text-faint text-left text-[10px]">
                    <th className="py-0.5 font-medium">구분</th>
                    <th className="py-0.5 font-medium">교재 / 내신교과서</th>
                    <th className="py-0.5 font-medium">페이지</th>
                    <th className="py-0.5 font-medium">진도</th>
                    <th className="py-0.5 font-medium">과제</th>
                    <th aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <PlanRow
                      key={l.id}
                      line={l}
                      date={date}
                      slotStart={slotStart}
                      skillAreas={skillAreas}
                      store={store}
                      handlers={handlers}
                      canEdit={canEdit}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-text-faint px-1 py-1 text-[11px]">
                {term.key === "regular" ? "계획이 없습니다" : ""}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
