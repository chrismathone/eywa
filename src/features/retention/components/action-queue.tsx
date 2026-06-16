import { WindowLink } from "@/components/workspace/window-link";
import { RiskBadge } from "./risk-badge";
import type { RosterStudent } from "../server/queries";

/** 위험도 우선순위 액션 큐 — "오늘 누구부터". 행 클릭 → 학생 상세. */
export function ActionQueue({ rows }: { rows: RosterStudent[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-text-dim px-5 py-8 text-center text-[13px]">
        오늘 급히 처리할 위험 신호가 없습니다. 안정 학생 정기 리포트를 챙기세요.
      </p>
    );
  }
  return (
    <ul className="divide-line divide-y">
      {rows.map((r, i) => (
        <li key={r.id} className="hover:bg-bg-soft/50 transition">
          <WindowLink href={`/students/${r.id}`} title={r.name} className="flex items-center gap-3 px-5 py-3">
            <span className="text-text-faint num w-4 shrink-0 text-center text-[12px] font-bold">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-[13px] font-bold">
                {r.name}{" "}
                <span className="text-text-dim text-[11px] font-normal">
                  {[r.grade, r.school].filter(Boolean).join(" · ")}
                </span>
              </p>
              <p className="text-text-dim mt-0.5 truncate text-[11px]">
                {r.primaryAction} · {r.owner}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <RiskBadge level={r.risk.level} score={r.risk.score} />
              <span className="text-text-faint max-w-[150px] truncate text-[10px]">
                {r.risk.reasons.slice(0, 2).join(" · ")}
              </span>
            </div>
          </WindowLink>
        </li>
      ))}
    </ul>
  );
}
