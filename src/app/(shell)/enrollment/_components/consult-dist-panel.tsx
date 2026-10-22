"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { SchoolBar } from "@/features/enrollment/consultation-dist";
import { SMALL_SCHOOLS_KEY, summarizeSchoolBars } from "@/features/enrollment/consultation-dist";
import { CompactStatsList } from "./compact-stats-list";
import {
  SCHOOL_KINDS,
  SORT_KEYS,
  type SchoolKind,
  type SchoolStatsPrefs,
  type SortKey,
} from "@/features/enrollment/school-view-prefs";
import { saveSchoolStatsPrefs } from "@/features/enrollment/server/school-prefs-actions";

const KIND_COLOR: Record<string, string> = {
  초: "var(--color-blue)",
  중: "var(--color-primary)",
  고: "var(--color-chart-2)",
};

const chip = (on: boolean) =>
  `rounded-full px-2.5 py-1 text-xs transition ${
    on ? "bg-foreground text-background font-medium" : "text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

/**
 * 이름이 이미 학교급을 말하는가(`인지초`·`봉무초등학교`·`계성중학교`) — 그러면 급 배지를 겹쳐 적지 않는다
 * (원장 2026-09-12 *"초 중 고 가 이중으로 표시됨"*). `국제학교`처럼 이름만으론 급을 알 수 없는 학교는 배지를 남긴다.
 */
function nameSaysKind(label: string, kind: string): boolean {
  return label.replace(/\s*(등)?학교\s*$/, "").trimEnd().endsWith(kind);
}

/**
 * 학교별 **상담** 분포 — 건수·등록 전환율, 그리고 공시 연도일 때만 전교생 대비 비율.
 *
 * 🔴 재원생/퇴원생 축은 여기 없다(원장 2026-08-05: 그건 학생목록에서 할 일). 이 화면의 대분류는
 * 등록상담이라 세는 대상도 상담이어야 하고, 그래야 위의 연도 선택이 이 카드에도 적용된다.
 */
export function ConsultDistPanel({
  rows,
  initial,
  year,
  hasTotals,
  totalsYear,
}: {
  rows: SchoolBar[];
  initial: SchoolStatsPrefs;
  year: number | null;
  hasTotals: boolean;
  totalsYear: number | null;
}) {
  const [prefs, setPrefs] = useState<SchoolStatsPrefs>(initial);
  const [showSmallSchools, setShowSmallSchools] = useState(false);
  const smallSchoolsId = useId();
  const [, startTransition] = useTransition();
  const sortBy = hasTotals ? prefs.sortBy : "count";

  const update = (patch: Partial<SchoolStatsPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    startTransition(() => {
      void saveSchoolStatsPrefs(next);
    });
  };

  const { view, smallSchools, schoolCount } = useMemo(() => {
    const kinds = prefs.kinds;
    const filtered = rows.filter((r) => !kinds || (r.kind && kinds.includes(r.kind)));
    const grouped = summarizeSchoolBars(filtered);
    const dir = prefs.sortDir === "asc" ? 1 : -1;
    const view = grouped.rows.sort((a, b) => {
      if (a.key === SMALL_SCHOOLS_KEY) return 1;
      if (b.key === SMALL_SCHOOLS_KEY) return -1;
      if (sortBy === "pct") {
        // 전교생 미상은 방향과 무관하게 끝 — 0으로 취급하면 "비율 0%"로 읽힌다.
        if (a.rate === null && b.rate === null) return (a.n - b.n) * dir;
        if (a.rate === null) return 1;
        if (b.rate === null) return -1;
        if (a.rate !== b.rate) return (a.rate - b.rate) * dir;
      }
      if (a.n !== b.n) return (a.n - b.n) * dir;
      return a.label.localeCompare(b.label, "ko");
    });
    return { view, smallSchools: grouped.smallSchools, schoolCount: filtered.length };
  }, [rows, prefs, sortBy]);

  const max = Math.max(1, ...view.map((r) => (sortBy === "pct" ? (r.rate ?? 0) : r.n)));
  const totalN = view.reduce((a, r) => a + r.n, 0);
  const totalE = view.reduce((a, r) => a + r.enrolled, 0);

  const toggleKind = (k: SchoolKind) => {
    const cur = prefs.kinds ?? [...SCHOOL_KINDS];
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    update({ kinds: next.length === 0 || next.length === SCHOOL_KINDS.length ? null : next });
  };

  // 공시가 다른 해 것이면 '점유율' 정렬은 고를 수 없다 — 없는 값으로 정렬하게 두면 순서가 무의미해진다.
  const sortKeys = hasTotals ? SORT_KEYS : (["count"] as const);

  return (
    <section className="bg-card shadow-card flex min-w-0 flex-col rounded-2xl p-4">
      <header className="mb-3">
        <h2 className="text-foreground text-sm font-bold">학교별 상담</h2>
        <p className="text-text-dim mt-0.5 text-xs">
          {year === null ? "전체 기간" : `${year}년`} 상담 {totalN}건 · 등록 {totalE}건 · {schoolCount}개 학교·분류
          {hasTotals
            ? ` · 전교생 대비 비율은 ${totalsYear}년 공시 기준`
            : year === null
              ? " · 전체 기간은 전교생 대비 비율 미제공"
              : ` · ${year}년 전교생 자료 없음`}
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="micro shrink-0">학교급</span>
          <div className="border-line inline-flex items-center gap-0.5 rounded-full border p-0.5">
            <button type="button" onClick={() => update({ kinds: null })} className={chip(prefs.kinds === null)}>
              전체
            </button>
            {SCHOOL_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={chip(prefs.kinds !== null && prefs.kinds.includes(k))}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="micro shrink-0">정렬</span>
          <div className="border-line inline-flex items-center gap-0.5 rounded-full border p-0.5">
            {sortKeys.map((s: SortKey) => (
              <button
                key={s}
                type="button"
                onClick={() => update({ sortBy: s })}
                className={chip(sortBy === s)}
              >
                {s === "pct" ? "전교생 대비" : "상담 건수"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => update({ sortDir: prefs.sortDir === "desc" ? "asc" : "desc" })}
            className="border-line hover:bg-bg-soft text-text-dim inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
            aria-label={prefs.sortDir === "desc" ? "내림차순 — 클릭하면 오름차순" : "오름차순 — 클릭하면 내림차순"}
          >
            <EyIcon name={prefs.sortDir === "desc" ? "arrowDown" : "arrowUp"} size={12} strokeWidth={1.8} />
            {prefs.sortDir === "desc" ? "내림" : "오름"}
          </button>
        </div>
      </div>

      {view.length === 0 ? (
        <p className="text-text-dim py-6 text-center text-sm">이 조건에 해당하는 학교가 없습니다</p>
      ) : (
        <CompactStatsList label="학교별 상담 분포" keepLast={smallSchools.length > 0}>
          {view.map((s) => {
            const v = sortBy === "pct" ? (s.rate ?? 0) : s.n;
            const conv = s.n > 0 ? Math.round((s.enrolled / s.n) * 100) : null;
            return (
              <li key={s.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  {/* 라벨은 짧은 표기 하나로 통일(병행표기 금지) — 공시 정식명은 툴팁으로만 남긴다. */}
                  <span className="text-foreground min-w-0 font-medium break-words" title={s.officialName ?? undefined}>
                    {s.key === SMALL_SCHOOLS_KEY ? (
                      <button type="button" className="text-primary inline-flex items-center gap-1 text-left hover:underline" aria-expanded={showSmallSchools} aria-controls={smallSchoolsId} onClick={() => setShowSmallSchools((value) => !value)}>
                        {s.label} · {smallSchools.length}곳
                        <EyIcon name="chevronDown" size={12} />
                      </button>
                    ) : s.label}
                    {s.kind && !nameSaysKind(s.label, s.kind) ? (
                      <span className="text-text-faint ml-1.5 text-xs">{s.kind}</span>
                    ) : null}
                  </span>
                  <span className="text-text-dim num min-w-0 text-xs">
                    {s.n}건 · 등록 {s.enrolled}
                    {conv !== null ? <b className="text-foreground ml-1.5 text-sm">{conv}%</b> : null}
                    {s.rate !== null ? (
                      <span className="text-text-faint ml-1.5">(전교생 {s.total?.toLocaleString("ko-KR")}명 중 {s.rate}%)</span>
                    ) : null}
                  </span>
                </div>
                <div className="bg-bg-soft mt-1 h-2 overflow-hidden rounded-full">
                  <div
                    className="bar-grow h-full rounded-full"
                    style={{
                      width: `${(v / max) * 100}%`,
                      background: KIND_COLOR[s.kind ?? ""] ?? "var(--color-neutral-fill)",
                    }}
                  />
                </div>
                {s.key === SMALL_SCHOOLS_KEY && showSmallSchools ? (
                  <ul id={smallSchoolsId} className="border-line mt-2 space-y-1 border-l pl-3 text-xs" aria-label="2건 이하 학교 내역">
                    {smallSchools.map((school) => (
                      <li key={school.key} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                        <span>{school.label}</span>
                        <span className="num">{school.n}건 · 등록 {school.enrolled}건</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </CompactStatsList>
      )}
      <p className="text-text-faint mt-2 text-xs">
        굵은 %는 그 학교에서 온 상담의 등록 전환율입니다 · 막대는{" "}
        {sortBy === "pct" ? "전교생 대비 비율" : "상담 건수"} 기준
      </p>
      {smallSchools.length > 0 ? <p className="text-text-faint mt-1 text-xs">상담 2건 이하 학교는 기타로 합산했습니다. 기타를 누르면 학교별 내역을 볼 수 있습니다.</p> : null}
    </section>
  );
}
