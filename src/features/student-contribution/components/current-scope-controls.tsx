"use client";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { liveScopeHref, type LiveScopeData, type LiveScopeRequest } from "@/features/students/ontology/live-scope";
import type { ExplorerKind } from "@/features/students/ontology/explorer";
import { entityLabels } from "./ontology-labels";
import { fieldClass } from "./presentation";

export function CurrentScopeControls({ request, options }: { request: LiveScopeRequest; options: LiveScopeData["options"] }) {
  const router = useRouter(), params = useSearchParams(), [pending, start] = useTransition();
  const [search, setSearch] = useState(request.search);
  const move = (next: LiveScopeRequest) => start(() => router.push(liveScopeHref(next, params.get("embed") === "1"), { scroll: false }));
  const choose = (kind: ExplorerKind, id: string) => move({ kind, id, search: "", page: 1 });
  return <div className="space-y-3" aria-busy={pending}>
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1" aria-label="현재 연결 관점">
        {Object.entries(entityLabels).map(([key, label]) => <Button key={key} size="sm" variant={request.kind === key ? "default" : "ghost"} disabled={pending}
          aria-pressed={request.kind === key} onClick={() => choose(key as ExplorerKind, options.find((o) => o.kind === key)?.id ?? "")}>{label}</Button>)}
      </div>
      <SearchableSelect ariaLabel={`${entityLabels[request.kind]} 현재 연결 선택`} value={request.id} onValueChange={(id) => choose(request.kind, id)}
        placeholder="대상을 선택해 주세요" searchPlaceholder="이름으로 찾기" className="min-w-56 flex-1"
        options={options.filter((o) => o.kind === request.kind).map((o) => ({ value: o.id, label: o.label, meta: `${o.students}명` }))} />
      {pending && <span role="status" className="text-xs">연결을 불러오는 중…</span>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); move({ ...request, page: 1, search: search.trim() }); }} className="flex gap-2">
      <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="현재 연결된 학생 검색" placeholder="이름 또는 학교로 학생 찾기" maxLength={100}
        className={`${fieldClass} min-w-0 flex-1`} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>검색</Button>
      {request.search && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => move({ ...request, page: 1, search: "" })}>초기화</Button>}
    </form>
  </div>;
}

export function CurrentScopeRefresh() {
  const router = useRouter(), [pending, start] = useTransition();
  return <Button variant="outline" size="sm" disabled={pending} onClick={() => start(() => router.refresh())}>
    {pending ? "조회 중…" : "다시 조회"}
  </Button>;
}
