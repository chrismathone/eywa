import { WindowLink } from "@/components/workspace/window-link";
import { RiskBadge } from "./risk-badge";
import { formatWonShort } from "../format";
import type { RosterStudent } from "../server/queries";

/** 리텐션 보드 행 리스트 — 위험 등급 트리아지. 행 클릭 → 학생 상세. */
export function BoardList({ rows }: { rows: RosterStudent[] }) {
  if (rows.length === 0) {
    return <p className="text-text-dim px-5 py-10 text-center text-[13px]">조건에 맞는 학생이 없습니다.</p>;
  }
  return (
    <ul className="divide-line divide-y">
      {rows.map((r) => (
        <li key={r.id} className="hover:bg-bg-soft/50 transition">
          <WindowLink href={`/students/${r.id}`} title={r.name} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-[13px] font-bold">
                {r.name}{" "}
                <span className="text-text-dim text-[11px] font-normal">
                  {[r.grade, r.school].filter(Boolean).join(" · ")}
                </span>
              </p>
              <p className="text-text-dim mt-0.5 truncate text-[11px]">
                {r.risk.reasons.slice(0, 2).join(" · ")}
                {r.teacherName ? ` · ${r.teacherName} 강사` : ""}
              </p>
            </div>
            {/* 청구 근거가 없으면 금액을 지어내지 않고 '—'로 비운다(추측 금지). */}
            <span className="text-text-dim num hidden shrink-0 text-[11px] sm:block">
              {r.monthlyFee == null ? "—" : formatWonShort(r.monthlyFee)}
            </span>
            <RiskBadge level={r.risk.level} score={r.risk.score} />
          </WindowLink>
        </li>
      ))}
    </ul>
  );
}
