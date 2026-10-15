"use client";

import { useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { PermissionsSettings } from "@/features/owner/settings-types";

type Scope = PermissionsSettings["specialAccess"]["staffSubjectScopes"][number];
type StaffOption = { id: string; name: string; role: string };
const MAX_PEOPLE = 80;
/** 범위에 남아 있지만 학원 설정에서 없어진 과목 — 내부 키를 그대로 보이지 않는다. */
const GONE = "(없어진 과목)";

/**
 * 직원관리 과목 범위 — 이 사람은 직원관리에서 **고른 과목의 선생님만** 본다(목록 · 상세 · 근무 설정 · 이력서 · 계약 전부,
 * `features/staff/department/server/subject-scope.ts`). 직원관리를 여는 것은 메뉴 권한이고, 여기는 연 뒤에 보이는 범위만 정한다.
 *
 * 과목 선택지는 학원 설정의 과목이다(`useSubjectMaps` — 코드에 과목을 적지 않는다).
 * 🔴 화면에 안 보이는 사람(`hiddenUserIds`)의 줄은 손대지 않고 그대로 둔다.
 */
export function StaffScopeEditor({ scopes, hiddenUserIds, staffOptions, nameOf, onChange }: {
  /** 저장되는 줄 전부(안 보이는 줄 포함). `staffOptions`는 고를 수 있는 사람만 온다(원장 역할 · 안 보이는 계정 제외). */
  scopes: readonly Scope[];
  hiddenUserIds: readonly string[];
  staffOptions: readonly StaffOption[];
  nameOf: (userId: string) => string;
  onChange: (next: (rows: Scope[]) => Scope[]) => void;
}) {
  const { options } = useSubjectMaps();
  const [picked, setPicked] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const hidden = new Set(hiddenUserIds);
  const shown = scopes.filter((row) => !hidden.has(row.userId));
  const labelOf = (key: string) => options.find((o) => o.value === key)?.label ?? GONE;
  const full = scopes.length >= MAX_PEOPLE && !scopes.some((row) => row.userId === picked);
  const blocked = !picked || subjects.length === 0 || full;
  // 과목 조합별 묶음 — 학원 설정의 과목 차례(첫 과목 → 과목 수)로 세운다. 없어진 과목만 남은 범위는 맨 뒤 한 묶음.
  const order = new Map(options.map((o, i) => [o.value, i]));
  const groups = (() => {
    const map = new Map<string, { label: string; rank: number; rows: Scope[] }>();
    for (const row of shown) {
      const all = Array.isArray(row.subjects) ? row.subjects : [];
      const keys = all.filter((key) => order.has(key)).sort((a, b) => order.get(a)! - order.get(b)!);
      // 없어진 과목이 섞인 범위는 따로 묶는다 — 내부 키는 보이지 않고 '(없어진 과목)'으로만.
      const label = [...keys.map(labelOf), ...(keys.length < all.length || all.length === 0 ? [GONE] : [])].join(" · ");
      const rank = keys.length ? order.get(keys[0]!)! * 100 + keys.length : Number.MAX_SAFE_INTEGER;
      (map.get(label) ?? map.set(label, { label, rank, rows: [] }).get(label)!).rows.push(row);
    }
    return [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "ko"));
  })();

  // 이미 범위가 있는 사람을 고르면 그 범위에서 시작한다 — 빈 칸에서 시작하면 과목 하나를 더하려다 기존 범위를 갈아끼운다.
  // 고르는 순간 칸이 그 사람의 범위로 다시 잡히므로, 직원을 고르기 전에는 과목을 체크할 수 없다(먼저 체크한 것이 사라지지 않게).
  function pick(id: string) {
    setPicked(id);
    const current = scopes.find((row) => row.userId === id);
    const known = new Set(options.map((o) => o.value));
    setSubjects(current && Array.isArray(current.subjects) ? current.subjects.filter((key) => known.has(key)) : []);
  }

  function apply() {
    if (blocked) return;
    // 학원 설정의 과목 차례로 싣는다(누른 차례가 아니라) — 같은 범위는 늘 같은 값으로 저장된다.
    const ordered = options.map((o) => o.value).filter((key) => subjects.includes(key));
    onChange((rows) => [...rows.filter((row) => row.userId !== picked), { userId: picked, subjects: ordered }]);
    setPicked("");
    setSubjects([]);
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-bold">직원관리 과목 범위</p>
        <p className="text-text-dim text-xs">
          지정한 사람은 직원관리에서 고른 과목의 선생님만 봅니다. 직원관리 메뉴 권한은 따로 줍니다. 지정하지 않은 사람과 원장은 전체를 봅니다.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="과목 범위를 지정할 직원" value={picked} onChange={(e) => pick(e.target.value)} className="border-border bg-card rounded border px-2 py-1.5 text-xs">
          <option value="">직원 선택</option>
          {staffOptions.filter((s) => !hidden.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {options.map((o) => (
          <label key={o.value} className="border-border bg-card inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs">
            <input
              type="checkbox"
              disabled={!picked}
              checked={subjects.includes(o.value)}
              onChange={(e) => setSubjects((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((key) => key !== o.value)))}
            />
            {o.label}
          </label>
        ))}
        <button type="button" onClick={apply} disabled={blocked} className="border-border bg-card rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-40">
          범위 지정
        </button>
        {full ? <span className="text-text-dim text-xs">과목 범위는 {MAX_PEOPLE}명까지 둘 수 있습니다.</span> : null}
      </div>
      {shown.length === 0 ? (
        <p className="text-text-dim text-xs">범위가 지정된 직원 없음</p>
      ) : (
        // 과목(조합)별로 묶어 '연차 조정'과 같은 칩으로 가로 나열한다(원장 2026-10-07 *"연차조정처럼 리스트 버튼식으로"* · *"과목별로 그룹화해서"*).
        // 한 사람은 한 칩이다 — ×는 그 사람의 범위 전체를 푼다(여러 과목을 보는 사람은 '수학 · 영어' 묶음에 선다).
        <ul className="space-y-1.5">
          {groups.map((group) => (
            <li key={group.label} className="flex flex-wrap items-center gap-2">
              <span className="text-text-dim min-w-12 text-xs font-bold">{group.label}</span>
              {group.rows.map((row) => {
                const name = nameOf(row.userId);
                return (
                  <span key={row.userId} className="border-border bg-card inline-flex items-center gap-1 rounded border px-2 py-1 text-xs whitespace-nowrap">
                    {name}{" "}
                    <button
                      type="button"
                      aria-label={`${name} 직원관리 과목 범위 해제`}
                      title="해제"
                      onClick={() => onChange((rows) => rows.filter((r) => r.userId !== row.userId))}
                      className="text-text-dim hover:text-danger leading-none"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
