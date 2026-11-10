"use client";

import { type Cell, dutyTier, tierTone } from "../../view-admin";
import { Kpi } from "./admin-kpi";

/**
 * 과목(또는 전체) 단계 맨 위 — 기한 준수(실적) · 이 기간 지연(고른 기간의 의무 중 열린 지연 · 종류별 한 줄) · 그중 7일 이상 · 진행(장부 전체).
 * 🔴 여기 숫자는 **고른 기간**의 것이다 — 아래 '지금 열린 지연' 목록(기간 무관)과 이름을 같게 쓰지 않는다(리뷰 2026-11-10).
 * '7일 이상 지연'은 지난 날 수일 뿐이다 — 원장이나 관리자에게 전달됐다는 뜻이 아니다(실제 배정은 아직 없다).
 */
export function AdminKpiRow({ cell }: { cell: Cell }) {
  const pct = cell.pct;
  // 칸에는 이름과 숫자만(원장 2026-11-11 *"아래쪽 보조 멘트 제거"*) — 풀이는 바로 아래 등급 줄의 결론과 막대가 맡는다.
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
    <Kpi label="기한 내 완료율" value={pct === null ? "—" : `${pct}`} unit={pct === null ? undefined : "%"} pct={pct ?? undefined} tone={pct !== null && tierTone(dutyTier(pct)) === "good" ? "green" : "primary"} />
    <Kpi label="기한 초과" value={`${cell.late}`} tone={cell.late ? "danger" : "muted"} />
    <Kpi label="7일 이상 기한 초과" value={`${cell.over7}`} tone={cell.over7 ? "danger" : "muted"} />
    <Kpi label="완료" value={`${cell.done}`} unit={`/ ${cell.total}`} tone="muted" />
  </div>;
}
