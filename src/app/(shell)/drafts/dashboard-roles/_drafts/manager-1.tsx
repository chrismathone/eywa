"use client";

/** 실장(매니저) 시안 1 — 할 일 중심 "오늘 체크리스트". 오늘 내 과목 출결·보고서·보강 확인을 체크 목록으로. */
import { useState } from "react";
import { Panel, ToneBadge } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

export function Manager1({ subject }: DraftProps) {
  const f = subjectFake(subject);
  const items = [
    ...f.classes.slice(0, 4).map((c) => ({ id: `att-${c.name}`, group: "출결 확인", text: `${c.time} ${c.name} — ${c.students}명`, tone: "info" as const })),
    ...f.classes
      .filter((c) => c.reportsDone < c.reportsDue)
      .map((c) => ({ id: `rep-${c.name}`, group: "보고서", text: `${c.name} · ${c.teacher} 선생님 ${c.reportsDue - c.reportsDone}명 남음`, tone: "critical" as const })),
    ...f.absences
      .filter((a) => a.makeup === "보강 미정")
      .map((a) => ({ id: `mk-${a.name}`, group: "보강", text: `${a.name} · ${a.className} 보강 잡기`, tone: "special" as const })),
  ];
  const [done, setDone] = useState<Set<string>>(() => new Set(items.slice(0, 2).map((i) => i.id)));
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Panel title="오늘 할 일" count={`${items.length}개 중 ${done.size}개 끝`}>
      <div className="bg-bg-soft mb-3 h-2 overflow-hidden rounded-full">
        <div className="bg-green h-full rounded-full" style={{ width: `${(done.size / Math.max(1, items.length)) * 100}%` }} />
      </div>
      <ul className="flex flex-col">
        {items.map((it) => (
          <li key={it.id} className="border-line border-t first:border-t-0">
            <label className="flex cursor-pointer items-center gap-3 py-2">
              <input type="checkbox" checked={done.has(it.id)} onChange={() => toggle(it.id)} className="accent-primary size-5 shrink-0" />
              <span className={`min-w-0 flex-1 truncate text-sm ${done.has(it.id) ? "line-through" : "font-bold"}`}>{it.text}</span>
              <ToneBadge tone={done.has(it.id) ? "positive" : it.tone}>{done.has(it.id) ? "끝" : it.group}</ToneBadge>
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
