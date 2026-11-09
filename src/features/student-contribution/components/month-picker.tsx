"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { monthText, fieldClass } from "./presentation";
import { useOntologyNavigation } from "./ontology-navigation";

export function ContributionMonthPicker({ month, months, scope }: { month: string; months?: string[]; scope?: { kind: string; id: string } }) {
  const pathname = usePathname(), search = useSearchParams();
  const { pending: busy, navigate } = useOntologyNavigation();
  const choices = months ? [...months].sort() : null;
  const index = choices?.indexOf(month) ?? -1;
  const move = (next: string) => {
    if (!next || next === month) return;
    const params = new URLSearchParams(search.toString()); params.set("month", next); params.delete("page");
    if (scope) { params.set("kind", scope.kind); params.set("entity", scope.id); }
    navigate(`${pathname}?${params}`);
  };
  return <div className="flex items-center gap-2" aria-busy={busy}>
    {choices && <Button size="icon-sm" variant="outline" aria-label="이전 기록 월" disabled={busy || index <= 0} onClick={() => move(choices[index - 1]!)}><EyIcon name="chevronLeft" size={16} /></Button>}
    {choices ? <select aria-label="충성도 월 선택" value={month} onChange={(e) => move(e.target.value)} disabled={busy} className={`${fieldClass} font-semibold`}>
      {[...choices].reverse().map((m) => <option key={m} value={m}>{monthText(m)}</option>)}
    </select> : <input type="month" aria-label="기록 월" value={month} onChange={(e) => move(e.target.value)} disabled={busy} className={fieldClass} />}
    {choices && <Button size="icon-sm" variant="outline" aria-label="다음 기록 월" disabled={busy || index >= choices.length - 1} onClick={() => move(choices[index + 1]!)}><EyIcon name="chevronRight" size={16} /></Button>}
    {busy && <span role="status" className="text-xs">불러오는 중…</span>}
  </div>;
}
