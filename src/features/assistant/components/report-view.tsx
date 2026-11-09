"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { ADVICE_WHEN_LABEL, type ReportBlock, type SettledReport } from "@/features/assistant/report";
import { ReportChart } from "./report-chart";
import { ReportTable, type ReportTableColumn } from "./report-table";
import {
  chartColumnFormat,
  deltaTone,
  formatDelta,
  formatKpiValue,
  groupBlocks,
  reportSources,
  type DeltaTone,
} from "./report-format";

type Dataset = SettledReport["datasets"][string];
type ChartBlock = Extract<ReportBlock, { type: "chart" }>;
type TableBlock = Extract<ReportBlock, { type: "table" }>;
type KpiBlock = Extract<ReportBlock, { type: "kpi" }>;
type CalloutBlock = Extract<ReportBlock, { type: "callout" }>;
type ListBlock = Extract<ReportBlock, { type: "list" }>;
type AdviceBlock = Extract<ReportBlock, { type: "advice" }>;

/**
 * 학원 비서 보고서 — 제목 · 요약 · KPI · 차트 · 표 · 주의/제안 · 목록 · 비서 의견 · 근거(접힘).
 *
 * 🔴 **모든 글은 글자로만 그린다** — 마크다운·링크·이미지·`dangerouslySetInnerHTML` 없음. 보고서 글과 표 칸에는 DB에 들어 있던
 *    학부모 글처럼 남이 쓴 글이 섞인다(지시처럼 쓰인 글이 링크·이미지가 되어 바깥 주소를 부르지 않게 — report.ts 머리말).
 *    줄바꿈만 살린다(`whitespace-pre-line`).
 * 넓이는 이 상자(@container)가 정한다 — 오버레이(약 860px)와 전체 화면(그 이상)에서 같은 보고서가 다르게 접힌다.
 */
export function ReportView({ report }: { report: SettledReport }) {
  const groups = groupBlocks(report.blocks);
  return (
    <article className="@container space-y-5" aria-label={report.title}>
      <h3 className="text-foreground text-xl leading-snug font-bold break-words">{report.title}</h3>
      {groups.map((g) =>
        g.kind === "charts" ? (
          <div key={g.index} className={`grid grid-cols-1 gap-4 ${g.blocks.length > 1 ? "@4xl:grid-cols-2" : ""}`}>
            {g.blocks.map((b, i) => (
              <ChartCard key={i} block={b} dataset={report.datasets[b.query]} omitted={report.datasetsOmitted} />
            ))}
          </div>
        ) : (
          <Block key={g.index} block={g.block} datasets={report.datasets} omitted={report.datasetsOmitted} />
        ),
      )}
      {report.coverage?.surveys?.length ? <Coverage coverage={report.coverage} /> : null}
      <Sources report={report} />
    </article>
  );
}

function Block({ block, datasets, omitted }: { block: ReportBlock; datasets: SettledReport["datasets"]; omitted?: boolean }) {
  switch (block.type) {
    case "summary":
      return <p className="text-foreground text-base leading-relaxed font-medium break-words whitespace-pre-line">{block.text}</p>;
    case "kpi":
      return <KpiGrid block={block} />;
    case "table":
      return <TableCard block={block} dataset={datasets[block.query]} omitted={omitted} />;
    case "callout":
      return <Callout block={block} />;
    case "list":
      return <ListView block={block} />;
    case "chart":
      return <ChartCard block={block} dataset={datasets[block.query]} omitted={omitted} />;
    case "advice":
      return <AdviceCard block={block} />;
    default:
      // 모르는 블록(새 종류가 화면보다 먼저 나간 경우)은 건너뛴다 — 보고서 전체를 깨뜨리지 않는다.
      return null;
  }
}

// ───────────────────────────── KPI ─────────────────────────────

const DELTA_TONE: Record<DeltaTone, string> = { good: "text-green", bad: "text-danger", neutral: "text-foreground" };

/**
 * KPI 칸 수 — 오버레이(약 860px)에서도 넷이 한 줄에 서게 촘촘히. 좁으면 두 칸(한 칸으로 늘이지 않는다).
 * 🔴 원장 2026-11-06 *"카드 크기 너무 거대해지지 않게"* — 앱 공용 BigStat(운영실 큰 숫자 카드)은 오버레이 반쪽을 한 장이 차지해
 *    보고서에서 숫자 넷이 화면 하나를 먹었다 → 비서 보고서만 작은 칸을 쓴다. 공용 BigStat은 그대로 둔다.
 * (클래스는 정적 문자열이어야 Tailwind가 만든다.)
 */
const KPI_GRID: Record<number, string> = {
  1: "grid-cols-1 max-w-[14rem]",
  2: "grid-cols-2 max-w-md",
  3: "grid-cols-2 @lg:grid-cols-3",
  4: "grid-cols-2 @2xl:grid-cols-4",
  5: "grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-5",
  6: "grid-cols-2 @lg:grid-cols-3",
};

function KpiGrid({ block }: { block: KpiBlock }) {
  return (
    <div className={`grid gap-2 ${KPI_GRID[block.items.length] ?? KPI_GRID[6]}`}>
      {block.items.map((item, i) => {
        const hasSub = (typeof item.delta === "number" && Number.isFinite(item.delta)) || !!item.deltaLabel;
        return (
          <div key={i} data-stat="" className="bg-card shadow-card min-w-0 rounded-xl px-3 py-2.5">
            <p className="text-text-dim text-xs leading-snug font-medium break-keep">{item.label}</p>
            {/* 🔴 숫자는 자르지 않는다 — 금액이 말없이 '1,234,567,…'로 잘리면 원장이 잘못 읽는다(적대 리뷰 2026-11-06).
                좁으면 쉼표 뒤에서만 줄을 바꾼다(<wbr> — 숫자 한가운데서 끊지 않게) · 큰 글자는 넓은 화면(@4xl)에서만. */}
            <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1">
              <span className="num text-foreground min-w-0 text-xl leading-tight font-bold tracking-tight [overflow-wrap:anywhere] @4xl:text-2xl">
                {formatKpiValue(item.value, item.unit)
                  .split(",")
                  .map((part, j) => (
                    <Fragment key={j}>
                      {j > 0 ? (
                        <>
                          ,<wbr />
                        </>
                      ) : null}
                      {part}
                    </Fragment>
                  ))}
              </span>
              {item.unit ? <span className="text-text-dim shrink-0 text-xs font-medium">{item.unit}</span> : null}
            </p>
            {hasSub ? (
              <p className="text-text-faint mt-1 text-xs">
                <KpiDelta delta={item.delta} label={item.deltaLabel} unit={item.unit} goodWhen={item.goodWhen} />
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** 델타 줄 — 화살표 아이콘 + 크기 + 비교 기준(`지난달 대비`). 색은 좋아진 쪽 초록 · 나빠진 쪽 빨강 · 방향 모름은 글자색. */
function KpiDelta({ delta, label, unit, goodWhen }: { delta?: number; label?: string; unit?: string; goodWhen?: "up" | "down" | "none" }) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return label ? <span>{label}</span> : null;
  const tone = deltaTone(delta, goodWhen);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {delta === 0 ? (
        <span className="font-medium">변화 없음</span>
      ) : (
        <span className={`inline-flex items-center gap-0.5 font-bold whitespace-nowrap ${DELTA_TONE[tone]}`}>
          <EyIcon name={delta > 0 ? "arrowUp" : "arrowDown"} size={14} strokeWidth={2.4} />
          <span className="num">{formatDelta(delta, unit)}</span>
          <span className="sr-only">{delta > 0 ? "증가" : "감소"}</span>
        </span>
      )}
      {label ? <span>{label}</span> : null}
    </span>
  );
}

// ───────────────────────────── 카드 ─────────────────────────────

/** 차트·표 카드 껍데기 — 헤어라인 링(shadow-card) 하나 · 머리(제목 + 오른쪽 동작) · 본문. */
function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="bg-card shadow-card overflow-hidden rounded-2xl">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-3">
        <h4 id={id} className="text-foreground min-w-0 text-base font-bold break-words">
          {title}
        </h4>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** `omitted` — 표·차트 자료를 뺐다(대화가 길어 다시 읽을 때 오래된 답 · 자료가 커서 저장에 실패해 글만 저장 — store.ts threadDetail · ask.ts). */
function MissingData({ omitted }: { omitted?: boolean }) {
  return (
    <p className="bg-bg-soft/50 mx-4 mb-4 rounded-lg px-3 py-6 text-center text-sm">
      {omitted ? "이 표·차트 자료는 생략했습니다(대화가 길거나 자료가 큽니다). 다시 물어보면 새로 그립니다." : "이 자료를 찾지 못했습니다."}
    </p>
  );
}

const KIND_LABEL: Record<ChartBlock["kind"], string> = { bar: "막대", stacked_bar: "쌓은 막대", line: "꺾은선", area: "영역", pie: "원" };

function ChartCard({ block, dataset, omitted }: { block: ChartBlock; dataset: Dataset | undefined; omitted?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  const unitNote = block.unit ? <span className="text-xs whitespace-nowrap">단위: {block.unit}</span> : null;
  if (!dataset) {
    return (
      <Card title={block.title}>
        <MissingData omitted={omitted} />
      </Card>
    );
  }
  // 표로 보기 — 가로축 칸 + 시리즈 칸(단위가 원·%가 아니면 열 이름에 단위를 붙인다).
  const columns: ReportTableColumn[] = [
    { column: block.x, label: "항목", format: chartColumnFormat(dataset.rows.map((r) => r[block.x]), undefined, true) },
    ...(block.kind === "pie" ? block.series.slice(0, 1) : block.series).map((s) => ({
      column: s.column,
      label: block.unit && block.unit !== "원" && block.unit !== "%" ? `${s.label}(${block.unit})` : s.label,
      format: chartColumnFormat([], block.unit),
    })),
  ];
  return (
    <Card
      title={block.title}
      aside={
        <>
          {unitNote}
          <Button type="button" variant="ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            <EyIcon name={asTable ? "chart" : "spreadsheet"} />
            {asTable ? "차트로 보기" : "표로 보기"}
          </Button>
        </>
      }
    >
      {asTable ? (
        <div className="border-line border-t">
          <ReportTable columns={columns} dataset={dataset} downloadTitle={block.title} />
        </div>
      ) : (
        <div role="img" aria-label={`${block.title} — ${KIND_LABEL[block.kind]} 그래프. 값은 '표로 보기'에서 읽을 수 있습니다.`} className="px-3 pb-4">
          <ReportChart block={block} dataset={dataset} />
        </div>
      )}
    </Card>
  );
}

function TableCard({ block, dataset, omitted }: { block: TableBlock; dataset: Dataset | undefined; omitted?: boolean }) {
  return (
    <Card title={block.title}>
      {dataset ? (
        <div className="border-line border-t">
          <ReportTable columns={block.columns} dataset={dataset} totals={block.totals} downloadTitle={block.title} />
        </div>
      ) : (
        <MissingData omitted={omitted} />
      )}
    </Card>
  );
}

// ───────────────────────────── 주의·제안 · 목록 ─────────────────────────────

/** 주의·제안 상자 — 뜻은 바탕색·아이콘·제목이 나른다(왼쪽 색 띠 금지 — no-left-accent-bar). */
const CALLOUT: Record<CalloutBlock["tone"], { box: string; icon: AywaIconName; ink: string; label: string }> = {
  info: { box: "bg-blue-soft", icon: "info", ink: "text-blue", label: "안내" },
  warn: { box: "bg-amber-soft", icon: "alert", ink: "text-amber", label: "주의" },
  good: { box: "bg-green-soft", icon: "success", ink: "text-green", label: "좋은 점" },
};

function Callout({ block }: { block: CalloutBlock }) {
  const t = CALLOUT[block.tone] ?? CALLOUT.info;
  return (
    <section role="note" aria-label={`${t.label}: ${block.title}`} className={`${t.box} flex gap-3 rounded-xl px-4 py-3.5`}>
      <EyIcon name={t.icon} size={20} className={`${t.ink} mt-0.5 shrink-0`} />
      <div className="min-w-0 space-y-1">
        <h4 className="text-foreground text-base font-bold break-words">{block.title}</h4>
        <p className="text-foreground text-sm leading-relaxed break-words whitespace-pre-line">{block.text}</p>
      </div>
    </section>
  );
}

function ListView({ block }: { block: ListBlock }) {
  return (
    <section className="space-y-2">
      {block.title ? <h4 className="text-foreground text-base font-bold break-words">{block.title}</h4> : null}
      <ul className="space-y-1.5 text-sm leading-relaxed">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="bg-primary mt-[0.6em] size-1.5 shrink-0 rounded-full" />
            <span className="min-w-0 break-words whitespace-pre-line">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────────── 비서 의견 ─────────────────────────────

/**
 * 비서 의견 — 원장 2026-11-06 *"형식적인 답변이 아닌 비서답게 어떻게 처리하면 좋겠다 같은 의견 제시도 같이"*. 보고서마다 하나.
 * 자료 블록(흰 카드)·주의/제안(파랑·앰버·초록 바탕)과 갈리게 **금빛 바탕 판 + 그 안의 흰 항목 카드** — AI 표시는 앱 공통
 * `sparkle + gold-soft`. 항목은 온 순서(= 우선순위)대로 번호 · 할 일(굵게) · '근거' 줄 · 언제(오늘만 앰버 = 내가 할 일) · 누가.
 */
function AdviceCard({ block }: { block: AdviceBlock }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="bg-gold-soft rounded-2xl px-3.5 pt-3.5 pb-3.5 sm:px-4">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-0.5 pb-3">
        <span aria-hidden className="bg-card text-gold shadow-card flex size-8 shrink-0 items-center justify-center rounded-xl">
          <EyIcon name="sparkle" size={18} />
        </span>
        <h4 id={id} className="text-foreground text-base font-bold">
          비서 의견
        </h4>
        <span className="text-sm font-medium">이렇게 처리하시면 좋겠습니다</span>
      </header>
      <ol className="space-y-2">
        {block.items.map((item, i) => (
          <li key={i} className="bg-card shadow-card flex gap-3 rounded-xl px-3.5 py-3">
            <span aria-hidden className="bg-gold text-primary-foreground num mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 text-base leading-snug font-bold break-words">{item.action}</p>
                {item.when ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${item.when === "today" ? "bg-amber-soft text-amber" : "bg-bg-soft"}`}
                  >
                    {ADVICE_WHEN_LABEL[item.when] ?? item.when}
                  </span>
                ) : null}
                {item.who ? <span className="bg-bg-soft rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap">{`담당 · ${item.who}`}</span> : null}
              </div>
              <p className="text-sm leading-relaxed break-words whitespace-pre-line">
                <span className="mr-1.5 font-bold">근거</span>
                {item.why}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ───────────────────────────── 근거 ─────────────────────────────

/**
 * 확인한 자료 범위 — 원장 2026-11-06 *"DB 전체 조회하고 답변하는거 맞아? … 하나도 빠짐없이 남김없이"*.
 * 전수 조회(서버)가 센 표 중 자료가 있는 표마다: 기간 건수 · 최근 날짜 · 이번 답이 자세히 봤나(✓) / 건수만 셌나 — 빠진 것을 원장이 직접 본다.
 * 표 이름은 한국어 라벨로(마우스를 올리면 실제 표 이름). 기본은 접힘 — 머리 줄에 '표 N개 확인 · 자료 있는 표 M개 · 자세히 본 표 K개'.
 */
function Coverage({ coverage }: { coverage: NonNullable<SettledReport["coverage"]> }) {
  return (
    <>
      {coverage.surveys.map((s, i) => {
        const withData = s.tables.filter((t) => !t.failed);
        const seen = withData.filter((t) => t.examined).length;
        const failed = s.tables.filter((t) => t.failed).length;
        return (
          <details key={i} className="group border-line rounded-xl border">
            <summary className="hover:bg-muted flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-4 py-2.5 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
              <EyIcon name="listChecks" size={16} />
              <span className="font-bold">확인한 자료 범위</span>
              <span className="min-w-0 break-words">{`${s.target} ${s.name} · ${s.from}~${s.to}`}</span>
              <span className="num">{`표 ${s.checked}개 확인 · 자료 있는 표 ${withData.length}개 · 자세히 본 표 ${seen}개${failed ? ` · 세지 못한 표 ${failed}개` : ""}`}</span>
              <EyIcon name="chevronDown" size={16} className="ml-auto transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <ul className="border-line space-y-1 border-t px-4 py-3 text-sm">
              {s.tables.map((t) => (
                <li key={t.key ?? t.table} className="flex flex-wrap items-baseline gap-x-2">
                  <span {...tipProps({ title: t.label, rows: [["DB 표", t.table]] })} className="min-w-0 font-medium break-words">
                    {t.label}
                  </span>
                  {t.failed ? (
                    <span className="text-amber font-bold">세지 못함</span>
                  ) : (
                    <span className="num whitespace-nowrap">
                      {t.inPeriod !== null ? `기간 ${t.inPeriod.toLocaleString("ko-KR")}건 · 전체 ${(t.total ?? 0).toLocaleString("ko-KR")}건` : `전체 ${(t.total ?? 0).toLocaleString("ko-KR")}건`}
                      {t.latest ? ` · 최근 ${t.latest}` : ""}
                    </span>
                  )}
                  {!t.failed ? (
                    <span className={`ml-auto text-xs font-bold whitespace-nowrap ${t.examined ? "text-green" : "text-text-faint"}`}>{t.examined ? "✓ 자세히 봄" : "건수만 셈"}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </>
  );
}

/** 근거 — 이 보고서가 읽은 조회의 목적과 행 수(접힘 · JS 없이 `<details>`). 🔴 SQL은 보이지 않는다. */
function Sources({ report }: { report: SettledReport }) {
  const sources = reportSources(report);
  if (sources.length === 0) return null;
  return (
    <details className="group border-line rounded-xl border">
      <summary className="hover:bg-muted flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <EyIcon name="layers" size={16} />
        <span className="font-bold">근거</span>
        <span>{`조회 ${sources.length}건`}</span>
        <EyIcon name="chevronDown" size={16} className="ml-auto transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="border-line space-y-1.5 border-t px-4 py-3 text-sm">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 break-words">{s.purpose}</span>
            <span className="num whitespace-nowrap">{`${s.rowCount.toLocaleString("ko-KR")}행`}</span>
            {s.truncated ? <span className="text-amber font-bold whitespace-nowrap">일부만</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
