// 수납 **자유 배분**(관리자 이상) — 순수 규칙(Vitest). 원장 2026-09-21:
//   *"총 금액(청구액)은 변하지 않는선에서 출결행에 다 분배시킬 수 있어야함. 언제 이런저런일이 있을지 알 수 없으니까."*
//   → 선택: **총액만 맞으면 자유 배분** · *"일단 스마트하게 자동 배분되는건 자동 배분이 우선적으로 되고, 관리자 이상급이 자유롭게
//   수납 배분을 커스텀할 수 있게"* · *"보강수업건이 '회차 확정'에 추가로 생길때도 다른 수업에서 자유롭게 금액을 떼서 주는거지"* ·
//   *"원칙은 '받은 돈보다 더 지급할 순 없다.' '덜 지급하는건 괜찮다.'"*
//
// 🔑 항목별 배분(수납 항목마다 합계 = 청구액)은 그대로 기본이다. 자유 배분은 **수납 항목에 연결하지 않고** 반마다 금액만 둔다 —
//    저장 모양은 0269a '연결 안 함 0원' 행과 같다(항목 null · 저장 때 청구 항목 전체 스냅샷 · 확정금액 기준) · 금액만 0이 아닐 수 있다.
// 🔴 더 못 준다: 합계 ≤ **수업 청구액**(항목별 배분과 같은 급여 기준 — 할인 전 청구액, 환불 반영). 덜 주는 건 괜찮다.
//    ⚠️ 이 상한은 '실제로 받은 돈'이 아니라 급여 기준 청구액이다(할인·미납이 있으면 실제 받은 돈보다 크다) — 화면 문구도 그렇게 부른다.
// 🔴 전액 환불한 반에는 금액을 줄 수 없다 — 회차 확정·분배는 그 반을 0으로 읽어 준 돈이 조용히 사라진다.
// 🔴 확정한 반은 전부 싣는다(0원이어도) — 빼면 그 반이 '배분 재확인'으로 남는다. 0시수로 확정한 반에는 금액을 줄 수 없다(항목별과 같은 규칙).
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";

/** 여기까지 연다 — 관리자(`admin`) 이상 = 원장·관리자(super_admin은 서버 게이트가 얹는다, 2026-08-13 상시 규약). */
export const FREE_ALLOCATION_MIN_ROLE: SystemRole = "admin";

/** 저장된 자유 배분 모양 — 연결 행 없음 + 금액 있는 연결 없는 행. 화면 전환·덮어쓰기 거절·분배 저장 문구가 같은 판정을 쓴다. */
export function freeShapeSaved(rows: readonly { allocationLineIndex?: number | null; savedAllocationAmount?: number | null }[]): boolean {
  return rows.every((t) => t.allocationLineIndex == null) && rows.some((t) => (t.savedAllocationAmount ?? 0) > 0);
}

/** 여러 청구서의 행을 청구서별로 접어, 자유 배분으로 저장된 청구서 id만 — 시수 검증 면(그 달 전체)이 쓴다. */
export function freeSavedInvoiceIds(rows: readonly { invoiceId: string | null; allocationLineIndex?: number | null; savedAllocationAmount?: number | null }[]): Set<string> {
  const byInvoice = new Map<string, { allocationLineIndex?: number | null; savedAllocationAmount?: number | null }[]>();
  for (const r of rows) {
    if (!r.invoiceId) continue;
    const list = byInvoice.get(r.invoiceId);
    if (list) list.push(r); else byInvoice.set(r.invoiceId, [r]);
  }
  return new Set([...byInvoice].filter(([, list]) => freeShapeSaved(list)).map(([id]) => id));
}

export function canUseFreeAllocation(role: SystemRole): boolean {
  return ROLE_HIERARCHY[role] <= ROLE_HIERARCHY[FREE_ALLOCATION_MIN_ROLE];
}

export type FreeAllocationTerm = {
  id: string;
  className: string | null;
  confirmedSessions: number | null;
  pricingMode: string;
  /** 그 반 몫이 전액 환불됐다(`refundState === "full"`). */
  fullyRefunded?: boolean;
};

export type FreeAllocationRow = { termId: string; amount: number };

/** 화면 입력 → 저장 행. 확정한 반은 빈칸이어도 0원으로 싣고, 미확정 반은 금액을 적었을 때만 싣는다. */
export function freeAllocationSaveRows(terms: readonly FreeAllocationTerm[], amounts: Readonly<Record<string, string>>): FreeAllocationRow[] {
  return terms.flatMap((t) => {
    const raw = (amounts[t.id] ?? "").trim();
    const amount = raw === "" ? 0 : Number(raw);
    if (t.confirmedSessions === null && amount === 0) return [];
    return [{ termId: t.id, amount }];
  });
}

export function validateFreeAllocation(
  terms: readonly FreeAllocationTerm[],
  rows: readonly FreeAllocationRow[],
  total: number,
): { ok: true; sum: number } | { ok: false; error: string } {
  if (rows.length === 0) return { ok: false, error: "배분할 반이 없습니다" };
  const byId = new Map(terms.map((t) => [t.id, t]));
  const seen = new Set<string>();
  let sum = 0;
  for (const row of rows) {
    const term = byId.get(row.termId);
    if (!term || seen.has(row.termId)) return { ok: false, error: "배분할 반을 확인해 주세요" };
    seen.add(row.termId);
    if (!Number.isSafeInteger(row.amount) || row.amount < 0) return { ok: false, error: `${term.className ?? "반"} 금액은 0 이상 원 단위로 적어 주세요` };
    if (term.confirmedSessions === 0 && term.pricingMode !== "monthly" && row.amount > 0) return { ok: false, error: `${term.className ?? "반"}은 0시수로 확정해 금액을 줄 수 없습니다` };
    if (term.confirmedSessions === null && row.amount === 0) return { ok: false, error: "미확정 반은 금액을 적었을 때만 저장합니다" };
    if (term.fullyRefunded && row.amount > 0) return { ok: false, error: `${term.className ?? "반"}은 전액 환불한 반이라 금액을 줄 수 없습니다` };
    sum += row.amount;
  }
  const missing = terms.filter((t) => t.confirmedSessions !== null && !seen.has(t.id));
  if (missing.length) return { ok: false, error: `확정한 반은 모두 넣어 주세요(${missing.map((t) => t.className ?? "반").join(", ")})` };
  if (sum > total) return { ok: false, error: `수업 청구액 ${total.toLocaleString("ko-KR")}원보다 많이 나눌 수 없습니다 — 지금 ${sum.toLocaleString("ko-KR")}원` };
  return { ok: true, sum };
}

/**
 * 자유 배분 창의 처음 값 — **자동 배분이 먼저**(원장): 이미 자유 배분으로 저장했으면 그 값, 아니면 항목별 창이 제안한 초안의 금액
 * (연결 안 한 반은 0). 관리자가 거기서 고친다.
 * 🔴 저장한 값은 **유효 판정 전 원값**(`savedAllocationAmount`)으로 채운다 — 청구 항목·확정값이 바뀌어 무효가 되면 유효값은 전부 null이라
 *    빈칸으로 열리고, 확정 반은 빈칸 = 0원이라 한 번 누르면 그 청구서 모든 반이 0원이 된다(적대 리뷰 2026-09-21).
 */
export function initialFreeAmounts(
  terms: readonly (FreeAllocationTerm & { savedAllocationAmount?: number | null })[],
  lineDraft: Readonly<Record<string, { line: string; amount: string }>>,
  freeSaved: boolean,
): Record<string, string> {
  return Object.fromEntries(terms.map((t) => {
    if (freeSaved) return [t.id, t.savedAllocationAmount == null ? (t.confirmedSessions !== null ? "0" : "") : String(t.savedAllocationAmount)];
    const d = lineDraft[t.id];
    return [t.id, d && d.line !== "" ? d.amount : t.confirmedSessions !== null ? "0" : ""];
  }));
}
