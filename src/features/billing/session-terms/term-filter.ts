// 회차 확정 면 **표에 보이는 줄 집합** — 화면(session-terms-face)과 엑셀(/api/exports/session-terms)이 같은 한 벌을
// 지난다(감사 N2). 순수 함수 — 과목·검색어·미확정만·미배분만 네 필터의 의미를 한 곳에 둔다.
import { needsReceiptAllocation } from "./tuition-receipt";
import { matchesTermQuery, type TermSearchFields } from "./term-search";
import { canMaterializeTerm, type TermRowState } from "./month-roster";

type FilterableTerm = TermSearchFields & {
  subject: string;
  confirmedSessions: number | null;
  termState: TermRowState;
  allocatedAmount?: number | null;
  allocationStale?: boolean;
};

/**
 * 확정할 수 있는 줄 — 회차 행이 있거나(`term`), 청구서가 있어 확정하는 순간 행을 만들 수 있는 줄(`missing`). 청구서가 없거나 취소된
 * 줄은 확정할 수 없어 '미확정'이 아니다(출석부가 '—'로 적는 줄과 같은 집합, 원장 2026-09-18).
 */
export const confirmableTermRow = (r: { termState: TermRowState }) => r.termState === "term" || canMaterializeTerm(r.termState);
/** 미확정 = 확정할 수 있는 줄 중 아직 안 한 줄. */
export const isOpenTermRow = (r: { confirmedSessions: number | null; termState: TermRowState }) =>
  r.confirmedSessions === null && confirmableTermRow(r);
/** 미배분 = 배분할 수납이 있는 줄 중 아직 안 한 줄(청구서 없음·취소는 아니다). */
export const isPendingTermRow = (r: Parameters<typeof needsReceiptAllocation>[0] & { termState: TermRowState }) =>
  confirmableTermRow(r) && needsReceiptAllocation(r);

export type TermFilterInput = { subject?: string; q?: string; allocation?: string; confirmation?: string };

export function filterSessionTermRows<T extends FilterableTerm>(rows: readonly T[], input: TermFilterInput) {
  const presentSubjects = [...new Set(rows.map((r) => r.subject))].sort();
  const activeSubject = input.subject && presentSubjects.includes(input.subject) ? input.subject : null;
  const bySubject = activeSubject ? rows.filter((r) => r.subject === activeSubject) : [...rows];
  const query = (input.q ?? "").trim();
  const searched = query ? bySubject.filter((r) => matchesTermQuery(r, query)) : bySubject;
  const pendingOnly = input.allocation === "pending";
  const openOnly = input.confirmation === "open";
  // 두 필터의 괄호 속 건수는 서로를 거르지 않은 수(과목·검색까지만) — 한쪽을 켜도 다른 쪽 건수가 흔들리지 않는다.
  const pendingCount = searched.filter(isPendingTermRow).length;
  const openCount = searched.filter(isOpenTermRow).length;
  const filtered = searched.filter((r) => (!pendingOnly || isPendingTermRow(r)) && (!openOnly || isOpenTermRow(r)));
  return { presentSubjects, activeSubject, query, pendingOnly, openOnly, pendingCount, openCount, filtered };
}
