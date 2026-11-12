"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { SMALL_BASE, rateText, yyMm, type ChurnMonth, type ChurnTeacherRow } from "@/features/withdrawals/teacher-churn";
import { monthBrief } from "@/features/withdrawals/teacher-churn-view";
import { CONTEXT_COLOR } from "./teacher-churn-colors";
import { churnTip } from "./teacher-churn-tip";

/**
 * 한 차트 보기의 오른쪽 목록 — 고른 달(없으면 마지막 달)의 모든 강사 값. 차례는 카드 정렬 그대로(달을 옮겨도 줄이 뛰지 않게).
 * 이름 = 누르면 그 강사를 차트에 고정(표의 이름 누르기와 같은 고르기) · 올리면 차트에서 그 선을 진하게 ·
 * 값에 올리면 표 칸과 같은 카드(`churnTip`) · 값이 없는 달은 표 칸과 같은 상태 이름(`monthBrief`).
 */
export function TeacherChurnChartList({ rows, month, names, colorOf, picked, hoverId, onHover, onPick, portfolioLink }: {
  rows: readonly ChurnTeacherRow[];
  month: ChurnMonth;
  names: ReadonlyMap<string, string>;
  /** 강조 선 색(강조 밖이면 null). */
  colorOf: (id: string) => string | null;
  picked: readonly string[];
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
  portfolioLink: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="num mb-1 flex min-h-6 items-center text-xs font-semibold">{yyMm(month.month)} 퇴원율 · 그만둔 학생/지난달 담당</p>
      {/* 차트 아래로 내려오는 폭(넓은 한 줄)에서는 두 단 — 세로를 덜 쓴다. 옆에 설 때(lg)는 한 단. */}
      <ul className="border-line grid max-h-[18rem] gap-x-3 overflow-y-auto rounded-lg border p-1 sm:grid-cols-2 lg:grid-cols-1" onMouseLeave={() => onHover(null)}>
        {rows.map((r) => {
          const c = r.cells[month.month];
          const val = c && c.closed && c.state === "ok" && c.rate !== null ? c : null;
          const color = colorOf(r.id);
          const name = names.get(r.id) ?? r.name;
          return (
            <li key={r.id} onMouseEnter={() => onHover(r.id)}
              className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${r.id === hoverId ? "bg-primary-softer" : ""}`}>
              <button type="button" aria-pressed={picked.includes(r.id)} onClick={() => onPick(r.id)}
                onFocus={() => onHover(r.id)} onBlur={() => onHover(null)}
                aria-label={`${name} — 누르면 차트에서 이 강사를 강조합니다`}
                className="focus-visible:outline-primary flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left focus-visible:outline-2">
                <i aria-hidden className={`shrink-0 rounded-full ${color ? "h-1 w-3.5" : "h-0.5 w-3.5"}`} style={{ background: color ?? CONTEXT_COLOR }} />
                <span className={`truncate text-sm ${color ? "font-bold" : "font-medium"}`}>{name}</span>
              </button>
              <span className="num shrink-0 text-right text-xs" {...churnTip(r, month, c)}>
                {val ? (
                  <><b className="text-sm">{rateText(val.rate!)}</b>{val.base < SMALL_BASE ? "＊" : ""} {val.counted}/{val.base}</>
                ) : c && !c.closed ? "마감 전" : monthBrief(r, month.month, c)}
              </span>
              {portfolioLink ? (
                <WindowLink href={`/class-review?tab=portfolio&teacher=${encodeURIComponent(r.id)}`} title={`${r.name} 직원 포트폴리오`}
                  className="hover:text-primary shrink-0 text-xs" ariaLabel={`${r.name} 직원 포트폴리오 열기`}>↗</WindowLink>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
