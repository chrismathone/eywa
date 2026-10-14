import type { CardDef } from "@/features/dashboard/layout/registry";

/** 위젯 묶음 제목(갤러리 머리말과 검색이 같은 말을 쓴다). */
export const groupTitle = (group: string) => (group === "KPI" ? "숫자 칸(KPI)" : group);
const squash = (s: string) => s.toLowerCase().replace(/[\s·&]/g, "");

/** 위젯 검색(원장 2026-10-14) — 이름·묶음 이름에 검색어(공백·가운뎃점·& 무시)가 들어 있으면 보인다. 빈 검색어는 전부. */
export function matchesWidget(def: Pick<CardDef, "label" | "group">, query: string): boolean {
  const q = squash(query);
  return !q || squash(def.label).includes(q) || squash(groupTitle(def.group)).includes(q);
}
