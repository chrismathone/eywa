"use client";

import { useEffect, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { columnBest, compareColumns, sortCompareRows, type CompareRow, type CompareSort } from "@/features/teacher-portfolio/compare";
import type { StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { loadPortfolioComparison } from "@/features/teacher-portfolio/server/compare-actions";
import { saveCompareSort } from "@/features/teacher-portfolio/server/view-prefs-actions";
import { HrefSelect } from "@/components/href-select";
import { monthName, periodLabel } from "@/features/teacher-portfolio/view";

/**
 * 직원별 항목 비교(원장 2026-10-15 *"직원 포트폴리오 점수 완성되면 직원별로 항목 비교 가능하게"*) — 한 달을 골라 직원 × 항목 표.
 * 열 머리를 누르면 그 항목으로 정렬(다시 누르면 방향이 바뀐다 — 원생목록과 같은 화살표). 줄을 누르면 그 직원 포트폴리오로.
 * 점수는 저장된 그대로(그 달 설정으로 매긴 값) · 열마다 가장 높은 점수는 굵게.
 */
const ARROW = { asc: "↑", desc: "↓" } as const;

export function CompareDialog({ open, onClose, periods, month: initial, initialSort, nameOf, onPick }: {
  open: boolean; onClose: () => void; periods: readonly StoredPeriod[]; month: string; initialSort?: CompareSort;
  nameOf: (teacherId: string) => string; onPick: (teacherId: string) => void;
}) {
  const [month, setMonth] = useState(initial);
  const [state, setState] = useState<{ month: string; rows: CompareRow[] } | { month: string; error: string } | null>(null);
  const [sort, setSort] = useState<CompareSort>(initialSort ?? { key: "total", dir: "desc" });
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadPortfolioComparison(month).then(
      (r) => { if (live) setState(r.ok ? { month, rows: r.rows } : { month, error: r.error }); },
      () => { if (live) setState({ month, error: "불러오지 못했습니다. 잠시 후 다시 열어 주세요" }); },
    );
    return () => { live = false; };
  }, [open, month]);
  const ready = state && state.month === month ? state : null;
  const rows = ready && "rows" in ready ? ready.rows : [];
  const columns = compareColumns(rows);
  const sorted = sortCompareRows(rows, sort, nameOf);
  // 정렬은 계정에 저장한다(모든 뷰 세팅은 계정 귀속) — 실패해도 화면 정렬은 그대로.
  const toggle = (key: string) => {
    const next: CompareSort = sort.key === key ? { key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" };
    setSort(next);
    void saveCompareSort(next).catch(() => undefined);
  };
  const head = (key: string, label: string, sub: string) => (
    <th key={key} scope="col" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="px-2 py-2 text-center align-bottom">
      <button type="button" onClick={() => toggle(key)} className="hover:text-primary inline-flex flex-col items-center gap-0.5 font-bold break-keep [overflow-wrap:normal]">
        <span>{label}{sort.key === key ? <span aria-hidden className="ml-0.5">{ARROW[sort.dir]}</span> : null}</span>
        <small className="num text-xs font-medium">{sub}</small>
      </button>
    </th>
  );
  const fmt = (n: number) => n.toFixed(1);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[min(92dvh,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <div className="border-line flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
          <DialogTitle className="text-base font-bold">직원별 항목 비교</DialogTitle>
          <HrefSelect axisLabel="달" ariaLabel="비교할 달" value={month} onSelect={setMonth}
            options={periods.map((w) => ({ value: w.month, label: periodLabel(w) }))} />
          <DialogClose aria-label="닫기" className="hover:bg-muted focus-visible:outline-primary ml-auto rounded-lg p-1.5 focus-visible:outline-2"><EyIcon name="close" size={18} /></DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
          {!ready ? <p role="status" className="px-4 py-3 text-sm">불러오는 중…</p> : "error" in ready ? <p role="alert" className="text-danger px-4 py-3 text-sm">{ready.error}</p>
            : !rows.length ? <p className="px-4 py-3 text-sm">{monthName(month)}에 집계된 직원이 없습니다.</p> : (
              <table className="num w-full border-collapse text-sm [&_td]:border-line-faint [&_td]:border-t [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead className="bg-bg-soft sticky top-0 z-10 text-xs">
                  <tr>
                    <th scope="col" className="bg-bg-soft sticky left-0 px-3 py-2 text-left">직원</th>
                    {head("total", "총점", `${rows[0]?.knownMax ?? 0}점`)}
                    {columns.map((c) => head(c.id, c.label, c.max > 0 ? `${c.max}점` : "가감"))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.teacherId} className="hover:bg-primary-softer">
                      <th scope="row" className="bg-card sticky left-0 px-3 py-2 text-left font-medium whitespace-nowrap">
                        <button type="button" onClick={() => onPick(r.teacherId)} className="hover:text-primary underline-offset-2 hover:underline">{nameOf(r.teacherId)}</button>
                      </th>
                      <td className={`px-2 py-2 text-center ${r.total !== null && r.total === columnBest(rows, "total") ? "text-primary font-bold" : ""}`}>{r.total === null ? "—" : fmt(r.total)}</td>
                      {columns.map((c) => {
                        const m = r.items.find((x) => x.id === c.id);
                        const best = m?.value !== null && m?.value !== undefined && m.value === columnBest(rows, c.id);
                        return (
                          <td key={c.id} className={`px-2 py-2 text-center ${best ? "text-primary font-bold" : ""}`}>
                            {!m ? "—" : m.value === null ? "제외" : fmt(m.value)}
                            <small className="block text-xs font-normal">
                              {!m ? "" : m.uncounted ? "계산 전" : m.freelancer ? "프리랜서" : m.missing ? "자료 없음" : m.raw === null ? "" : `${Number.isInteger(m.raw) ? m.raw : m.raw.toFixed(1)}${c.unit}`}
                            </small>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
