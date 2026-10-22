"use client";
import { useState } from "react";
import type { ExplorerKind, ExplorerLink } from "@/features/students/ontology/explorer";
import { ListPager } from "./list-pager";
import { fieldClass, numberText } from "./presentation";
export const entityLabels: Record<ExplorerKind, string> = { student: "학생", class: "반", teacher: "강사", subject: "과목", academy: "학원" };
type Names = Record<ExplorerKind, { id: string; label: string }[]>;

export function OntologyConnections({ links, labels, selected, currentKind, onSelect }: {
  links: ExplorerLink[]; labels: Names; selected: string; currentKind: ExplorerKind; onSelect: (kind: ExplorerKind, id: string) => void;
}) {
  const [kind, setKind] = useState<ExplorerKind>("class"), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const names = new Map(labels[kind].map((item) => [item.id, item.label]));
  const rows = links.filter((link) => link.kind === kind && (names.get(link.id) ?? "").includes(search.trim()))
    .sort((a, b) => b.factCount - a.factCount || (names.get(a.id) ?? "").localeCompare(names.get(b.id) ?? ""));
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  return <section className="min-w-0 overflow-hidden rounded-xl border border-line">
    <div className="border-b border-line p-5"><h2 className="font-semibold">기록으로 연결된 대상</h2><p className="mt-2 text-xs leading-relaxed">{selected}의 이 달 기록에 함께 연결된 대상입니다. 대상을 선택해 관점을 바꿀 수 있습니다.</p></div>
    <div className="p-4"><div className="flex gap-2" aria-label="연결 대상 종류">{Object.entries(entityLabels).filter(([key]) => key !== "academy" || currentKind !== "academy").map(([key, label]) => <button key={key} type="button" aria-pressed={kind === key}
      onClick={() => { setKind(key as ExplorerKind); setSearch(""); setPage(1); }} className={`min-w-0 flex-1 rounded-lg border px-1 py-3 text-center text-xs focus-visible:outline-primary ${kind === key ? "border-primary bg-primary-softer" : "border-line hover:bg-secondary"}`}><span className="block">{key === currentKind ? `다른 ${label}` : label}</span><strong className="mt-1 block text-base tabular-nums">{links.filter((link) => link.kind === key).length}</strong></button>)}</div>
      <input aria-label="연결 대상 검색" className={`${fieldClass} mt-4 w-full`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={`${entityLabels[kind]} 이름으로 찾기`} />
    </div>
    <div className="flex justify-between bg-secondary px-5 py-2 text-xs"><span>{entityLabels[kind]}</span><span>함께 연결된 기록</span></div>
    <ul className="divide-y divide-line-faint">{rows.slice((current - 1) * 8, current * 8).map((link) => <li key={link.id}><button type="button" onClick={() => onSelect(link.kind, link.id)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-primary-softer focus-visible:outline-primary"><span className="min-w-0 break-words font-medium text-primary">{names.get(link.id) ?? `${entityLabels[kind]} 이름 확인 필요`}</span><span className="shrink-0 tabular-nums">{numberText(link.factCount)}건</span></button></li>)}</ul>
    {!rows.length && <p className="px-5 py-8 text-center text-sm">이 달의 기록에서 확인된 {entityLabels[kind]} 연결이 없습니다.</p>}
    <ListPager page={current} total={rows.length} pageSize={8} onChange={setPage} label="연결 대상" />
    <p className="border-t border-line px-5 py-3 text-xs leading-relaxed">연결 건수는 서로 겹칠 수 있습니다. 대상별 건수를 더해 전체 기록 수로 사용하지 않습니다.</p>
  </section>;
}
