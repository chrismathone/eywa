"use client";

import { useState } from "react";
import { EmbedLink } from "@/components/embed-link";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs-actions";
import { buildKpiLines } from "@/features/consultations/stats-kpi";
import {
  metricSeries,
  trendWindowText,
  type ConsultationStats,
  type ConsultationStatsPrefs,
  type StatsDimView,
  type StatsMetric,
} from "@/features/consultations/stats-model";
import { StatsTrendChart } from "./stats-trend-chart";
import { StatsBreakdown } from "./stats-breakdown";

/** 지표 카드 — 줄 사이 헤어라인. 통계 격자의 한 칸(같은 줄 카드와 높이를 맞춰 늘어난다 · 스켈레톤과 같은 라운드). */
const KPI_CARD = "divide-line border-line divide-y rounded-2xl border";

/**
 * 통계 화면의 **보기 쪽**(보기 설정 = 계정 귀속 `ui_prefs.consultations` · 누르는 순간 저장, [[#90]]).
 * 지표 줄을 누르면 추이 그래프가 그 지표로 바뀐다 — *"모든 것을 관리 통계 추이 가능하게"*. 월별·주별은 그래프·분해의 작은 막대가 함께 따른다.
 * 데이터는 서버가 월·주 둘 다 한 번에 준다 — 토글은 왕복 없이 즉시(반응속도 1순위).
 * 지표 줄의 숫자는 목록 위 요약 띠와 **같은 함수**(`buildKpiLines`)에서 나온다.
 */
export function StatsPanelClient({
  stats,
  dims,
  initialPrefs,
  syncOn,
  classOn,
  overdueHref,
  doneHref,
}: {
  stats: ConsultationStats;
  dims: StatsDimView[];
  initialPrefs: ConsultationStatsPrefs;
  syncOn: boolean;
  classOn: boolean;
  overdueHref: string;
  doneHref: string;
}) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const update = (p: Partial<ConsultationStatsPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...p }));
    void saveConsultationStatsPrefs(p).catch(() => undefined); // 표시 취향 — 저장이 실패해도 화면은 바뀐 그대로
  };
  const lines = buildKpiLines(stats, { syncOn, classOn, overdueHref, doneHref });

  if (!stats.full) {
    // 0318a 전 — 건수만(헤드 카운트). 추이·분해는 없다는 걸 그 자리에 밝힌다(빈 그래프를 그리면 "0건"으로 읽힌다).
    return (
      // `contents` — 카드 하나하나가 통계 격자(stats-skeleton.tsx STATS_PANEL_GRID)의 칸이 된다. 카드가 지표·상담 공백 둘뿐이라
      // 안내는 맨 위 한 줄(전폭), 지표는 3칸 폭에서 두 칸 — 어느 폭에서도 빈 칸이 안 남는다.
      <div className="contents">
        <p className="border-line text-muted-foreground col-span-full rounded-2xl border p-3 text-sm break-keep">
          추이·분해·반 통계는 데이터베이스 업데이트가 적용되면 나타납니다.
        </p>
        <ul className={`${KPI_CARD} @5xl/panel:col-span-2`}>
          {lines.map((l) => (
            <KpiLine key={l.metric} label={l.label} value={l.value} sub={l.sub} link={l.link} />
          ))}
        </ul>
      </div>
    );
  }

  const buckets = prefs.unit === "week" ? stats.buckets.week : stats.buckets.month;
  // 꺼진 축의 지표가 저장돼 있으면(makeedu를 끈 학원 · 0318a 전 저장값) 건수로 보인다.
  const metric: StatsMetric = (prefs.metric === "sync" && !syncOn) || (prefs.metric === "class" && !classOn) ? "count" : prefs.metric;
  const series = metricSeries(buckets, metric, prefs.unit);

  return (
    // `contents` — 지표 줄·추이·분해가 각각 통계 격자(STATS_PANEL_GRID)의 칸이 된다(좁으면 한 줄로 쌓이고 넓으면 나란히).
    <div className="contents">
      <ul className={KPI_CARD}>
        {lines.map((l) => (
          <KpiLine
            key={l.metric}
            label={l.label}
            value={l.value}
            sub={l.sub}
            link={l.link}
            active={metric === l.metric}
            onSelect={() => update({ metric: l.metric })}
          />
        ))}
      </ul>

      {/* 3칸 폭에선 두 칸을 차지한다(지표 1 + 추이 2). 같은 줄의 지표 카드가 더 길면 그래프가 남는 높이를 채운다(stats-trend-chart.tsx). */}
      <div className="border-line flex flex-col gap-2 rounded-2xl border p-3 @5xl/panel:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-foreground min-w-0 text-sm font-bold break-keep">
            {lines.find((l) => l.metric === metric)?.label ?? "상담"} 추이
            <span className="text-muted-foreground ml-1.5 text-xs font-normal">{trendWindowText(buckets, prefs.unit)}</span>
          </p>
          <ToolbarSegment label="단위">
            <ToolbarSegmentItem active={prefs.unit === "month"} onClick={() => prefs.unit !== "month" && update({ unit: "month" })}>
              월별
            </ToolbarSegmentItem>
            <ToolbarSegmentItem active={prefs.unit === "week"} onClick={() => prefs.unit !== "week" && update({ unit: "week" })}>
              주별
            </ToolbarSegmentItem>
          </ToolbarSegment>
        </div>
        <StatsTrendChart series={series} metric={metric} />
        <p className="text-muted-foreground text-xs break-keep">추이 기간은 위 기간과 따로 {trendWindowText(buckets, prefs.unit)}입니다(다른 필터는 그대로 적용).</p>
      </div>

      <StatsBreakdown dims={dims} dim={prefs.dim} unit={prefs.unit} total={stats.totals.n} onDim={(d) => update({ dim: d })} />
    </div>
  );
}

/** 지표 한 줄 — 누르면 추이 그래프가 이 지표로(onSelect가 있을 때). 옆 링크는 **목록**을 그 값으로 걸러 연다(같은 창 안). */
function KpiLine({
  label,
  value,
  sub,
  link,
  active,
  onSelect,
}: {
  label: string;
  value: string;
  sub?: string;
  link?: { href: string; text: string };
  active?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <span className="text-foreground min-w-0 text-sm font-medium break-keep">{label}</span>
      <span className="num text-foreground text-right text-base font-bold whitespace-nowrap">{value}</span>
      {sub ? <span className="text-muted-foreground col-span-2 text-xs break-keep">{sub}</span> : null}
    </>
  );
  return (
    <li className={`flex items-start gap-2 px-3 py-2 ${active ? "bg-primary-soft" : ""}`}>
      {onSelect ? (
        <button
          type="button"
          aria-pressed={!!active}
          onClick={onSelect}
          title="이 지표의 추이 보기"
          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2">{body}</div>
      )}
      {link ? (
        <EmbedLink
          href={link.href}
          title="목록에서 보기"
          className="text-primary shrink-0 self-center text-xs font-medium whitespace-nowrap hover:underline"
        >
          {link.text}
        </EmbedLink>
      ) : null}
    </li>
  );
}
