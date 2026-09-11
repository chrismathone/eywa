import type { ReactNode } from "react";
import { comma, type BarRow, type BarTone } from "../sheet-model";

/**
 * 인재원 결과지·분석지 **공용 조각** — 틀 · 구역 · 막대 · 지표 칸 · 단어 표. 순수 프레젠테이션.
 *
 * ⚠️ 훅·"use client"·서버 전용 모듈을 들이지 말 것 — 같은 조각을 학부모 카드(/r·PDF·ClassNote 캡처, 서버)와
 *    원스크린 미리보기(클라이언트)가 함께 그린다.
 * eywa 문법(팔레트 v4): 면 = 화이트, 구분 = 헤어라인, 색 = 뜻 — 막대는 학원색 한 색, 60% 미만만 빨강(critical).
 * 🔑 틀은 `@container` — 두 단 배치는 창 폭이 아니라 **이 틀의 폭**을 본다(학부모 카드 512px에선 저절로 한 단).
 */

const FILL: Record<BarTone, string> = { primary: "bg-primary", critical: "bg-danger" };
const METER_H = { sm: "h-1.5", md: "h-2.5", lg: "h-4" } as const;
const BAR_GRID = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3rem_minmax(0,5.5rem)] items-center gap-x-2.5";
const WORD_GRID = "grid grid-cols-[1.75rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-x-2";

export function SheetFrame({
  kind,
  layout,
  eyebrow,
  title,
  meta,
  aside,
  children,
}: {
  kind: "study" | "exam";
  layout: "card" | "wide";
  eyebrow: string;
  title: string;
  meta?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-jj-sheet={kind} data-layout={layout} className="bg-card shadow-card @container rounded-2xl px-5 py-4">
      <header className="border-line flex items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <p className="editorial-eyebrow">{eyebrow}</p>
          <h3 className="text-foreground mt-0.5 text-xl leading-tight font-bold break-keep">{title}</h3>
          {meta ? <p className="text-text-dim mt-1 text-sm">{meta}</p> : null}
        </div>
        {aside ? <div className="shrink-0 pt-0.5 text-right">{aside}</div> : null}
      </header>
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function SheetSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-foreground text-base font-bold">{title}</h4>
        {note ? <p className="text-text-dim text-xs">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** 막대(미터) — 바탕은 학원색의 옅은 단계, 채움이 값. */
export function Meter({ pct, tone = "primary", size = "md" }: { pct: number; tone?: BarTone; size?: keyof typeof METER_H }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span className={`bg-primary-soft relative block w-full overflow-hidden rounded-full ${METER_H[size]}`} aria-hidden>
      {w > 0 ? <span className={`absolute inset-y-0 left-0 rounded-full ${FILL[tone]}`} style={{ width: `${w}%` }} /> : null}
    </span>
  );
}

/** 핵심 지표 한 칸 — 이름표 / 값 / 설명 / (비율이면) 미터. */
export function KpiTile({ label, value, note, ratio }: { label: string; value: string; note?: string; ratio?: number }) {
  return (
    <div className="bg-bg-soft flex min-w-0 flex-col gap-1 rounded-xl px-3.5 py-3">
      <span className="text-text-dim text-xs font-medium">{label}</span>
      <span className="num text-foreground text-2xl leading-tight font-bold">{value}</span>
      {note ? <span className="text-text-dim text-xs">{note}</span> : null}
      {ratio != null ? (
        <span className="mt-1 block">
          <Meter pct={ratio * 100} size="sm" />
        </span>
      ) : null}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="bg-bg-soft text-text-dim rounded-xl px-3.5 py-3 text-sm">{children}</p>;
}

/** 가로 막대 목록 — 이름 | 막대 | 정답률 | 맞힘/전체. '그 외'는 옅게, 합계는 굵게 선 위에. */
export function BarList({ rows, heads }: { rows: BarRow[]; heads: [string, string] }) {
  return (
    <div className="flex flex-col">
      <div className={`${BAR_GRID} pb-1`}>
        <span className="micro">{heads[0]}</span>
        <span />
        <span className="micro text-right">정답률</span>
        <span className="micro text-right">{heads[1]}</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className={`${BAR_GRID} py-1.5 ${r.kind === "sum" ? "border-line mt-1 border-t pt-2" : ""}`}>
          <span
            title={r.label}
            className={`truncate text-sm ${r.kind === "sum" ? "font-bold" : r.kind === "rest" ? "text-text-dim font-medium" : "font-medium"}`}
          >
            {r.label}
          </span>
          <Meter pct={r.pct} tone={r.tone} />
          <span className={`num text-right text-sm font-bold ${r.tone === "critical" ? "text-danger" : "text-foreground"}`}>
            {r.pct}%
          </span>
          <span className="num text-text-dim text-right text-xs whitespace-nowrap">
            {comma(r.correct)} / {comma(r.total)}
          </span>
        </div>
      ))}
    </div>
  );
}

export type WordTableRow = { key: string; no: number; prompt: string; answer: string; last: ReactNode };

/** 단어 표 — # | 문제(뜻) | 정답 | 마지막 칸(학생 답·틀림 횟수). 뜻이 길면 줄을 바꾼다(자르지 않는다). */
export function WordTable({ heads, rows, more }: { heads: [string, string, string]; rows: WordTableRow[]; more?: number }) {
  return (
    <div className="ring-line overflow-hidden rounded-xl ring-1">
      <div className={`${WORD_GRID} bg-primary-soft text-primary px-3 py-1.5 text-xs font-bold`}>
        <span className="text-center">#</span>
        <span>{heads[0]}</span>
        <span>{heads[1]}</span>
        <span className="text-right">{heads[2]}</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.key} className={`${WORD_GRID} items-baseline px-3 py-1.5 text-sm ${i % 2 ? "bg-bg-soft" : ""}`}>
          <span className="num text-text-dim text-center text-xs">{r.no}</span>
          <span className="break-keep">{r.prompt}</span>
          <span className="text-green font-bold break-words">{r.answer}</span>
          <span className="text-right break-words">{r.last}</span>
        </div>
      ))}
      {more ? <p className="text-text-dim border-line border-t px-3 py-1.5 text-right text-xs">외 {more}개</p> : null}
    </div>
  );
}
