"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import type { StaffTaskSummary } from "../kinds";
import type { StaffTaskDialogTarget } from "./staff-task-dialog";

/**
 * 벨 맨 위에 늘 있는 '내 할 일' 입구(0377a) — 알림을 다 읽거나 지워도 남는다(할 일은 알림과 따로 남는 기록).
 * 업무 처리 현황 권한이 있으면 옆에 '업무 처리 현황'(모든 직원).
 */
export function BellTaskRow({ summary, onOpen }: { summary: StaffTaskSummary; onOpen: (target: StaffTaskDialogTarget) => void }) {
  const mine = summary.open > 0 ? `내 할 일 ${summary.open.toLocaleString("ko-KR")}` : "내 할 일 없음";
  return (
    <div className="border-line flex items-center gap-2 border-b px-3 py-2">
      <button type="button" onClick={() => onOpen({ scope: "mine" })}
        className="hover:bg-bg-soft flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-left text-xs">
        <EyIcon name="clipboardCheck" size={13} className={summary.late > 0 ? "text-danger shrink-0" : "text-primary shrink-0"} />
        <span className="text-foreground font-bold">{mine}</span>
        {summary.late > 0 ? <span className="text-danger font-bold">· 늦음 {summary.late.toLocaleString("ko-KR")}</span> : null}
      </button>
      {summary.canMonitor ? (
        <button type="button" onClick={() => onOpen({ scope: "all" })} className="text-text-dim hover:text-foreground shrink-0 text-xs">
          업무 처리 현황
        </button>
      ) : null}
    </div>
  );
}
