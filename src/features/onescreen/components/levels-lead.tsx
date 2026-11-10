"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";
import { parseLevelRows } from "../pilot-notes";

/**
 * 학부모 문구 칸 위의 **읽기 전용** '수업 평가' 요약 — 원장 2026-10-26 *"우리수업평가 저부분은 어차피 수정할일없는데 수정영역에서
 * 제외하고 보여주는게 맞는거같다"*. 표는 고른 값(태도·숙제·이해도)에서 만들어지므로 고치려면 그 칸을 고치고 자동작성을 다시 누른다.
 * 카드·표 화면이 같은 조각을 쓴다(글을 떼고 붙이는 규칙 = pilot-notes.ts splitLevelsLead/joinLevelsLead).
 * 표로 안 읽히는 옛 글이면 원문을 그대로 보인다(지어내지 않는다).
 */
export function LevelsLead({ lead, compact = false }: { lead: string; compact?: boolean }) {
  const t = useSheetT();
  if (!lead) return null;
  const rows = parseLevelRows(lead.split("\n").slice(1).join("\n"));
  return (
    <div
      className={`border-line bg-bg-soft text-text-dim flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border ${compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs"}`}
      title={t("os.lead.hint")}
    >
      <span className="text-text-faint font-bold">{t("os.lead.title")}</span>
      {rows ? (
        rows.map((r) => (
          <span key={r.label} className="whitespace-nowrap">
            {r.label} <b className="text-foreground">{r.level ?? r.none}</b>
          </span>
        ))
      ) : (
        <span className="whitespace-pre-wrap">{lead}</span>
      )}
    </div>
  );
}
