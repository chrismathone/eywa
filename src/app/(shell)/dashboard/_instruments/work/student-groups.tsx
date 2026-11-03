"use client";

import { useState } from "react";
import { assignedTo, effectiveStudents, type DraftStudent, type WorkPerson } from "@/features/work-requests/model";

const SHOWN = 10;

function Chips({ list, onRemove }: { list: DraftStudent[]; onRemove: (s: DraftStudent) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <div className="work-links">
      {shown.map((s) => <button key={`${s.id}|${s.assigneeId ?? ""}`} type="button" className="work-tag" onClick={() => onRemove(s)} aria-label={`${s.name} 빼기`}>{s.name} ×</button>)}
      {list.length > SHOWN ? <button type="button" className="picker-link" onClick={() => setAll((v) => !v)}>{all ? "접기" : `외 ${list.length - SHOWN}명 모두 보기`}</button> : null}
    </div>
  );
}

/**
 * 근거 학생을 담당자별로 — 담당자마다 맡은 학생만 본다(원장 2026-11-02 *"담당에 담당 학생이 배정되는것처럼"*).
 * 담당자 목록에서 빠진 사람의 학생은 '담당 미정'으로 보이고(그 사람을 다시 고르면 돌아온다), 미정 학생은 한 번에 누군가에게 맡길 수 있다.
 * 다른 담당자가 이미 맡은 학생은 미정에 두지 않는다(저장도 같은 규칙 — `effectiveStudents`).
 */
export function StudentGroups({ students, assignees, staff, onChange }: { students: DraftStudent[]; assignees: string[]; staff: WorkPerson[]; onChange: (next: DraftStudent[]) => void }) {
  const [target, setTarget] = useState("");
  const nameOf = new Map(staff.map((p) => [p.id, p.name]));
  const owner = (s: DraftStudent) => assignedTo(s, assignees);
  // 보이는 묶음 = 저장 · 내용과 같은 정리(같은 학생은 한 번 · 다른 담당자가 맡은 학생은 미정에 두지 않는다).
  const shown = effectiveStudents(students, assignees);
  // 칩을 빼면 그 칩이 대표하는 원래 줄을 모두 뺀다(같은 학생이 미정으로 둘이었어도 한 번에).
  const remove = (chip: DraftStudent) => onChange(students.filter((x) => !(x.id === chip.id && owner(x) === chip.assigneeId)));
  const loose = shown.filter((s) => s.assigneeId === null);
  const looseIds = new Set(loose.map((s) => s.id));
  const isLoose = (s: DraftStudent) => owner(s) === null && looseIds.has(s.id);
  const people = new Set(students.map((s) => s.id)).size;
  return (
    <fieldset>
      <legend>근거 학생 <small>{people}명 · 담당자마다 맡은 학생 · 학생 기록은 바꾸지 않습니다</small></legend>
      {assignees.map((id) => {
        const mine = shown.filter((s) => s.assigneeId === id);
        return mine.length ? <div key={id} className="student-group"><b>{nameOf.get(id) ?? "담당자"} <small>{mine.length}명</small></b><Chips list={mine} onRemove={remove} /></div> : null;
      })}
      {loose.length ? (
        <div className="student-group is-loose">
          <b>담당 미정 <small>{loose.length}명 · 근거로만 남습니다</small></b>
          <Chips list={loose} onRemove={remove} />
          {assignees.length ? (
            <div className="student-assign">
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="미정 학생을 맡을 담당자">
                <option value="">맡을 담당자 고르기</option>
                {assignees.map((id) => <option key={id} value={id}>{nameOf.get(id) ?? "담당자"}</option>)}
              </select>
              <button type="button" className="picker-link" disabled={!target} onClick={() => { onChange([...new Map(students.map((s) => (isLoose(s) ? { ...s, assigneeId: target } : s)).map((s) => [`${s.id}|${s.assigneeId ?? ""}`, s])).values()]); setTarget(""); }}>미정 학생 모두 맡기기</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
