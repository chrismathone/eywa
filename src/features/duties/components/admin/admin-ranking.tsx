"use client";

import { useState } from "react";
import { TierStars } from "@/features/student-contribution/components/relative-score";
import { MATRIX_COLUMNS } from "../../view-admin";
import { rankOwners, rootOfTree, type TreeSubject } from "../../view-admin-levels";

/**
 * 등수(전체 단계) — 전체 등수 + 과목마다 등수. 한 줄 = 등수 · 선생님 · 별(등급) · 기한 준수율. 누르면 그 선생님(과목 등수는 그 과목 안에서).
 * 위 단추로 기준을 고른다: 전체(전체 %) 또는 업무 종류 하나(출결 · 보고서 · 발송 · 월 상담 · 월말평가 · 신규생 정착 — 그 종류의 칸으로).
 * 순서는 기한 준수율 높은 순이고 같은 %는 같은 등수다(`rankOwners`). 등급 전(기한 도래 3건 미만)은 등수 없이 뒤에.
 */
export function AdminRanking({ tree, onOwner }: { tree: readonly TreeSubject[]; onOwner: (subject: string | null | undefined, ownerId: string, kind: string | null) => void }) {
  const [kind, setKind] = useState<string | null>(null);
  const root = rootOfTree(tree);
  // 이 기간에 실제로 있는 종류만 고르게 한다.
  const kinds = MATRIX_COLUMNS.filter((c) => root.cells[c.kind]?.total);
  const picked = kind && kinds.some((c) => c.kind === kind) ? kind : null;
  // 어느 항목을 골라도 카드 크기는 같다(원장 2026-11-11) — 판은 '전체' 기준으로 세우고, 고른 항목의 줄이 모자라면 빈 줄로 채운다.
  const boards: { key: string; title: string; subject: string | null | undefined; rows: ReturnType<typeof rankOwners>; size: number }[] = [
    { key: "all", title: "전체", subject: undefined, rows: rankOwners(root.owners, picked), size: rankOwners(root.owners).length },
    ...tree.map((s) => ({ key: `s:${s.subject ?? ""}`, title: s.label, subject: s.subject as string | null | undefined, rows: rankOwners(s.owners, picked), size: rankOwners(s.owners).length })),
  ].filter((b) => b.size);
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs font-bold ${on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:text-primary"}`;
  return <section className="border-line bg-card rounded-xl border p-2">
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">
      <h4 className="mr-1 text-sm font-bold">등수 <span className="text-text-dim text-xs font-medium">기한 준수율 높은 순</span></h4>
      <button type="button" aria-pressed={picked === null} onClick={() => setKind(null)} className={chip(picked === null)}>전체</button>
      {kinds.map((c) => <button key={c.kind} type="button" aria-pressed={picked === c.kind} onClick={() => setKind(c.kind)} className={chip(picked === c.kind)}>{c.label}</button>)}
    </div>
    {!boards.length ? <p className="text-text-dim px-2 py-3 text-sm">해당 업무 없음</p> : <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {boards.map((b) => <div key={b.key} className="min-w-0">
        <h5 className="text-text-dim px-2 py-1 text-xs font-bold">{b.title}</h5>
        <ol className="grid gap-0.5">
          {b.rows.map((r) => <li key={r.ownerId}>
            <button type="button" onClick={() => onOwner(b.subject === undefined ? tree.find((s) => s.owners.some((o) => o.ownerId === r.ownerId))?.subject : b.subject, r.ownerId, picked)} className="hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left">
              <span className={`w-6 shrink-0 text-center text-sm font-bold tabular-nums ${r.rank !== null && r.rank <= 3 ? "text-primary" : "text-text-dim"}`}>{r.rank ?? "—"}</span>
              <span className="min-w-0 flex-1 overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap">{r.name}{r.meta ? <span className="text-text-dim ml-1.5 text-xs font-medium">{r.meta}</span> : null}</span>
              {r.verdict.tier ? <TierStars tier={`${r.verdict.tier}등급`} /> : <span className="text-text-dim text-xs font-medium">평가 대기</span>}
              <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">{r.cell.pct === null || !r.verdict.tier ? "" : `${r.cell.pct}%`}</span>
            </button>
          </li>)}
          {Array.from({ length: Math.max(b.size - b.rows.length, 0) }, (_, i) => <li key={`pad${i}`} aria-hidden className="invisible flex items-center gap-2 px-2 py-1"><span className="text-sm font-semibold">&nbsp;</span><TierStars tier="1등급" /></li>)}
        </ol>
      </div>)}
    </div>}
  </section>;
}
