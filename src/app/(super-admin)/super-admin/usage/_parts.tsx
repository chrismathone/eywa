import { fmtNum } from "@/components/super-admin/parts";
import { fmtDuration, fmtRatio } from "@/features/usage/labels";
import type { UsageAgg, UsageSort } from "@/features/usage/summary";

/**
 * 이용 분석 화면 공용 부품 — 비중 막대·기준별 값·칸 문구. 서버 컴포넌트(상태 없음).
 * 🔴 색은 자리 표시(primary) 하나 — 막대 길이가 곧 비중이라 의미색(tone)을 입히지 않는다.
 */

export const SORT_LABEL: Record<UsageSort, string> = { active: "활동 시간", visits: "방문", open: "화면 시간" };

/** 기준(정렬) 값을 사람이 읽는 말로. */
export function metricText(sort: UsageSort, a: UsageAgg): string {
  if (sort === "visits") return `${fmtNum(a.visits)}회`;
  return fmtDuration(sort === "open" ? a.openSec : a.activeSec);
}

/** 1회 방문당 평균 활동 — "오래 머무는 화면" 지표. */
export function perVisit(a: UsageAgg): string {
  return a.visits > 0 ? fmtDuration(a.activeSec / a.visits) : "—";
}

export function activityRatio(a: UsageAgg): string {
  return fmtRatio(a.activeSec, a.openSec);
}

/** 비중 막대 + 백분율. `share`는 0~1. */
export function ShareBar({ share, label }: { share: number; label: string }) {
  const pct = Math.max(0, Math.min(100, share * 100));
  return (
    <div className="flex min-w-0 items-center gap-2" title={label}>
      <div className="bg-bg-soft h-1.5 min-w-12 flex-1 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-foreground w-10 shrink-0 text-right text-xs">{Math.round(pct)}%</span>
    </div>
  );
}

/** 데이터가 없을 때 표 자리에 서는 한 줄. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-foreground px-4 py-10 text-center">
        {children}
      </td>
    </tr>
  );
}
