"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { saveWithdrawalTrendPrefs } from "@/features/withdrawals/server/trend-prefs-actions";
import type { WithdrawalTrendPrefs } from "@/features/withdrawals/trend-prefs";
import type { WithdrawalMonthPoint } from "./trend-chart-impl";

export type { WithdrawalMonthPoint };

// recharts(~수백KB)는 차트가 보일 때만 클라에서 로드(ssr:false).
const Impl = dynamic(() => import("./trend-chart-impl").then((m) => m.WithdrawalTrendChart), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[200px] animate-pulse rounded-lg" />,
});

const SEG = "text-xs px-2 py-0.5 transition";
const ON = "bg-primary text-primary-foreground font-semibold";
const OFF = "bg-card text-text-dim hover:text-foreground";

/**
 * 월별 추이 + 보기 토글(원장 2026-09-29 *"전체 on/off 토글만들고, 대시보드처럼 막대/꺾은선 전환 토글 추가"*) —
 * 누르는 순간 계정에 저장(`ui_prefs.withdrawals`). '학원 전체' 토글은 필터가 걸려 전체 막대가 있을 때만 보인다.
 */
export function WithdrawalTrendChart(props: {
  data: WithdrawalMonthPoint[];
  filterLabel?: string;
  initialPrefs: WithdrawalTrendPrefs;
  /** 툴팁 단위 — 퇴원만이면 명, 수강종료가 섞이면 건(학생×과목 한 줄). */
  unit?: "명" | "건";
}) {
  const [prefs, setPrefs] = useState(props.initialPrefs);
  const hasTotal = props.data.some((p) => p.total !== undefined);
  const update = (p: Partial<WithdrawalTrendPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...p }));
    void saveWithdrawalTrendPrefs(p).catch(() => undefined); // 표시 취향 — 저장 실패해도 화면은 바뀐 그대로
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
        {hasTotal ? (
          <button
            type="button"
            aria-pressed={prefs.showTotal}
            onClick={() => update({ showTotal: !prefs.showTotal })}
            className={`border-border rounded-md border ${SEG} ${prefs.showTotal ? ON : OFF}`}
          >
            학원 전체
          </button>
        ) : null}
        <div role="group" aria-label="그래프 모양" className="border-border inline-flex overflow-hidden rounded-md border">
          {(["bar", "line"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={prefs.kind === k}
              onClick={() => prefs.kind !== k && update({ kind: k })}
              className={`${SEG} ${k === "line" ? "border-border border-l" : ""} ${prefs.kind === k ? ON : OFF}`}
            >
              {k === "bar" ? "막대" : "꺾은선"}
            </button>
          ))}
        </div>
      </div>
      <Impl data={props.data} filterLabel={props.filterLabel} showTotal={prefs.showTotal} kind={prefs.kind} unit={props.unit} />
    </div>
  );
}
