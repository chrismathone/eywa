"use client";

// 수업계획 표 — 시기(평시/내신) 그룹 헤더 + 가변 행. 행 추가/삭제/시기 이동은 RPC(구조 변경),
// 셀 텍스트는 CAS 자동저장(plan-row). ⚠️ <col/>과 같은 줄에 주석 금지(하이드레이션, onescreen 선례).
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PlanRow } from "./plan-row";

// 시기 칩 — 원본 시트에서 '평시/내신'은 계획 묶음을 가르는 큰 구분이라 알약도 또렷하게(솔리드/앰버).
const TERMS: { key: "regular" | "exam"; label: string; tone: string }[] = [
  { key: "regular", label: "평시", tone: "border-foreground bg-foreground text-background" },
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
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${term.tone}`}>
                {term.label}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="border-line-strong text-text-dim hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-[12px] font-medium"
                  onClick={() => handlers.addLine(date, slotStart, term.key, defaultArea)}
                >
                  + 줄 추가
                </button>
              ) : null}
            </div>
            {rows.length > 0 ? (
              <table className="w-full border-collapse text-[13px]" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 86 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 74 }} />
                  <col />
                  <col />
                  <col style={{ width: 26 }} />
                </colgroup>
                <thead>
                  {/* 헤더 밴드 — 원본 시트의 노란 머리글(시기·구분·교재·페이지·진도·과제)과 같은 역할. */}
                  <tr className="bg-bg-soft text-text-dim text-left text-[11px]">
                    <th className="rounded-l-md py-1 pl-1 font-semibold">구분</th>
                    <th className="py-1 font-semibold">교재 / 내신교과서</th>
                    <th className="py-1 font-semibold">페이지</th>
                    <th className="py-1 font-semibold">진도</th>
                    <th className="py-1 font-semibold">과제</th>
                    <th className="rounded-r-md" aria-hidden />
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
              <p className="text-text-dim px-1 py-1 text-[12px]">
                {term.key === "regular" ? "계획이 없습니다" : ""}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
