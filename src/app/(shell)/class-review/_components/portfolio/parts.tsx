import type { ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { DELTA_CLASS, deltaOf, fmtScore, statusTone } from "@/features/teacher-portfolio/view";

/** 직원 포트폴리오 내역 카드의 작은 부품들 — 통계 줄 · 표 · 겹침 막대 · 막대 목록. */

export type ColumnKind = "text" | "num" | "money" | "bar";
const ALIGN: Record<ColumnKind, string> = { text: "text-left", num: "text-center", money: "text-right", bar: "text-left" };

export function StatTiles({ items }: { items: { label: string; value: string; className?: string }[] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
      {items.map((item) => (
        <div key={item.label} className="bg-bg-soft/60 min-w-0 rounded-lg px-3 py-2.5">
          <dt className="text-xs">{item.label}</dt>
          <dd className={`num mt-1 text-base font-bold [overflow-wrap:anywhere] ${item.className ?? ""}`}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TableRow = { key: string; cells: ReactNode[]; selected?: boolean; onSelect?: () => void };
/**
 * 내역 표 — 제목과 값은 같은 축에 둔다(글·막대 왼쪽 · 짧은 값 가운데 · 금액 오른쪽).
 * `fixed`면 첫 열과 막대 열의 폭을 고정해 숫자 열이 고르게 선다.
 */
export function DataTable({ headers, kinds = [], rows, empty = "해당 월 기록이 없습니다.", fixed = false, sticky = false }: {
  headers: ReactNode[]; kinds?: ColumnKind[]; rows: TableRow[]; empty?: string; fixed?: boolean; sticky?: boolean;
}) {
  const kindOf = (i: number): ColumnKind => kinds[i] ?? (i ? "num" : "text");
  const width = (i: number) => (fixed ? (kindOf(i) === "bar" ? "w-[34%]" : i === 0 ? "w-[18%]" : "") : "");
  return (
    <table className={`w-full border-collapse text-xs ${fixed ? "table-fixed" : ""}`}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} scope="col" className={`bg-bg-soft px-2 py-2.5 font-bold whitespace-nowrap ${ALIGN[kindOf(i)]} ${width(i)} ${sticky ? "sticky top-0 z-[1]" : ""}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((row) => (
          <tr key={row.key} onClick={row.onSelect}
            className={`border-line-faint border-b last:border-b-0 ${row.onSelect ? "hover:bg-primary-softer cursor-pointer" : ""} ${row.selected ? "bg-primary-soft" : ""}`}>
            {row.cells.map((cell, i) => (
              <td key={i} className={`px-2 py-2.5 ${ALIGN[kindOf(i)]} ${kindOf(i) === "text" ? "" : "num whitespace-nowrap"}`}>{cell}</td>
            ))}
          </tr>
        )) : (
          <tr><td colSpan={headers.length} className="px-3 py-6 text-center">{empty}</td></tr>
        )}
      </tbody>
    </table>
  );
}

/** 대상 중 채운 몫을 색으로 나눠 보인다. 숫자는 옆 칸이 말한다. */
export function StackBar({ parts, total }: { parts: { color: string; count: number }[]; total: number }) {
  return (
    <div aria-hidden className="bg-bg-soft flex h-2 min-w-16 overflow-hidden rounded-full">
      {parts.filter((p) => p.count > 0).map((p, i) => (
        <span key={i} className="h-full" style={{ width: `${total ? (p.count / total) * 100 : 0}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function BarList({ rows, max, color, format }: {
  rows: { label: string; value: number | null; meta?: string }[]; max: number; color: string; format: (n: number) => string;
}) {
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
            <span className="min-w-0">{row.label}</span>
            <b className="num whitespace-nowrap">{row.value === null ? "산출불가" : format(row.value)}</b>
          </div>
          <div aria-hidden className="bg-bg-soft h-2 overflow-hidden rounded-full">
            <span className="block h-full rounded-full" style={{ width: `${max && row.value !== null ? Math.min(100, (row.value / max) * 100) : 0}%`, background: color }} />
          </div>
          {row.meta ? <p className="mt-1 text-xs">{row.meta}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function StatusChip({ state }: { state: string }) {
  return <Pill color={toneColor(statusTone(state))} className="whitespace-nowrap">{state}</Pill>;
}

export function Delta({ now, before }: { now: number | null; before: number | null | undefined }) {
  const d = deltaOf(now, before);
  return <span aria-label={d.label} className={`num text-xs font-bold whitespace-nowrap ${DELTA_CLASS[d.tone]}`}>{d.text}</span>;
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <h4 className="mt-5 mb-2.5 flex flex-wrap items-baseline gap-x-2 text-sm font-bold first:mt-0">
      {children}
      {sub ? <span className="num text-xs font-medium">{sub}</span> : null}
    </h4>
  );
}

export function ScoreValue({ value, max, className = "" }: { value: number | null; max: number; className?: string }) {
  return (
    <b className={`num leading-none font-bold whitespace-nowrap ${className}`}>
      {fmtScore(value)}
      <small className="ml-1 text-xs font-medium">/ {max}점</small>
    </b>
  );
}
