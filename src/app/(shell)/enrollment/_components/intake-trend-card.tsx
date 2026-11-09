"use client";

import { useState } from "react";
import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { periodQuery, type StatsPeriod, MAX_DAY_SPAN } from "@/features/stats/period";
import { INTAKE_TREND_KEYS, type IntakeTrend } from "@/features/enrollment/intake-trend";
import { saveIntakeChartKind, saveIntakeTrendMode } from "@/features/enrollment/server/view-pref-actions";
import type { IntakeChartKind } from "@/features/enrollment/view-pref";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const TOTAL_COLOR = "var(--color-primary)";
const UNKNOWN_COLOR = "var(--neutral-fill)";
/** 쌓은 막대의 '과목 모름' — 그 밖의 다과목 조합(회색)과 갈리게 더 옅게. */
const UNKNOWN_STACK = "color-mix(in srgb, var(--neutral-fill) 45%, var(--card))";

/**
 * 통계 보기 맨 위 **신규 문의 추이**(원장 2026-10-20 *"신규 문의 추이는 없네 신규 문의 상세에서 그것도 추가"*) — 운영실 '신규문의' ↗가 연다.
 * 월별(12·24개월) · 일별(한 달) · 구간(최대 두 달). 월별 선 = 전체 + 과목(두 과목 문의는 양쪽에) + 과목 모름 · 일별 막대 = 겹치지 않는 과목
 * 조합(영어 · 수학 · 영어+수학 …)을 **쌓은** 전체(합계 막대를 과목 옆에 또 세우면 한 과목뿐인 날 같은 막대가 둘 선다 — 리뷰 2026-10-21).
 * 날짜는 접수일(`consulted_at` — 새 상담은 입력 시각 · 옮겨 온 옛 상담은 시트의 상담일 · `intake-trend.ts`).
 * 월별 수치 표의 달을 누르면 그 달을 일별로 연다. 오늘 접수 목록(종전 ↗ 목적지)은 카드 머리 링크로 남긴다.
 */
export function IntakeTrendCard({
  trend,
  period,
  today,
  groups,
  keep,
  chartKind,
}: {
  trend: IntakeTrend | null;
  period: StatsPeriod;
  today: string;
  /** 과목 묶음 → 이름·색(학원 설정 — 서버가 푼다). */
  groups: Record<string, { label: string; color: string }>;
  keep: Record<string, string | undefined>;
  /** 일별·구간 그래프 모양(계정에 남긴 값) — 월별은 늘 꺾은선. */
  chartKind: IntakeChartKind;
}) {
  const daily = period.grain === "day";
  // 일별·구간 = 막대(과목 조합을 쌓은 전체) ↔ 꺾은선(전체 + 과목 선) — 원장 2026-10-22. 고르는 순간 계정에 남긴다(#90).
  const [kind, setKind] = useState<IntakeChartKind>(chartKind);
  const barView = daily && kind === "bar";
  const pickKind = (next: IntakeChartKind) => {
    if (next === kind) return;
    setKind(next);
    void saveIntakeChartKind({ kind: next }).catch(() => undefined);
  };
  const keys = trend?.keys ?? [];
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const lines = trend
    ? [
        ...trend.groups.map((g) => ({ key: g.group, label: groups[g.group]?.label ?? g.group, color: groups[g.group]?.color ?? UNKNOWN_COLOR, values: g.values })),
        ...(trend.unknown.some((n) => n > 0) ? [{ key: "_unknown", label: "과목 모름", color: UNKNOWN_COLOR, values: trend.unknown }] : []),
      ]
    : [];
  const comboColor = (gs: string[]) =>
    gs.length === 1 ? (groups[gs[0]!]?.color ?? UNKNOWN_COLOR) : gs.length === 2 && gs.includes("english") && gs.includes("math") ? DASHBOARD_SUBJECT_COLORS.both : UNKNOWN_COLOR;
  const stacks: ChartSeries[] = trend
    ? [
        { key: "_total", name: "전체", color: TOTAL_COLOR, values: trend.total, tooltipOnly: true },
        // 한 과목 조합은 '영어만'(표의 '영어' 열은 두 과목 문의도 더한 값이라 이름을 가른다 — 리뷰 2026-10-21).
        ...trend.combos.map((c) => ({
          key: `c:${c.key}`,
          name: c.groups.length === 1 ? `${groups[c.groups[0]!]?.label ?? c.groups[0]}만` : c.groups.map((g) => groups[g]?.label ?? g).join("+"),
          color: comboColor(c.groups),
          values: c.values,
          stack: "intake",
        })),
        ...(trend.unknown.some((n) => n > 0) ? [{ key: "_unknown", name: "과목 모름", color: UNKNOWN_STACK, values: trend.unknown, stack: "intake" }] : []),
      ]
    : [];
  const series: ChartSeries[] = trend
    ? barView
      ? stacks
      : [{ key: "_total", name: "전체", color: TOTAL_COLOR, values: trend.total, strong: true }, ...lines.map((l) => ({ key: l.key, name: l.label, color: l.color, values: l.values }))]
    : [];
  const sum = trend ? trend.total.reduce((n, x) => n + x, 0) : 0;
  const peak = trend && keys.length ? trend.total.reduce((best, v, i) => (v > trend.total[best]! ? i : best), 0) : -1;
  const unit = daily ? "하루" : "한 달";
  const rangeText = keys.length ? `${tip(keys[0]!)} ~ ${tip(keys.at(-1)!)}` : "";

  return (
    <StatCard
      id="intake"
      title="신규 문의 추이"
      note={`${rangeText}${keys.at(-1)?.startsWith(today.slice(0, 7)) ? " · 이번 달은 오늘까지" : ""} · 접수일 기준(옮겨 온 옛 상담은 시트의 상담일)${barView ? " · 막대 = 과목 조합을 쌓은 전체" : " · 두 과목 문의는 양쪽 선에"}`}
      error={!trend}
      tools={
        <>
          {daily ? (
            <ToolbarSegment label="그래프">
              <ToolbarSegmentItem active={kind === "bar"} onClick={() => pickKind("bar")}>
                막대
              </ToolbarSegmentItem>
              <ToolbarSegmentItem active={kind === "line"} onClick={() => pickKind("line")}>
                꺾은선
              </ToolbarSegmentItem>
            </ToolbarSegment>
          ) : null}
          <StatsPeriodBar key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`} period={period} today={today} keys={INTAKE_TREND_KEYS} keep={keep} anchor="#intake" onMode={(mode) => void saveIntakeTrendMode({ mode })} />
          <EmbedLink href={`/enrollment?view=table&received=${today}`} className="text-primary text-sm font-medium whitespace-nowrap">
            오늘 접수 목록
          </EmbedLink>
        </>
      }
    >
      {trend ? (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Fact label="기간 합계" value={`${fmt(sum)}건`} />
            <Fact label={`${unit} 평균`} value={`${keys.length ? (sum / keys.length).toFixed(1) : "0"}건`} />
            <Fact label="가장 많았던 때" value={peak >= 0 && sum > 0 ? `${fmt(trend.total[peak]!)}건` : "—"} sub={peak >= 0 && sum > 0 ? tip(keys[peak]!) : undefined} />
          </dl>
          <TrendChart labels={keys.map(axis)} tooltipLabels={keys.map(tip)} series={series} kind={barView ? "bar" : "line"} unit="건" legend />
          {period.grain === "day" && period.clipped ? <p className="text-muted-foreground text-xs">구간이 길어 시작일부터 두 달({MAX_DAY_SPAN}일)만 보입니다.</p> : null}
          <details>
            <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
            <div className="mt-2 overflow-x-auto px-1">
              <table className="w-full min-w-[320px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead>
                  <tr className="border-line text-muted-foreground border-b text-xs">
                    <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                    <th className="px-2 py-1.5 text-right font-medium">전체</th>
                    {lines.map((l) => (
                      <th key={l.key} className="px-2 py-1.5 text-right font-medium">{l.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="num">
                  {keys
                    .map((k, i) => ({ k, i }))
                    .reverse()
                    .map(({ k, i }) => (
                      <tr key={k} className="border-line-faint border-b">
                        <td className="px-2 py-1.5 text-center">
                          {daily ? (
                            tip(k)
                          ) : (
                            <EmbedLink
                              href={`/enrollment${periodQuery({ grain: "day", month: k }, keep, INTAKE_TREND_KEYS)}#intake`}
                              className="text-primary hover:underline"
                              title="이 달을 일별로 보기"
                            >
                              {tip(k)}
                            </EmbedLink>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold">{fmt(trend.total[i]!)}</td>
                        {lines.map((l) => (
                          <td key={l.key} className="px-2 py-1.5 text-right">{fmt(l.values[i]!)}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
    </StatCard>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-bg-soft/40 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="num text-foreground text-lg font-bold">
        {value}
        {sub ? <span className="text-muted-foreground ml-1.5 text-xs font-medium">{sub}</span> : null}
      </dd>
    </div>
  );
}
