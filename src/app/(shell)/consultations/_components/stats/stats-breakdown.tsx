"use client";

import { EmbedLink } from "@/components/embed-link";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import type { StatsDimKey, StatsDimView, StatsUnit } from "@/features/consultations/stats-model";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/**
 * 분해 — 상담사·과목·반·카테고리·대상·작성 경로별 건수(목록 기간 안)와 **작은 추이**(최근 12개월/12주).
 * 줄을 누르면 목록이 그 값으로 걸러진다 — 목록 필터가 있는 축(상담사·과목·카테고리)만. 반 필터는 두지 않는다(원장 요청 범위 밖).
 * 상위 12개만 싣는다(RPC `p_top`) — 나머지는 개수만 적는다.
 */
export function StatsBreakdown({
  dims,
  dim,
  unit,
  total,
  onDim,
}: {
  dims: StatsDimView[];
  dim: StatsDimKey;
  unit: StatsUnit;
  total: number;
  onDim: (d: StatsDimKey) => void;
}) {
  if (dims.length === 0) return null;
  const view = dims.find((d) => d.key === dim) ?? dims[0]!;
  const shown = view.rows.reduce((a, r) => a + r.n, 0);
  return (
    <div className="border-line space-y-2 rounded-2xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-sm font-bold">{view.label}별</p>
        <ToolbarSegment wrap>
          {dims.map((d) => (
            <ToolbarSegmentItem key={d.key} active={d.key === view.key} onClick={() => d.key !== view.key && onDim(d.key)}>
              {d.label}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      </div>
      {view.rows.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">기록이 없습니다</p>
      ) : (
        <ul className="divide-line divide-y">
          {view.rows.map((r) => {
            const share = total > 0 ? Math.round((r.n / total) * 100) : 0;
            const body = (
              <>
                <span className={`min-w-0 truncate text-sm ${r.active ? "text-primary font-bold" : "text-foreground font-medium"}`} title={r.label}>
                  {r.label}
                </span>
                <Sparkline values={unit === "week" ? r.w : r.m} />
                <span className="num text-foreground text-right text-sm font-bold whitespace-nowrap">{fmt(r.n)}</span>
                <span className="num text-muted-foreground w-10 text-right text-xs whitespace-nowrap">{share}%</span>
              </>
            );
            const cls = "grid grid-cols-[minmax(0,1fr)_4.5rem_auto_auto] items-center gap-2 py-1.5";
            return (
              <li key={r.key}>
                {r.href ? (
                  <EmbedLink href={r.href} title={`${r.label} — 목록을 이 값으로 거르기`} className={`${cls} hover:bg-bg-soft rounded-md px-1`}>
                    {body}
                  </EmbedLink>
                ) : (
                  <div className={`${cls} px-1`}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-muted-foreground text-xs break-keep">
        건수·비율 = 위 기간·범위 안 {fmt(total)}건 기준 · 작은 막대 = {unit === "week" ? "최근 12주" : "최근 12개월"}
        {view.distinct > view.rows.length ? ` · 상위 ${view.rows.length}개(외 ${view.distinct - view.rows.length}개 ${fmt(total - shown)}건)` : ""}
      </p>
    </div>
  );
}

/** 12칸 작은 막대 — 라이브러리 없이 SVG(패널이 가볍게 뜨도록, B5). 최댓값에 맞춘 상대 높이. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 72;
  const h = 20;
  const gap = 1;
  const bw = values.length > 0 ? (w - gap * (values.length - 1)) / values.length : w;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      {values.map((v, i) => {
        const bh = v > 0 ? Math.max(2, (v / max) * h) : 1;
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={1} fill={v > 0 ? "var(--color-rose)" : "var(--color-border)"} />;
      })}
    </svg>
  );
}
