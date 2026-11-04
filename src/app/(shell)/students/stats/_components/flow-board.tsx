"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import { basisMarkers } from "@/features/students/stats/joined";
import { availableFlowRanges, flowRowsFor, flowTotals, type ChartKind, type FlowRange, type FlowRow } from "@/features/students/stats/model";
import type { ChartSeries } from "./trend-chart";
import { startedNote } from "@/features/dashboard/overview/model";
import { StatCard } from "./stat-card";
import { TrendChart } from "./trend-chart";
import { FlowTable } from "./flow-table";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";

const number = (n: number) => n.toLocaleString("ko-KR");
const axisMonth = (m: string) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;
const longMonth = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${number(n)}`;
/** 등록 = 학원 색 · 퇴원 = 위험색(재원생 추이의 과목 색과 겹치지 않게 학원 팔레트 안에서). */
const ENROLLED = "var(--color-primary)";
const WITHDRAWN = "var(--color-danger)";
// 지난 기록 달의 기준 이름 — 등록은 메이크에듀 등록(같은 판정)이지만 퇴원 칸은 청구가 끊긴 학생이라 '추정'을 붙인다.
const FLOW_HISTORY_NAME = "지난 기록 · 퇴원은 청구 기준 추정";
const RANGE_LABELS: Record<FlowRange, string> = { all: "전체 기간", m12: "최근 12개월" };

/**
 * 월별 기록 — 달마다 등록 · 퇴원 · 순증(+ 말일 재원생). 운영실 '등록 · 퇴원 추이'(최근 6개월)와 같은 함수(`loadMonthlyChanges`)를
 * 셀 수 있는 달(`from` — 퇴원 기록 시작 · 과목 관리자는 과목을 가를 수 있는 달도)부터 보인다(그 전 달은 순증이 틀린다).
 * 퇴원 = 실제 퇴원만(시스템 정리·수업 기록 없는 장부 정리 제외) · 과목만 끝난 재원생은 인원 감소가 아니라 세지 않는다.
 * 과목 관리자는 그 과목 반을 다닌(다니는) 학생만 · 과목을 알 수 없는 등록·퇴원은 빼고 센다(load.ts) — 반 배정 전 신입은 반에 들어간 뒤
 * 세므로 운영실 과목 관리자 '등록·퇴원 추이'(모름은 모두에게)와 한두 명 다를 수 있다(재리뷰 2026-10-20 · 정확성을 택했다).
 * 셀 수 있는 달 **앞은 지난 기록**(`source: "history"` — 원장 2026-10-21 전체 추이 · `joined.ts`)으로 이어져 온다: 등록은 같은 판정(수업을 시작한
 * 등록), 퇴원 칸은 **청구가 끊긴 학생** — **같은 막대·선**으로 잇고 기준이 바뀌는 달에 세로 점선만 긋는다(원장 2026-10-29 '같은 선 + 경계
 * 세로선' · 종전엔 옅은 색으로 갈랐다). 값 상자에 그 달의 기준 이름.
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
  const [chosenRange, setRange] = useState<FlowRange>(initialRange);
  // 칸이 12개 이하면 '최근 12개월'은 '전체 기간'과 같다 — 기간 버튼째 세우지 않는다(리뷰 2026-10-21).
  const ranges = availableFlowRanges(rows, from);
  const range: FlowRange = ranges.includes(chosenRange) ? chosenRange : "all";
  const [kind, setKind] = useState<ChartKind>(initialKind);
  const shown = flowRowsFor(rows, range, from);
  const totals = flowTotals(shown);
  const first = shown[0]?.month;
  // 등록 안내는 에이와 줄로만 판정한다 — 지난 기록 줄은 늘 '수업을 시작한 등록'이라 맨 앞에 서면 에이와 줄의 사정을 가린다(리뷰 2026-10-21).
  const started = startedNote(shown.filter((r) => r.source !== "history"));
  const hasHistory = shown.some((r) => r.source === "history");
  const historyFrom = shown.find((r) => r.source === "history")?.month;
  const aywaFrom = shown.find((r) => r.source !== "history")?.month;
  // 지난 기록의 퇴원 칸(청구가 끊긴 학생)은 수납 권한이 없으면 실리지 않는다 — 그때는 그 범례·선·안내를 세우지 않는다.
  const historyWithdrawnKnown = shown.some((r) => r.source === "history" && r.withdrawn !== null);
  const historyBasis = historyWithdrawnKnown ? FLOW_HISTORY_NAME : "지난 등록 기록";
  const series: ChartSeries[] = [
    { key: "enrolled", name: "등록", color: ENROLLED, values: shown.map((r) => r.enrolled) },
    { key: "withdrawn", name: "퇴원", color: WITHDRAWN, values: shown.map((r) => r.withdrawn) },
  ];
  return (
    <StatCard
      id="flow"
      title="등록 · 퇴원 추이"
      note={`${first ? `${first.slice(0, 4)}년 ${Number(first.slice(5, 7))}월부터` : "기록 없음"} · 당월은 오늘까지${started ? ` · ${started}` : ""} · 퇴원은 실제 퇴원만${hasHistory && historyWithdrawnKnown ? "(지난 기록 구간은 청구가 끊긴 학생)" : ""} · 퇴원 달은 ${EXIT_BASIS_TAG}${hasHistory && historyWithdrawnKnown ? "(지난 기록 구간은 청구가 끊긴 달)" : ""}${scopeLabel ? ` · ${scopeLabel} 반을 다닌 학생만(과목을 알 수 있는 기록만 — 반 배정 전 신입은 반에 들어간 뒤 셉니다)` : ""}`}
      tools={
        <>
          {ranges.length > 1 ? (
            <ToolbarSegment label="기간">
              {ranges.map((r) => (
                <ToolbarSegmentItem key={r} active={range === r} onClick={() => { setRange(r); void saveStudentStatsPrefs({ flowRange: r }).catch(() => undefined); }}>
                  {RANGE_LABELS[r]}
                </ToolbarSegmentItem>
              ))}
            </ToolbarSegment>
          ) : null}
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
        <Total label={hasHistory && historyWithdrawnKnown ? "퇴원(지난 기록은 청구 끊김)" : "퇴원"} value={`${number(totals.withdrawn)}명`} />
        <Total
          label={totals.unknownMonths ? `순증(퇴원을 아는 ${number(shown.length - totals.unknownMonths)}개월만)` : "순증(등록 − 퇴원)"}
          value={`${signed(totals.net)}명`}
          tone={totals.net < 0 ? "text-danger" : totals.net > 0 ? "text-green" : undefined}
        />
      </dl>
      <TrendChart
        kind={kind}
        labels={shown.map((r) => axisMonth(r.month))}
        tooltipLabels={shown.map((r) => (r.source === "history" ? `${longMonth(r.month)} · ${historyBasis}` : longMonth(r.month)))}
        series={series}
        markers={hasHistory ? basisMarkers(shown.map((r) => (r.source === "history" ? historyBasis : "에이와 기록"))) : []}
        legend={false}
      />
      {/* 범례 = 그래프 아래(원장 2026-10-22 *"다른 화면의 꺾은선도 전부 일치화"*). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: ENROLLED }} />등록</span>
        <span className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: WITHDRAWN }} />{hasHistory && historyWithdrawnKnown ? "퇴원(지난 기록 구간은 청구가 끊긴 학생)" : "퇴원"}</span>
      </div>
      {hasHistory && historyFrom ? (
        <p className="text-muted-foreground text-xs break-keep">
          {aywaFrom ? `${longMonth(aywaFrom)}부터 에이와 기록으로 세고, ${longMonth(historyFrom)}부터 그 전은 지난 기록으로 이었습니다` : `${longMonth(historyFrom)}부터 지난 기록입니다`} — 지난 기록의 등록은 같은 판정(수업을
          시작한 등록)입니다.{" "}
          {historyWithdrawnKnown ? (
            <>
              퇴원 칸은 퇴원일이 아니라 <b className="text-foreground font-medium">청구가 끊긴 학생</b>(그달을 끝으로 다음 두 달 수업료 청구가 없는 학생 · 휴원 뒤 돌아온 학생도 든다)입니다. 2025년 이후 끊긴 학생의
              9할에 메이크에듀 퇴원 기록이 있어 퇴원과 거의 같습니다. 출처가 바뀌는 달의 증감은 비우고, 순증은 퇴원을 아는 달만 더합니다.
            </>
          ) : (
            "지난 기록의 퇴원 칸(청구가 끊긴 학생)은 수납 권한이 있을 때만 보입니다 — 그 달들은 퇴원·순증에서 빠집니다."
          )}
        </p>
      ) : null}
      <FlowTable rows={shown} monthEnd={monthEnd} started={started} />
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
