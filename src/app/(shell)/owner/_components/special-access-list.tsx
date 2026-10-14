"use client";

import { useState } from "react";

type StaffOption = { id: string; name: string; role: string };

/** 사람별 기능 지정 한 칸. 숨긴 계정은 표시하지 않고 명단에는 그대로 보존한다. */
export function SpecialAccessList({ label, hint, ids, hiddenUserIds, staffOptions, nameOf, onChange }: {
  label: string;
  hint: string;
  ids: readonly string[];
  hiddenUserIds: readonly string[];
  staffOptions: readonly StaffOption[];
  nameOf: (id: string) => string;
  onChange: (update: (ids: string[]) => string[]) => void;
}) {
  const [picked, setPicked] = useState("");
  const shown = ids.filter((id) => !hiddenUserIds.includes(id));
  return <div className="space-y-2">
    <div><p className="text-xs font-bold">{label}</p><p className="text-text-dim text-xs">{hint}</p></div>
    <div className="flex flex-wrap gap-2">
      <select aria-label={`${label} 담당자 선택`} value={picked} onChange={(e) => setPicked(e.target.value)} className="border-border bg-card rounded border px-2 py-1.5 text-xs">
        <option value="">직원 선택</option>
        {staffOptions.filter((s) => !ids.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button type="button" aria-label={`${label} 담당자 추가`} disabled={!picked || ids.length >= 80}
        className="border-border bg-card rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-40"
        onClick={() => { if (!picked) return; onChange((prev) => prev.includes(picked) || prev.length >= 80 ? prev : [...prev, picked]); setPicked(""); }}>담당자 추가</button>
    </div>
    <div className="flex flex-wrap gap-2">
      {shown.length ? shown.map((id) => <span key={id} className="border-border bg-card inline-flex items-center gap-1 rounded border px-2 py-1 text-xs">
        {nameOf(id)} <button type="button" aria-label={`${nameOf(id)} ${label} 해제`} title="해제"
          className="text-text-dim hover:text-danger leading-none" onClick={() => onChange((prev) => prev.filter((v) => v !== id))}>×</button>
      </span>) : <span className="text-text-dim text-xs">지정된 직원 없음</span>}
    </div>
  </div>;
}
