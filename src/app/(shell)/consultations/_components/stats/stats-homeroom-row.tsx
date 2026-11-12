"use client";

import type { ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { pct } from "@/features/consultations/stats-model";
import { EyIcon } from "@/components/icons/aywa-icons";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const rateText = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
/** 줄 안에 바로 적는 미상담 학생 수 — 넘치면 '외 N명'(전체는 마우스 오버 · 줄을 펼치면 표). */
const INLINE_NAMES = 10;

/** 퇴원 수 — 0이면 '—', 이름은 마우스 오버. */
function NamesCount({ list }: { list: readonly { name: string }[] }) {
  return (
    <td className="num px-2 py-1.5 text-center" title={list.map((s) => s.name).join(", ")}>
      {list.length > 0 ? <span className="font-bold">{fmt(list.length)}명</span> : <span className="text-muted-foreground">—</span>}
    </td>
  );
}

/** 정렬되는 열 머리 — 누르면 그 열로, 한 번 더 누르면 방향이 뒤집힌다(homeroom-sort.ts). */
export function SortHead({ label, active, dir, onClick }: { label: ReactNode; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <th className="px-2 py-1.5 text-center font-medium whitespace-nowrap" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={onClick} className={`hover:text-foreground inline-flex items-center gap-0.5 ${active ? "text-foreground font-bold" : ""}`}>
        {label}
        <span aria-hidden="true" className={active ? "inline-flex" : "opacity-30"}>{active ? <EyIcon name={dir === "asc" ? "chevronUp" : "chevronDown"} size={12} /> : "↕"}</span>
      </button>
    </th>
  );
}

/**
 * 담임 한 줄 — 달별 '담임이 상담한 학생 / 대상' + 이번 달 미상담 수 · 담임 아닌 직원이 상담한 수 · **미상담 학생 이름**
 * (원장 2026-10-27 *"나머지는 학생 이름이나 이런 것들 해서 보이는 방향"* — 펼치지 않아도 누구를 챙길지 줄에서 바로 읽힌다).
 */
export function HomeroomTeacherRow({ t, open, onToggle }: { t: HomeroomTeacher; open: boolean; onToggle: () => void }) {
  const subjects = useSubjectMaps();
  const last = t.months.length - 1;
  const now = t.months[last]!;
  const unmet = t.students.filter((s) => s.cells[last] === "none").map((s) => s.name);
  return (
    <tr className="border-line hover:bg-bg-soft cursor-pointer border-b align-top" onClick={onToggle} aria-expanded={open}>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <button type="button" className="text-foreground font-bold" title={t.classNames.join(", ")}>
          <span aria-hidden="true" className="text-muted-foreground mr-1 text-xs">{open ? "▾" : "▸"}</span>
          {t.name}
        </button>
      </td>
      <td className="px-2 py-1.5 text-center whitespace-nowrap">
        <span className="inline-flex gap-1">
          {t.subjects.map((k) => (
            <Pill key={k} color={subjects.colorOf(k)}>
              {subjects.labelOf(k)}
            </Pill>
          ))}
        </span>
      </td>
      <td className="num text-muted-foreground px-2 py-1.5 text-center">{fmt(t.prev.students)}</td>
      <td className="num px-2 py-1.5 text-center">{fmt(t.students.length)}</td>
      <NamesCount list={t.prev.withdrawn} />
      {t.months.map((m, i) => (
        <td key={i} className="px-2 py-1.5 text-center whitespace-nowrap" title={`담임 상담 ${m.self} · 담임 아닌 직원이 상담 ${m.other} · 미상담 ${m.none}`}>
          <span className="num text-foreground font-medium">
            {m.self}/{m.target}
          </span>
          <span className="num text-muted-foreground ml-1 text-xs">{rateText(pct(m.self, m.target))}</span>
        </td>
      ))}
      <td className="px-2 py-1.5 text-center">
        <span className={`num font-bold ${now.none > 0 ? "text-danger" : "text-muted-foreground"}`}>{fmt(now.none)}명</span>
      </td>
      <td className="num text-muted-foreground px-2 py-1.5 text-center">{now.other > 0 ? `${fmt(now.other)}명` : "—"}</td>
      <td className="text-foreground w-[26rem] min-w-[16rem] px-2 py-1.5 text-xs break-keep whitespace-normal" title={unmet.join(", ")}>
        {unmet.length === 0 ? (
          <span className="text-muted-foreground">없음</span>
        ) : (
          <>
            {unmet.slice(0, INLINE_NAMES).join(" · ")}
            {unmet.length > INLINE_NAMES ? <span className="text-muted-foreground"> 외 {unmet.length - INLINE_NAMES}명</span> : null}
          </>
        )}
      </td>
    </tr>
  );
}
