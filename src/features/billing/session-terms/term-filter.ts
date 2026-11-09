// 회차 확정 면 **표에 보이는 줄 집합** — 화면(session-terms-face)과 엑셀(/api/exports/session-terms)이 같은 한 벌을
// 지난다(감사 N2). 순수 함수 — 과목·검색어와 '보기' 필터(미확정·미배분·자리 몫을 조정한 반)의 의미를 한 곳에 둔다.
import { parseMulti } from "@/lib/multi-value";
import { needsReceiptAllocation } from "./tuition-receipt";
import { matchesTermQuery, type TermSearchFields } from "./term-search";
import { canMaterializeTerm, type TermRowState } from "./month-roster";
import { carryNeedsRecheck, type MoneyCarryIn, type MoneyCarryOut } from "./money-carryover";

type FilterableTerm = TermSearchFields & {
  subject: string;
  classId?: string | null;
  confirmedSessions: number | null;
  termState: TermRowState;
  allocatedAmount?: number | null;
  allocationStale?: boolean;
  /** '이월 재확인' 판정 재료(회차 확정 줄에 붙은 금액 이월 — 없으면 해당 없음). */
  amount?: number | null;
  refundState?: string;
  refundedAllocation?: boolean;
  carryOut?: MoneyCarryOut | null;
  carryIns?: readonly MoneyCarryIn[];
};

/** 이월 재확인 = 보낸 이월이 무효·받을 반 없음 · 받은 이월이 무효·받을 곳 없음(표 표식과 같은 기준 — `carryNeedsRecheck`). */
export const isCarryRecheckRow = (r: FilterableTerm) =>
  carryNeedsRecheck({ ...r, allocatedAmount: r.allocatedAmount ?? null, amount: r.amount ?? null });

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

/**
 * **'보기' 필터** — 회차 확정 상단의 드롭다운 하나에서 여러 개를 고른다(원장 2026-10-07 *"확정 / 배분 / 몫 3개를 하나의 드랍다운으로
 * 묶고 중복 체크가능하게"* · *"JJ/LAB 몫 조정 따로 된거 필터링 할 수 있게"*). 주소는 `only=open,pending,share`(쉼표).
 *  · `open` = 미확정 줄 · `pending` = 미배분 줄 · `share` = 그 달 자리(JJ실·랩실) 몫을 조정한 반의 줄 ·
 *    `carry` = 이월 재확인 줄(실납에 안 실리는 금액 이월 — 2026-11-09).
 * 🔴 여럿을 고르면 **모두에 해당하는 줄**만 남는다(미확정이면서 미배분 — 종전 두 드롭다운을 함께 켰을 때와 같다).
 */
export const TERM_ONLY_KEYS = ["open", "pending", "share", "carry"] as const;
export type TermOnlyKey = (typeof TERM_ONLY_KEYS)[number];

export type TermFilterInput = {
  subject?: string;
  q?: string;
  /** 보기 필터(쉼표 목록). */
  only?: string;
  /** 옛 주소 호환 — `allocation=pending` · `confirmation=open`(드롭다운이 둘이던 때의 주소 · 즐겨찾기). */
  allocation?: string;
  confirmation?: string;
  /**
   * 그 달 자리 몫을 조정한 반 id. 🔴 모르면(권한 없음 · 조회 실패) null — '몫' 필터는 **꺼진 것**으로 읽는다
   * (모르는 것을 '조정한 반 없음'으로 읽으면 표가 통째로 비어 보인다).
   */
  shareClassIds?: ReadonlySet<string> | null;
};

/** 자리 몫 줄 재료 → '몫을 조정한 반' id 집합(재료가 없으면 null). 화면과 엑셀이 같은 식으로 만든다. */
export const shareClassIdsOf = (summary: { adjusted: Record<string, unknown> } | null | undefined): ReadonlySet<string> | null =>
  summary ? new Set(Object.keys(summary.adjusted)) : null;

export function filterSessionTermRows<T extends FilterableTerm>(rows: readonly T[], input: TermFilterInput) {
  const presentSubjects = [...new Set(rows.map((r) => r.subject))].sort();
  const activeSubject = input.subject && presentSubjects.includes(input.subject) ? input.subject : null;
  const bySubject = activeSubject ? rows.filter((r) => r.subject === activeSubject) : [...rows];
  const query = (input.q ?? "").trim();
  const searched = query ? bySubject.filter((r) => matchesTermQuery(r, query)) : bySubject;
  const picked = parseMulti(input.only);
  const pendingOnly = picked.includes("pending") || input.allocation === "pending";
  const openOnly = picked.includes("open") || input.confirmation === "open";
  const shareIds = input.shareClassIds ?? null;
  const shareOnly = picked.includes("share") && shareIds !== null;
  const inShare = (r: T) => !!r.classId && !!shareIds?.has(r.classId);
  const carryOnly = picked.includes("carry");
  // 괄호 속 수는 서로를 거르지 않은 수(과목·검색까지만) — 하나를 켜도 다른 것의 수가 흔들리지 않는다.
  const pendingCount = searched.filter(isPendingTermRow).length;
  const openCount = searched.filter(isOpenTermRow).length;
  /** 몫을 조정한 **반** 수(줄 수가 아니다 — 조정은 반마다 한다). */
  const shareCount = new Set(searched.filter(inShare).map((r) => r.classId)).size;
  const carryCount = searched.filter(isCarryRecheckRow).length;
  const filtered = searched.filter((r) => (!pendingOnly || isPendingTermRow(r)) && (!openOnly || isOpenTermRow(r)) && (!shareOnly || inShare(r)) && (!carryOnly || isCarryRecheckRow(r)));
  /** 지금 켜진 보기 필터(선택지 순서) — 주소·엑셀 링크·드롭다운 값이 이 한 벌을 쓴다(옛 주소로 들어와도 새 꼴로 정리된다). */
  const on = { open: openOnly, pending: pendingOnly, share: shareOnly, carry: carryOnly };
  const only: TermOnlyKey[] = TERM_ONLY_KEYS.filter((key) => on[key]);
  return { presentSubjects, activeSubject, query, pendingOnly, openOnly, shareOnly, carryOnly, pendingCount, openCount, shareCount, carryCount, only, filtered };
}
