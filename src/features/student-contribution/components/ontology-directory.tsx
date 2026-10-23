"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { ExplorerKind } from "@/features/students/ontology/explorer";
import { entityLabels } from "./ontology-labels";
import { ListPager } from "./list-pager";
import { fieldClass, numberText } from "./presentation";

export type OntologyDirectoryRow = { id: string; label: string; detail?: string; count: number };
export function OntologyDirectory({ kind, rows, description, measure, onSelect, hideSearch = false }: {
  kind: ExplorerKind; rows: OntologyDirectoryRow[]; description: string;
  measure?: { label: string; unit: string }; onSelect: (id: string) => void; hideSearch?: boolean;
}) {
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const label = entityLabels[kind], hasDetails = rows.some((row) => row.detail !== undefined);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko-KR");
    return rows.filter((row) => `${row.label} ${row.detail ?? ""}`.toLocaleLowerCase("ko-KR").includes(query))
      .sort((a, b) => a.label.localeCompare(b.label, "ko-KR") || a.id.localeCompare(b.id));
  }, [rows, search]);
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  return <section aria-label={`${label} 목록`} className="@container min-w-0 overflow-hidden rounded-xl border border-line">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div><h2 className="font-semibold">조회 {label} <span className="ml-2 tabular-nums text-primary">{numberText(filtered.length)}{kind === "student" || kind === "teacher" ? "명" : "개"}</span></h2>
        <p className="mt-1 text-xs leading-relaxed">{description}</p></div>
      {!hideSearch && <div className="flex w-full items-center gap-2 sm:w-auto">
        <input aria-label={`${label} 목록 검색`} placeholder={hasDetails ? "이름 또는 학교로 찾기" : `${label} 이름으로 찾기`}
          value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className={`${fieldClass} w-full sm:w-72`} />
        {search && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setPage(1); }}>초기화</Button>}
      </div>}
    </div>
    {measure && <p className="px-4 pt-3 text-xs">표시 수치: {measure.label}</p>}
    <ul className="grid grid-cols-1 gap-x-5 px-4 py-1 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[80rem]:grid-cols-4">
      {filtered.slice((current - 1) * 20, current * 20).map((row) => <li key={row.id} className="min-w-0 border-b border-line-faint">
        <button type="button" onClick={() => onSelect(row.id)}
          aria-label={`${row.label}${hasDetails ? ` · ${row.detail || "학교·학년 미등록"}` : ""}${measure ? ` · ${measure.label} ${numberText(row.count)}${measure.unit}` : ""} 연결 보기`}
          className="group flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-primary-softer focus-visible:bg-primary-softer focus-visible:outline-primary">
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-primary">{row.label}</span>
            {hasDetails && <span className="mt-0.5 block break-words text-xs">{row.detail || "학교·학년 미등록"}</span>}</span>
          {measure && <span className="shrink-0 text-right text-sm tabular-nums" title={measure.label}>{numberText(row.count)}<span className="ml-0.5 text-xs">{measure.unit}</span></span>}
          <span aria-hidden="true" className="shrink-0 text-primary"><EyIcon name="chevronRight" size={14} /></span>
        </button>
      </li>)}
    </ul>
    {!filtered.length && <p role="status" className="px-5 py-10 text-center text-sm">{search.trim() ? "검색 조건에 맞는 항목이 없습니다." : "조회할 항목이 없습니다."}</p>}
    <ListPager page={current} total={filtered.length} pageSize={20} onChange={setPage} label={`${label} 목록`} unit={kind === "student" || kind === "teacher" ? "명" : "개"} />
  </section>;
}
