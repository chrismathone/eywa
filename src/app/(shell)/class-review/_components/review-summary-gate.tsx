"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { GRADE_CUTS, GRADE_FALLBACK } from "@/features/class-review/checklist";

/** 등급 순서(높은 등급부터) — 글자 정렬은 S가 뒤로 가고 서버·브라우저가 갈릴 수 있다(리뷰). */
const GRADE_ORDER = [...GRADE_CUTS.map((c) => c.grade), GRADE_FALLBACK];

export type ReviewSummaryRow = { percent: string | null; grade: string | null; incomplete: boolean; myTurn: boolean };

/**
 * 직원 평가 체크리스트 첫 화면 — **요약 먼저**, 강사 이름 목록은 [평가 목록 보기]로(원장 2026-10-29 *"강사평가에 들어갔을 때 개별 리스트가 먼저
 * 뜨지 않게 … 전체(요약)가 먼저 뜨고, 필요해서 누르고 들어가면 개별 리스트"*). 내 평가 대기가 있으면 그 수를 요약에 적어 놓치지 않게 한다.
 */
export function ReviewSummaryGate({ rows, children }: { rows: ReviewSummaryRow[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // 평균·등급은 채점이 끝난 평가만(진행 중의 부분 평균은 섞지 않는다).
  const scored = rows.filter((r) => r.percent !== null && !r.incomplete);
  const average = scored.length ? (scored.reduce((s, r) => s + Number(r.percent), 0) / scored.length).toFixed(1) : null;
  const grades = [...scored.reduce((m, r) => (r.grade ? m.set(r.grade, (m.get(r.grade) ?? 0) + 1) : m), new Map<string, number>())]
    .sort(([a], [b]) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const mine = rows.filter((r) => r.myTurn).length;
  const tiles = [
    { label: "평가 건", value: `${rows.length.toLocaleString("ko-KR")}건` },
    { label: "채점 완료", value: `${(rows.length - rows.filter((r) => r.incomplete).length).toLocaleString("ko-KR")}건`, note: rows.some((r) => r.incomplete) ? `진행 중 ${rows.filter((r) => r.incomplete).length}건` : undefined },
    { label: "평균 환산점수", value: average ?? "—" },
    { label: "등급 분포", value: grades.length ? grades.map(([g, n]) => `${g} ${n}`).join(" · ") : "—" },
  ];
  return <div className="space-y-4">
    <section aria-label="직원 평가 요약" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => <div key={t.label} className="rounded-xl border p-4">
        <p className="text-text-dim text-xs">{t.label}</p>
        <p className="mt-1 text-lg font-bold">{t.value}</p>
        {t.note ? <p className="text-text-dim mt-0.5 text-xs">{t.note}</p> : null}
      </div>)}
    </section>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "평가 목록 접기" : `평가 목록 보기 (${rows.length.toLocaleString("ko-KR")}건)`}</Button>
      {mine ? <span className="text-primary text-sm font-bold">내 평가 대기 {mine}건</span> : null}
    </div>
    {open ? children : null}
  </div>;
}
