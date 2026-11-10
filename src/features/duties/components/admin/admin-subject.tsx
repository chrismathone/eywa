"use client";

import { upcomingOf, type Cell } from "../../view-admin";
import { Kpi } from "./admin-kpi";

/**
 * 과목(또는 전체) 단계 맨 위 — 기한 준수(실적) · 이 기간 지연(고른 기간의 의무 중 열린 지연 · 종류별 한 줄) · 그중 7일 이상 · 진행(장부 전체).
 * 🔴 여기 숫자는 **고른 기간**의 것이다 — 아래 '지금 열린 지연' 목록(기간 무관)과 이름을 같게 쓰지 않는다(리뷰 2026-11-10).
 * '7일 이상 지연'은 지난 날 수일 뿐이다 — 원장이나 관리자에게 전달됐다는 뜻이 아니다(실제 배정은 아직 없다).
 */
export function AdminKpiRow({ cell, lateText }: { cell: Cell; lateText: string }) {
  const pct = cell.pct; const up = upcomingOf(cell);
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
    <Kpi label="기한 준수" value={pct === null ? "—" : `${pct}`} unit={pct === null ? undefined : "%"} note={cell.due ? `기한이 온 ${cell.due}건 중 제때 ${cell.ontime}건` : "기한이 온 의무가 아직 없습니다"} pct={pct ?? undefined} tone={pct !== null && pct >= 90 ? "green" : "primary"} />
    <Kpi label="이 기간 지연" value={`${cell.late}`} note={lateText} tone={cell.late ? "danger" : "muted"} />
    <Kpi label="그중 7일 이상" value={`${cell.over7}`} note={cell.expired ? `미이행 확정 ${cell.expired}건` : ""} tone={cell.over7 ? "danger" : "muted"} />
    <Kpi label="진행" value={`${cell.done}`} unit={`/ ${cell.total}`} note={up ? `기한 전 ${up}건` : ""} tone="muted" />
  </div>;
}
