"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { WorkPerson } from "@/features/work-requests/model";

const MANAGERS = new Set(["원장", "관리자", "매니저"]);
type Group = { key: string; label: string; people: WorkPerson[] };

/** 묶음 — 추천(근거 학생의 담임) · 관리자 · 과목별 강사 · 과목 없는 강사 · 그 밖. 두 과목 강사는 두 묶음에 다 선다(같은 칸이 같이 바뀐다). */
function groupsOf(staff: readonly WorkPerson[], suggested: readonly string[]): Group[] {
  const byName = (a: WorkPerson, b: WorkPerson) => a.name.localeCompare(b.name, "ko");
  const teachers = staff.filter((p) => p.role === "강사");
  const subjects = [...new Set(teachers.flatMap((p) => p.subjects ?? []))].sort((a, b) => a.localeCompare(b, "ko"));
  const groups: Group[] = [
    { key: "suggested", label: "추천 · 근거 학생의 담임", people: staff.filter((p) => suggested.includes(p.id)).sort(byName) },
    { key: "managers", label: "관리자", people: staff.filter((p) => MANAGERS.has(p.role)).sort(byName) },
    ...subjects.map((s) => ({ key: `subject:${s}`, label: `${s} 강사`, people: teachers.filter((p) => p.subjects?.includes(s)).sort(byName) })),
    { key: "teachers", label: "과목 없는 강사", people: teachers.filter((p) => !p.subjects?.length).sort(byName) },
    { key: "others", label: "그 밖", people: staff.filter((p) => !MANAGERS.has(p.role) && p.role !== "강사").sort(byName) },
  ];
  return groups.filter((g) => g.people.length);
}

const Person = ({ p, on, toggle }: { p: WorkPerson; on: boolean; toggle: (id: string) => void }) => (
  <label className={on ? "is-on" : undefined}><input type="checkbox" checked={on} onChange={() => toggle(p.id)} />{p.name}<small>{p.subjects?.length ? p.subjects.join("·") : p.role}</small></label>
);

/** 담당자 고르기 — 이름 검색 · 고른 사람 칩 · 묶음마다 모두 선택. 고른 사람이 있는 묶음과 추천은 펼쳐 둔다. */
export function AssigneePicker({ staff, selected, suggested, onChange }: { staff: WorkPerson[]; selected: string[]; suggested: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupsOf(staff, suggested), [staff, suggested]);
  const chosen = new Set(selected);
  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const setMany = (ids: string[], on: boolean) => onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((x) => !ids.includes(x)));
  const q = query.trim();
  const found = q ? staff.filter((p) => p.name.includes(q) || p.role.includes(q) || p.subjects?.some((s) => s.includes(q))) : [];
  const nameOf = new Map(staff.map((p) => [p.id, p.name]));
  return (
    <div className="picker">
      <div className="picker-top">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 과목으로 찾기" aria-label="담당자 찾기" />
        <span className="picker-count">고른 사람 <b>{selected.length}</b>명</span>
        {selected.length ? <button type="button" className="picker-link" onClick={() => onChange([])}>모두 해제</button> : null}
      </div>
      {selected.length ? (
        <div className="picker-chips">{selected.map((id) => <button key={id} type="button" className="work-tag is-on" onClick={() => toggle(id)} aria-label={`${nameOf.get(id) ?? "담당자"} 빼기`}>{nameOf.get(id) ?? "담당자"} ×</button>)}</div>
      ) : <p className="drawer-note">담당자를 한 명 이상 골라 주세요.</p>}
      {q ? (
        <div className="picker-list">{found.length ? found.map((p) => <Person key={p.id} p={p} on={chosen.has(p.id)} toggle={toggle} />) : <p className="drawer-note">맞는 직원이 없습니다.</p>}</div>
      ) : groups.map((g) => {
        const ids = g.people.map((p) => p.id);
        const n = ids.filter((id) => chosen.has(id)).length;
        const all = n === ids.length;
        const onAll = (e: MouseEvent) => { e.preventDefault(); setMany(ids, !all); };
        return (
          <details key={g.key} className="picker-group" open={g.key === "suggested" || n > 0}>
            <summary><b>{g.label}</b><small>{n ? `${n} / ${ids.length}명` : `${ids.length}명`}</small><button type="button" className="picker-link" onClick={onAll}>{all ? "모두 해제" : "모두 선택"}</button></summary>
            <div className="picker-list">{g.people.map((p) => <Person key={p.id} p={p} on={chosen.has(p.id)} toggle={toggle} />)}</div>
          </details>
        );
      })}
    </div>
  );
}
