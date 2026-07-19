"use client";

import { useState } from "react";
import { CalendarClock, GraduationCap, MessagesSquare } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { ColumnCards } from "./column-cards";
import type { ConsultationListRow } from "@/features/enrollment/server/queries";

type ColColor = "amber" | "blue" | "primary" | "neutral";

export type KanbanColumn = {
  key: string;
  label: string;
  color: ColColor;
  cards: ConsultationListRow[];
};

const ICON_BG: Record<ColColor, string> = {
  primary: "bg-primary-soft text-primary",
  blue: "bg-blue-soft text-blue",
  amber: "bg-amber-soft text-amber",
  neutral: "bg-bg-soft text-text-dim",
};

function columnIcon(key: string) {
  switch (key) {
    case "queue":
      return <CalendarClock size={13} strokeWidth={2} />;
    case "consulted":
      return <MessagesSquare size={13} strokeWidth={2} />;
    case "ai_done":
      return <EyIcon name="sparkle" size={13} />;
    case "assigned":
      return <GraduationCap size={13} strokeWidth={2} />;
    default:
      return <EyIcon name="check" size={13} />;
  }
}

/**
 * 등록상담 칸반 보드.
 * - lg(넓은 화면): 4열 그리드로 모든 컬럼 동시 노출.
 * - lg 미만(좁은 화면): 상단 탭바로 컬럼을 전환해 한 번에 1개만 보여 세로 스크롤을 줄인다.
 */
export function EnrollmentKanban({ columns }: { columns: KanbanColumn[] }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      {/* 좁은 화면 전용 탭바 — xl(5열)부터 숨김 */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto xl:hidden">
        {columns.map((col, i) => (
          <button
            key={col.key}
            type="button"
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-bold transition ${
              i === active
                ? "bg-foreground text-background"
                : "bg-bg-soft text-text-dim hover:text-foreground"
            }`}
          >
            {col.label}
            <span className="num text-[11px] opacity-70">{col.cards.length}</span>
          </button>
        ))}
      </div>

      {/* 컬럼 그리드 — xl에서 5열(대기·상담·AI·등록종료·배정완료), 좁으면 활성 탭 1개만 노출 */}
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-5">
        {columns.map((col, i) => (
          <div
            key={col.key}
            className={`bg-card shadow-card min-h-[300px] flex-col rounded-3xl xl:flex ${
              i === active ? "flex" : "hidden"
            }`}
          >
            {/* 컬럼 헤더 위계 — 라벨 bold + 건수 num(문법 ②의 미니판, 구 font-mono 제거) */}
            <header className="border-line flex items-center justify-between border-b px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className={`flex size-[26px] items-center justify-center rounded-lg ${ICON_BG[col.color]}`}>
                  {columnIcon(col.key)}
                </span>
                <h3 className="text-foreground text-[13px] font-bold">{col.label}</h3>
              </div>
              <span className="flex items-baseline gap-0.5">
                <span className="num text-foreground text-[15px] leading-none font-extrabold">
                  {col.cards.length}
                </span>
                <span className="text-text-faint text-[11px]">건</span>
              </span>
            </header>
            {col.cards.length === 0 ? (
              <div className="text-text-faint flex flex-1 items-center justify-center px-4 text-xs">
                없음
              </div>
            ) : (
              <ColumnCards cards={col.cards} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
