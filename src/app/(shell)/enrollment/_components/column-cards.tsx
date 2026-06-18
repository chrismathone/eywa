"use client";

import { useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { Pill, type PillColor } from "@/components/atoms/pill";
import type { ConsultationListRow } from "@/features/enrollment/server/queries";

const COLUMN_CAP = 8;

const OUTCOME_PILL: Record<string, { label: string; color: PillColor }> = {
  pending: { label: "대기", color: "amber" },
  scheduled: { label: "예약", color: "amber" },
  consulted: { label: "상담완료", color: "blue" },
  ai_done: { label: "AI 완료", color: "primary" },
  enrolled: { label: "등록", color: "primary" },
  declined: { label: "거절", color: "neutral" },
  no_show: { label: "노쇼", color: "rose" },
};

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * 등록상담 칸반 컬럼 카드 목록 — 100+ 카드가 평면으로 쏟아지는 것을 막아 기본 8개만 렌더하고
 * 나머지는 "+N개 더 보기" 토글로 펼친다(now-cockpit 캡 패턴).
 */
export function ColumnCards({
  cards,
}: {
  cards: ConsultationListRow[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? cards : cards.slice(0, COLUMN_CAP);
  const rest = cards.length - visible.length;

  return (
    <ul className="space-y-2 p-3">
      {visible.map((c) => {
        const pill = OUTCOME_PILL[c.outcome] ?? OUTCOME_PILL.pending!;
        return (
          <li key={c.id}>
            <WindowLink
              href={`/enrollment/${c.id}`}
              title={c.prospectName}
              className="bg-bg-soft/60 hover:bg-bg-soft block rounded-xl p-3 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-foreground text-[13px] font-bold">{c.prospectName}</p>
                    <p className="text-text-dim text-[11px]">
                      {c.prospectGrade ?? "—"}
                      {c.prospectSchool ? <> · {c.prospectSchool}</> : null}
                    </p>
                  </div>
                </div>
                <Pill color={pill.color}>{pill.label}</Pill>
              </div>
              {c.parentRequest ? (
                <p className="text-text-dim mt-2 line-clamp-2 text-[11px] leading-snug">
                  {c.parentRequest}
                </p>
              ) : null}
              <div className="text-text-faint mt-2 flex items-center justify-between text-[10px]">
                <span>{c.consultantName ?? "—"}</span>
                <span className="num">{daysSince(c.consultedAt)}일 전</span>
              </div>
            </WindowLink>
          </li>
        );
      })}
      {rest > 0 ? (
        <li>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft w-full rounded-xl border border-dashed py-2 text-[11px] transition"
          >
            +{rest}개 더 보기
          </button>
        </li>
      ) : null}
    </ul>
  );
}
