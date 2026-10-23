"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ExplorerKind } from "@/features/students/ontology/explorer";
import { entityLabels } from "./ontology-labels";
import { ListPager } from "./list-pager";
import { fieldClass, numberText } from "./presentation";

export type OntologyDirectoryRow = { id: string; label: string; detail?: string; count: number };
export function OntologyDirectory({ kind, rows, description, measure, onSelect }: {
  kind: ExplorerKind; rows: OntologyDirectoryRow[]; description: string;
  measure?: { label: string; unit: string }; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const label = entityLabels[kind], hasDetails = rows.some((row) => row.detail !== undefined);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko-KR");
    return rows.filter((row) => `${row.label} ${row.detail ?? ""}`.toLocaleLowerCase("ko-KR").includes(query))
      .sort((a, b) => a.label.localeCompare(b.label, "ko-KR") || a.id.localeCompare(b.id));
  }, [rows, search]);
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  return <section aria-label={`${label} 목록`} className="min-w-0 overflow-hidden rounded-xl border border-line">
    <div className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div><h2 className="font-semibold">전체 {label} <span className="ml-2 tabular-nums text-primary">{numberText(rows.length)}{kind === "student" || kind === "teacher" ? "명" : "개"}</span></h2>
        <p className="mt-2 text-sm leading-relaxed">{description}</p></div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <input aria-label={`${label} 목록 검색`} placeholder={hasDetails ? "이름 또는 학교로 찾기" : `${label} 이름으로 찾기`}
          value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className={`${fieldClass} w-full sm:w-72`} />
        {search && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setPage(1); }}>초기화</Button>}
      </div>
    </div>
    <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
      <thead className="bg-secondary"><tr>
        <th scope="col" className="px-5 py-3 text-left font-medium">{label}</th>
        {hasDetails && <th scope="col" className="px-5 py-3 text-left font-medium">학교·학년</th>}
        {measure && <th scope="col" className="w-28 px-5 py-3 text-right font-medium sm:w-40">{measure.label}</th>}
      </tr></thead>
      <tbody>{filtered.slice((current - 1) * 20, current * 20).map((row) => <tr key={row.id} className="border-t border-line-faint hover:bg-primary-softer">
        <td className="px-5 py-3"><button type="button" onClick={() => onSelect(row.id)} aria-label={`${row.label} 연결 보기`}
          className="text-left font-semibold break-words text-primary underline-offset-4 hover:underline focus-visible:outline-primary">{row.label}</button></td>
        {hasDetails && <td className="break-words px-5 py-3">{row.detail || "—"}</td>}
        {measure && <td className="px-5 py-3 text-right tabular-nums">{numberText(row.count)}{measure.unit}</td>}
      </tr>)}</tbody>
    </table></div>
    {!filtered.length && <p role="status" className="px-5 py-10 text-center text-sm">{search.trim() ? "검색 조건에 맞는 항목이 없습니다." : "조회할 항목이 없습니다."}</p>}
    <ListPager page={current} total={filtered.length} pageSize={20} onChange={setPage} label={`${label} 목록`} unit={kind === "student" || kind === "teacher" ? "명" : "개"} />
  </section>;
}
