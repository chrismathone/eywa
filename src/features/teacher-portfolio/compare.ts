/**
 * 직원별 항목 비교(원장 2026-10-15 *"직원 포트폴리오 점수 완성되면 직원별로 항목 비교 가능하게"*) — 한 달의 저장된 점수를
 * 직원 × 항목 표로 편다. 순수 함수(서버·클라이언트 공용). 점수는 저장된 그대로(그 달 설정으로 매긴 값) — 다시 매기지 않는다.
 */
import { METRIC_META } from "./evaluation/catalog";
import type { BuiltinMetricId } from "./evaluation/config";

/** 한 칸 — 점수 · 원래 수치 · 자료 없음/계산 전. */
export type CompareCell = { value: number | null; raw: number | null; missing: boolean; uncounted: boolean };
export type CompareItem = { id: string; label: string; max: number };
export type CompareRow = { teacherId: string; total: number | null; knownMax: number; closed: boolean; items: (CompareItem & CompareCell)[] };
export type CompareColumn = CompareItem & { unit: string };
export type CompareSort = { key: string; dir: "asc" | "desc" };

/** 열 = 그 달 행들에 켜진 항목(첫 행 차례 → 다른 행에만 있는 항목은 뒤에). 같은 달은 같은 설정이라 보통 모두 같다. */
export function compareColumns(rows: readonly CompareRow[]): CompareColumn[] {
  const out = new Map<string, CompareColumn>();
  for (const r of rows) for (const m of r.items) {
    if (!out.has(m.id)) out.set(m.id, { id: m.id, label: m.label, max: m.max, unit: (METRIC_META as Record<string, { unit: string } | undefined>)[m.id as BuiltinMetricId]?.unit ?? "" });
  }
  return [...out.values()];
}

/** 정렬 — `total` 또는 항목 id. 점수가 없는 칸(합계에서 뺀 항목)은 방향과 상관없이 맨 아래. 같으면 이름순. */
export function sortCompareRows<R extends CompareRow>(rows: readonly R[], sort: CompareSort, nameOf: (id: string) => string): R[] {
  const valueOf = (r: R) => (sort.key === "total" ? r.total : r.items.find((m) => m.id === sort.key)?.value ?? null);
  return [...rows].sort((a, b) => {
    const x = valueOf(a), y = valueOf(b);
    if (x === null || y === null) return x === y ? nameOf(a.teacherId).localeCompare(nameOf(b.teacherId), "ko") : x === null ? 1 : -1;
    return (sort.dir === "desc" ? y - x : x - y) || nameOf(a.teacherId).localeCompare(nameOf(b.teacherId), "ko");
  });
}

/** 열마다 가장 높은 점수(같은 값이면 모두) — 표에서 굵게 보인다. 만점이 0인 가감 항목도 높은 쪽이 좋다. */
export function columnBest(rows: readonly CompareRow[], id: string): number | null {
  const values = rows.map((r) => (id === "total" ? r.total : r.items.find((m) => m.id === id)?.value ?? null)).filter((v): v is number => v !== null);
  return values.length > 1 ? Math.max(...values) : null;
}
