"use client";

import { useState } from "react";
import { EmbedLink } from "@/components/embed-link";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs-actions";
import {
  metricSeries,
  pct,
  trendWindowText,
  type ConsultationStats,
  type ConsultationStatsPrefs,
  type StatsDimView,
  type StatsMetric,
} from "@/features/consultations/stats-model";
import { StatsTrendChart } from "./stats-trend-chart";
import { StatsBreakdown } from "./stats-breakdown";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

/**
 * 통계 패널의 **보기 쪽**(보기 설정 = 계정 귀속 `ui_prefs.consultations` · 누르는 순간 저장, [[#90]]).
 * 지표 줄을 누르면 추이 그래프가 그 지표로 바뀐다 — *"모든 것을 관리 통계 추이 가능하게"*. 월별·주별은 그래프·분해의 작은 막대가 함께 따른다.
 * 데이터는 서버가 월·주 둘 다 한 번에 준다 — 토글은 왕복 없이 즉시(반응속도 1순위).
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
  const t = stats.totals;
  const followTotal = t.done + t.pending;

  if (!stats.full) {
    // 0318a 전 — 건수만(헤드 카운트). 추이·분해는 없다는 걸 밝힌다(빈 그래프를 그리면 "0건"으로 읽힌다).
    return (
      // `contents` — 카드 하나하나가 패널 격자(stats-skeleton.tsx STATS_PANEL_GRID)의 칸이 된다.
      <div className="contents">
        <ul className="divide-line border-line divide-y rounded-2xl border">
          <KpiLine label="상담" value={`${fmt(t.n)}건`} />
          <KpiLine
            label="후속 완료율"
            value={pctText(pct(t.done, followTotal))}
            sub={`완료 ${fmt(t.done)} / 기한 있는 후속 ${fmt(followTotal)}`}
            link={t.overdue > 0 ? { href: overdueHref, text: `지연 ${fmt(t.overdue)}건` } : undefined}
          />
          <KpiLine label="녹음 · AI 분석" value={`${pctText(pct(t.audio, t.n))} · ${pctText(pct(t.ai, t.n))}`} />
          {syncOn ? <KpiLine label="동기화 비율" value={pctText(pct(t.synced, t.n))} sub={`동기화 ${fmt(t.synced)} · 앱 작성 ${fmt(t.n - t.synced)}`} /> : null}
        </ul>
        <p className="text-muted-foreground text-xs break-keep">추이·분해·반 통계는 데이터베이스 업데이트가 적용되면 나타납니다.</p>
      </div>
    );
  }

  const full = stats;
  const buckets = prefs.unit === "week" ? full.buckets.week : full.buckets.month;
  // 꺼진 축의 지표가 저장돼 있으면(makeedu를 끈 학원 · 0318a 전 저장값) 건수로 보인다.
  const metric: StatsMetric = (prefs.metric === "sync" && !syncOn) || (prefs.metric === "class" && !classOn) ? "count" : prefs.metric;
  const series = metricSeries(buckets, metric, prefs.unit);
  const unmapped = full.totals.n - full.totals.mapped;
  const unjudged = full.totals.n - full.totals.judged;

  const lines: { metric: StatsMetric; label: string; value: string; sub?: string; link?: { href: string; text: string } }[] = [
    { metric: "count", label: "상담", value: `${fmt(t.n)}건`, sub: `원생 ${fmt(full.totals.students)}명` },
    {
      metric: "perStudent",
      label: "1인당 상담",
      value: full.totals.students > 0 ? `${(Math.round((t.n / full.totals.students) * 10) / 10).toLocaleString("ko-KR")}건` : "—",
      sub: "상담 수 ÷ 상담받은 원생 수",
    },
    {
      metric: "follow",
      label: "후속 완료율",
      value: pctText(pct(t.done, followTotal)),
      sub: `완료 ${fmt(t.done)} / 기한 있는 후속 ${fmt(followTotal)}`,
      link: t.overdue > 0 ? { href: overdueHref, text: `지연 ${fmt(t.overdue)}건` } : t.done > 0 ? { href: doneHref, text: "완료 보기" } : undefined,
    },
    {
      metric: "media",
      label: "녹음 · AI 분석",
      value: `${pctText(pct(t.audio, t.n))} · ${pctText(pct(t.ai, t.n))}`,
      sub: `녹음 ${fmt(t.audio)}건 · AI ${fmt(t.ai)}건`,
    },
    ...(syncOn
      ? [{ metric: "sync" as const, label: "동기화 비율", value: pctText(pct(t.synced, t.n)), sub: `동기화 ${fmt(t.synced)} · 앱 작성 ${fmt(t.n - t.synced)}` }]
      : []),
    ...(classOn
      ? [
          {
            metric: "class" as const,
            label: "반 미매핑",
            value: pctText(pct(unmapped, t.n)),
            // 아직 판정 안 한 기록(백필 전 옛 기록 · 녹음 상담처럼 저장 때 판정하지 않는 경로)은 저장값이 비어 미매핑으로 센다 — 그 수를 함께 밝힌다.
            sub: `미매핑 ${fmt(unmapped)}건${unjudged > 0 ? ` · 그중 아직 판정 안 한 기록 ${fmt(unjudged)}건` : ""}`,
          },
        ]
      : []),
  ];

  return (
    // `contents` — 지표 줄·추이·분해가 각각 패널 격자(STATS_PANEL_GRID)의 칸이 된다(옆 패널이면 한 줄로 쌓이고, 아래로 접혀 넓으면 나란히).
    <div className="contents">
      <ul className="divide-line border-line divide-y rounded-2xl border">
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

      <div className="border-line space-y-2 rounded-2xl border p-3">
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
        <p className="text-muted-foreground text-xs break-keep">추이는 기간 필터와 무관하게 {trendWindowText(buckets, prefs.unit)} — 나머지 필터는 그대로 걸린다.</p>
      </div>

      <StatsBreakdown dims={dims} dim={prefs.dim} unit={prefs.unit} total={t.n} onDim={(d) => update({ dim: d })} />
    </div>
  );
}

/** 지표 한 줄 — 누르면 추이 그래프가 이 지표로(onSelect가 있을 때). 옆 링크는 목록을 그 값으로 거른다. */
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
        <EmbedLink href={link.href} className="text-primary shrink-0 self-center text-xs font-medium whitespace-nowrap hover:underline">
          {link.text}
        </EmbedLink>
      ) : null}
    </li>
  );
}
