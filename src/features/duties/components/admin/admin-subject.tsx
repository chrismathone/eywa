"use client";

import { type Cell, missedOf } from "../../view-admin";
import { MIX_COLOR } from "./admin-mix";
import { Kpi } from "./admin-kpi";

/**
 * 과목(또는 전체) 단계 맨 위 — 기한 내 완료율 · 기한 후 완료 · 미처리 · 완료(장부 전체). 순서는 막대의 색 순서와 같다(기한 내 → 기한 후 완료 → 미처리).
 * 🔴 여기 숫자는 **고른 기간**의 것이다 — 아래 '미처리' 목록(지금 열려 있는 것 · 기간 무관)과 수가 다를 수 있다.
 * '7일 이상' 칸은 없앴다(원장 2026-11-11 *"7일이상 기한 초과 카드도 의미없는듯. 그냥 기한 후 완료로 카드 바꾸고 카드 위치도 2번째로 이동"*).
 */
export function AdminKpiRow({ cell }: { cell: Cell }) {
  const pct = cell.pct;
  // 칸에는 이름과 숫자만(원장 2026-11-11 *"아래쪽 보조 멘트 제거"*) — 풀이는 바로 아래 등급 줄의 결론과 막대가 맡는다.
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
    <Kpi label="기한 내 완료율" value={pct === null ? "—" : `${pct}`} unit={pct === null ? undefined : "%"} pct={pct ?? undefined} tone="primary" barColor={MIX_COLOR.ontime} />
    <Kpi label="기한 후 완료" value={`${cell.lateDone}`} tone={cell.lateDone ? "primary" : "muted"} />
    <Kpi label="미처리" value={`${missedOf(cell)}`} tone={missedOf(cell) ? "danger" : "muted"} />
    <Kpi label="완료" value={`${cell.done}`} unit={`/ ${cell.total}`} tone="muted" />
  </div>;
}
