"use client";

import { useMemo, useState, useTransition } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  applySchoolPrefs,
  BASES,
  BASIS_LABEL,
  SCHOOL_KINDS,
  SORT_KEYS,
  SORT_LABEL,
  type Basis,
  type SchoolKind,
  type SchoolRow,
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
 * 학교별 점유율 — 기준(재원/퇴원/예비/전체) · 급 필터 · 정렬을 화면에서 바꾼다.
 *
 * 정렬·필터는 클라 state로 즉시 반영하고(학교 40여 개라 왕복이 아깝다), **계정에도 저장**한다
 * (원장 2026-08-04 상시 지시: 모든 뷰 세팅은 계정 귀속 — localStorage는 포트 단위라 조용히 리셋된다).
 * 저장 실패는 화면을 막지 않는다 — 다음 방문 때 기본값으로 열릴 뿐이라 지금 보는 걸 방해할 이유가 없다.
 */
export function SchoolPenetrationPanel({
  rows,
  initial,
}: {
  rows: SchoolRow[];
  initial: SchoolStatsPrefs;
}) {
  const [prefs, setPrefs] = useState<SchoolStatsPrefs>(initial);
  const [, startTransition] = useTransition();

  const update = (patch: Partial<SchoolStatsPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    startTransition(() => {
      void saveSchoolStatsPrefs(next);
    });
  };

  const view = useMemo(() => applySchoolPrefs(rows, prefs), [rows, prefs]);
  const max = Math.max(1, ...view.map((r) => (prefs.sortBy === "pct" ? (r.pct ?? 0) : r.n)));
  const totalN = view.reduce((a, r) => a + r.n, 0);

  const toggleKind = (k: SchoolKind) => {
    const cur = prefs.kinds ?? [...SCHOOL_KINDS];
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    // 전부 끄거나 전부 켜면 '전체'(null) — 스스로를 빈 화면에 가두지 못하게.
    update({ kinds: next.length === 0 || next.length === SCHOOL_KINDS.length ? null : next });
  };

  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <header className="mb-3">
        <h2 className="text-foreground text-sm font-bold">학교별 점유율</h2>
        <p className="text-text-dim mt-0.5 text-xs">
          {BASIS_LABEL[prefs.basis]} {totalN}명 · {view.length}개교 · 전교생 대비 비율은 학교알리미
          공시 자료가 있는 학교만 (없으면 &lsquo;전교생 미상&rsquo;)
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="micro shrink-0">기준</span>
          <div className="border-line inline-flex items-center gap-0.5 rounded-full border p-0.5">
            {BASES.map((b: Basis) => (
              <button key={b} type="button" onClick={() => update({ basis: b })} className={chip(prefs.basis === b)}>
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>
        </div>

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
            {SORT_KEYS.map((s: SortKey) => (
              <button key={s} type="button" onClick={() => update({ sortBy: s })} className={chip(prefs.sortBy === s)}>
                {SORT_LABEL[s]}
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
        <p className="text-text-dim py-6 text-center text-sm">
          이 조건에 해당하는 학교가 없습니다 (기준 또는 학교급 필터를 바꿔 보세요)
        </p>
      ) : (
        <ul className="space-y-2">
          {view.map((s) => {
            // 막대는 **정렬 기준과 같은 축**을 그린다 — 인원으로 정렬해 놓고 점유율 막대를 그리면
            // 순서와 길이가 따로 놀아 "정렬이 이상하다"로 읽힌다.
            const v = prefs.sortBy === "pct" ? (s.pct ?? 0) : s.n;
            return (
              <li key={s.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground font-medium break-keep">
                    {s.label}
                    {s.kind ? <span className="text-text-faint ml-1.5 text-[11px]">{s.kind}</span> : null}
                  </span>
                  <span className="text-text-dim num shrink-0 text-xs">
                    {s.n}명
                    {s.total !== null ? (
                      <>
                        {" / "}
                        {s.total.toLocaleString("ko-KR")}명
                        <b className="text-foreground ml-1.5 text-[13px]">{s.pct}%</b>
                      </>
                    ) : (
                      <span className="text-text-faint ml-1.5">전교생 미상</span>
                    )}
                  </span>
                </div>
                <div className="bg-bg-soft mt-1 h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(v / max) * 100}%`,
                      background: KIND_COLOR[s.kind ?? ""] ?? "var(--color-text-faint)",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-text-faint mt-2 text-[11px]">
        막대는 {prefs.sortBy === "pct" ? "점유율" : "인원"} 기준, 이 목록의 최대값을 가득 참으로 봅니다
      </p>
    </section>
  );
}
