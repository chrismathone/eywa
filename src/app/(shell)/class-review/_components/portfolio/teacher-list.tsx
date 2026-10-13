"use client";

import { useState } from "react";
import { HrefSelect } from "@/components/href-select";
import { TOOLBAR_SEARCH_BOX } from "@/components/toolbar-controls";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { metricOf, type StoredPeriod } from "@/features/teacher-portfolio/model/types";
import type { PortfolioTeacherEntry } from "@/features/teacher-portfolio/server/queries";

/**
 * 강사 목록 — 선택한 강사를 맨 위 카드에 한 번만 보이고(이름은 여기에만 선다), 나머지는 과목별로 묶는다.
 * 목록 자체는 스크롤하지 않는다. 본문과 높이를 맞추고 남는 높이는 줄들이 나눠 갖는다.
 */
type Props = {
  teachers: readonly PortfolioTeacherEntry[];
  selectedId: string;
  month: string;
  period: StoredPeriod;
  hrefOf: (teacherId: string) => string;
  onSelect: (teacherId: string) => void;
};

function useGrouping(month: string) {
  const subjects = useSubjectMaps();
  const order = subjects.options.map((o) => o.value);
  const rank = (key: string) => { const i = order.indexOf(key); return i < 0 ? order.length : i; };
  /** 그 달에 수업한 과목 → 없으면 직원 정보의 과목 → 없으면 다른 달의 과목. */
  const keysOf = (t: PortfolioTeacherEntry) => {
    const here = t.months[month]?.subjects ?? [];
    const other = Object.values(t.months).find((m) => m.subjects.length)?.subjects ?? [];
    return [...new Set(here.length ? here : t.subjects.length ? t.subjects : other)].sort((a, b) => rank(a) - rank(b));
  };
  const labelOf = (t: PortfolioTeacherEntry) => keysOf(t).map(subjects.labelOf).join(" · ") || "미분류";
  const groups = (list: readonly PortfolioTeacherEntry[]) => {
    const map = new Map<string, { rank: number; teachers: PortfolioTeacherEntry[] }>();
    for (const t of list) {
      const label = labelOf(t);
      const group = map.get(label) ?? map.set(label, { rank: rank(keysOf(t)[0] ?? ""), teachers: [] }).get(label)!;
      group.teachers.push(t);
    }
    return [...map].sort(([a, x], [b, y]) => x.rank - y.rank || a.localeCompare(b, "ko"));
  };
  return { labelOf, groups };
}

function facts(period: StoredPeriod): [string, string][] {
  if (!period.classes.length) return [["담당 반", "해당 월 수업 없음"]];
  const t = metricOf(period, "students").tracking;
  return [["담당 학생", `${period.students}명`], ["담임 · 부담임", `${t.homeroom}명 · ${t.assistant}명`], ["담당 반", `${period.classes.length}개`]];
}

export function TeacherList({ teachers, selectedId, month, period, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const { labelOf, groups } = useGrouping(month);
  const selected = teachers.find((t) => t.id === selectedId);
  const query = search.trim().toLowerCase();
  const rest = teachers.filter((t) => t.id !== selectedId && t.name.toLowerCase().includes(query));
  const filling = !query; // 검색 중에는 줄을 늘리지 않는다 — 한 줄이 목록 전체 높이로 커진다.
  return (
    <aside className="bg-card shadow-card desk:flex hidden min-w-0 flex-col rounded-2xl p-2.5">
      <div className="flex items-center justify-between gap-2 px-1.5 pb-2.5">
        <h3 className="text-base font-bold">강사</h3>
        <span className="num text-xs">{teachers.length}명</span>
      </div>
      <label className={`${TOOLBAR_SEARCH_BOX} relative mb-3`}>
        <EyIcon name="search" size={16} />
        <span className="sr-only">강사 검색</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름 검색" autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent leading-normal outline-none" />
      </label>
      <nav aria-label="강사 선택" className="flex min-h-0 flex-1 flex-col gap-3">
        {selected ? (
          <section>
            <h4 className="px-2.5 pb-1.5 text-xs font-bold">선택한 강사</h4>
            <div data-selected-teacher className="border-primary/30 bg-primary-soft rounded-lg border">
              <p className="px-2.5 pt-2.5 pb-2">
                <b className="text-base">{selected.name}</b> <span className="text-xs font-medium">선생님</span>
                <span className="mt-0.5 block text-xs">{labelOf(selected)}</span>
              </p>
              <dl className="border-primary/15 grid gap-1.5 border-t px-2.5 py-2.5 text-xs">
                {facts(period).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2"><dt>{k}</dt><dd className="num font-bold whitespace-nowrap">{v}</dd></div>
                ))}
              </dl>
            </div>
          </section>
        ) : null}
        {groups(rest).map(([label, group]) => (
          <section key={label} aria-label={`${label} 강사`} className="border-line-faint flex flex-col border-t pt-1" style={filling ? { flex: `${group.teachers.length} 1 auto` } : undefined}>
            <h4 className="flex items-center justify-between px-2.5 py-1.5 text-xs font-bold">
              <span>{label}</span>
              <span className="num font-medium">{group.teachers.length}명</span>
            </h4>
            {group.teachers.map((t) => {
              const at = t.months[month];
              return (
                <button key={t.id} type="button" data-teacher={t.id} onClick={() => onSelect(t.id)}
                  className={`hover:bg-primary-softer focus-visible:outline-primary flex w-full flex-col justify-center rounded-lg px-2.5 py-2 text-left focus-visible:outline-2 ${filling ? "max-h-24 flex-1" : ""}`}>
                  <b className="text-sm">{t.name}</b>
                  <span className="num text-xs">{at?.classCount ? `합계 항목 ${at.knownCount}개` : "해당 월 수업 없음"}</span>
                </button>
              );
            })}
          </section>
        ))}
        {!rest.length && query ? <p className="px-2.5 py-6 text-center text-xs">검색 결과가 없습니다.</p> : null}
      </nav>
    </aside>
  );
}

/** 강사 목록이 숨는 좁은 화면 — 과목별 선택창과 한 줄 요약. */
export function TeacherPicker({ teachers, selectedId, month, period, hrefOf }: Props) {
  const { labelOf, groups } = useGrouping(month);
  const selected = teachers.find((t) => t.id === selectedId);
  const summary = facts(period).map(([k, v]) => `${k} ${v}`).join(" · ");
  return (
    <div className="desk:hidden flex flex-col gap-1.5">
      <HrefSelect axisLabel="강사" ariaLabel="강사 선택" value={selectedId}
        options={groups(teachers).flatMap(([label, group]) => group.teachers.map((t) => ({ value: t.id, label: `${t.name} 선생님`, hint: label, href: hrefOf(t.id) })))} />
      {selected ? <p className="text-xs">{labelOf(selected)} · {summary}</p> : null}
    </div>
  );
}
