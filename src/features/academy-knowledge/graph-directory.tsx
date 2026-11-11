"use client";
import { entities } from "./catalog";
import type { Node } from "./graph";
import s from "./studio.module.css";

const labels: Record<string, string> = Object.fromEntries(entities);

/** 지식그래프 왼쪽 목록 — 주체 고르기 · 이름 검색 · 기록 목록(최대 80줄). 줄을 누르면 그 기록을 고른다(판에 없으면 그 기록이 가운데). */
export function GraphDirectory({ nodes, type, search, selected, onType, onSearch, onPick }: { nodes: Node[]; type: string; search: string; selected: string; onType: (t: string) => void; onSearch: (q: string) => void; onPick: (id: string) => void }) {
  const q = search.toLowerCase();
  const matches = nodes.filter((n) => n.type === type && `${n.label} ${n.id}`.toLowerCase().includes(q));
  return (
    <aside className={s.directory}>
      <label>
        주체
        <select value={type} onChange={(e) => onType(e.target.value)}>
          {entities.map(([id, label]) => (
            <option key={id} value={id}>
              {label} ({nodes.filter((n) => n.type === id).length})
            </option>
          ))}
        </select>
      </label>
      <label>
        이름·기록 검색
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="학생·강사·행사·목표" />
      </label>
      <div className={s.list}>
        {matches.slice(0, 80).map((n) => (
          <button aria-pressed={selected === n.id} key={n.id} onClick={() => onPick(n.id)}>
            <strong>{n.label}</strong>
            <small>{labels[n.type]}</small>
          </button>
        ))}
      </div>
      <small>
        {Math.min(80, matches.length)} / {matches.length}개 · 검색으로 좁혀 보세요
      </small>
    </aside>
  );
}
