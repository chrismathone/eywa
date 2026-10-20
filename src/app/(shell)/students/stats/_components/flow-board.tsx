"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import { flowRowsFor, flowTotals, type ChartKind, type FlowRange, type FlowRow } from "@/features/students/stats/model";
import { StatCard } from "./stat-card";
import { TrendChart } from "./trend-chart";
import { FlowTable } from "./flow-table";

const number = (n: number) => n.toLocaleString("ko-KR");
const axisMonth = (m: string) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;
const longMonth = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${number(n)}`;
/** 등록 = 학원 색 · 퇴원 = 위험색(재원생 추이의 과목 색과 겹치지 않게 학원 팔레트 안에서). */
const ENROLLED = "var(--color-primary)";
const WITHDRAWN = "var(--color-danger)";
const RANGE_LABELS: Record<FlowRange, string> = { all: "전체 기간", m12: "최근 12개월" };

/**
 * 월별 기록 — 달마다 등록 · 퇴원 · 순증(+ 말일 재원생). 운영실 '등록 · 퇴원 추이'(최근 6개월)와 같은 함수(`loadMonthlyChanges`)를
 * 셀 수 있는 달(`from` — 퇴원 기록 시작 · 과목 관리자는 과목을 가를 수 있는 달도)부터 보인다(그 전 달은 순증이 틀린다).
 * 퇴원 = 실제 퇴원만(시스템 정리·수업 기록 없는 장부 정리 제외) · 과목만 끝난 재원생은 인원 감소가 아니라 세지 않는다.
 * 과목 관리자는 그 과목 반을 다닌(다니는) 학생만 · 과목을 알 수 없는 등록·퇴원은 빼고 센다(load.ts) — 반 배정 전 신입은 반에 들어간 뒤
 * 세므로 운영실 과목 관리자 '등록·퇴원 추이'(모름은 모두에게)와 한두 명 다를 수 있다(재리뷰 2026-10-20 · 정확성을 택했다).
 */
export function FlowBoard({
  rows,
  from,
  monthEnd,
  initialRange,
  initialKind,
  scopeLabel,
}: {
  rows: FlowRow[];
  /** 셀 수 있는 첫 달(YYYY-MM) — 화면(page.tsx)이 정한다. */
  from: string | null;
  /** 달 → 말일(이번 달은 오늘) 재원생 — 재원생 추이 첫 선과 같은 값(같은 경계로 자른 것). */
  monthEnd: Record<string, number> | null;
  initialRange: FlowRange;
  initialKind: ChartKind;
  /** 과목 관리자의 담당 과목 — 있으면 그 과목 반을 다닌(다니는) 학생의 등록·퇴원만. */
  scopeLabel: string | null;
}) {
  const [range, setRange] = useState<FlowRange>(initialRange);
  const [kind, setKind] = useState<ChartKind>(initialKind);
  const shown = flowRowsFor(rows, range, from);
  const totals = flowTotals(shown);
  const first = shown[0]?.month;
  return (
    <StatCard
      id="flow"
      title="월별 기록"
      note={`${first ? `${first.slice(0, 4)}년 ${Number(first.slice(5, 7))}월부터` : "기록 없음"} · 당월은 오늘까지 · 퇴원은 실제 퇴원만${scopeLabel ? ` · ${scopeLabel} 반을 다닌 학생만(과목을 알 수 있는 기록만 — 반 배정 전 신입은 반에 들어간 뒤 셉니다)` : ""}`}
      tools={
        <>
          <ToolbarSegment label="기간">
            {(["all", "m12"] as const).map((r) => (
              <ToolbarSegmentItem key={r} active={range === r} onClick={() => { setRange(r); void saveStudentStatsPrefs({ flowRange: r }).catch(() => undefined); }}>
                {RANGE_LABELS[r]}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
          <ToolbarSegment label="그래프">
            {(["bar", "line"] as const).map((k) => (
              <ToolbarSegmentItem key={k} active={kind === k} onClick={() => { setKind(k); void saveStudentStatsPrefs({ flowKind: k }).catch(() => undefined); }}>
                {k === "bar" ? "막대" : "꺾은선"}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        </>
      }
    >
      <dl className="grid grid-cols-3 gap-2">
        <Total label="등록" value={`${number(totals.enrolled)}명`} />
        <Total label="퇴원" value={`${number(totals.withdrawn)}명`} />
        <Total label="순증(등록 − 퇴원)" value={`${signed(totals.net)}명`} tone={totals.net < 0 ? "text-danger" : totals.net > 0 ? "text-green" : undefined} />
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: ENROLLED }} />등록</span>
        <span className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: WITHDRAWN }} />퇴원</span>
      </div>
      <TrendChart
        kind={kind}
        labels={shown.map((r) => axisMonth(r.month))}
        tooltipLabels={shown.map((r) => longMonth(r.month))}
        series={[
          { key: "enrolled", name: "등록", color: ENROLLED, values: shown.map((r) => r.enrolled) },
          { key: "withdrawn", name: "퇴원", color: WITHDRAWN, values: shown.map((r) => r.withdrawn) },
        ]}
      />
      <FlowTable rows={shown} monthEnd={monthEnd} />
    </StatCard>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-bg-soft/40 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={`num text-lg font-bold ${tone ?? "text-foreground"}`}>{value}</dd>
    </div>
  );
}
