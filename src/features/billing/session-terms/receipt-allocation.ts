// 할인은 학부모 혜택이다. 반별 급여 기준의 배분 총액은 할인 전 청구액이다.
import { isTuitionReceipt } from "./tuition-receipt";
import { receiptRefundState, receiptSalaryAmount } from "./receipt-refund";
export type ReceiptLine = { index: number; description: string; kind: string; amount: number; source: unknown };
export type AllocationTerm = {
  id: string; amount: number | null; confirmedSessions: number | null;
  lineIndex: number | null; allocatedAmount: number | null; source: unknown; baseAmount: number | null;
};
export type ReceiptAllocationDraft = Record<string, { line: string; amount: string }>;

/** 해당 반에 넣을 수 있는 잔액. 이미 입력한 다른 반의 금액은 그대로 둔다. */
export function receiptRemainder(line: ReceiptLine, termId: string, draft: ReceiptAllocationDraft): number {
  const others = Object.entries(draft).reduce((sum, [id, value]) => sum + (id !== termId && value.line === String(line.index) ? Number(value.amount) || 0 : 0), 0);
  return Math.max(0, line.amount - others);
}

/** 확정 반은 확정금액을 기본으로, 미확정 반은 선택한 항목의 남은 금액을 채운다. */
export function connectReceiptTerm(draft: ReceiptAllocationDraft, term: { id: string; amount: number | null }, line: ReceiptLine | undefined): ReceiptAllocationDraft {
  if (!line) return { ...draft, [term.id]: { line: "", amount: "" } };
  if (draft[term.id]?.line === String(line.index)) return draft;
  const remaining = receiptRemainder(line, term.id, draft);
  return { ...draft, [term.id]: { line: String(line.index), amount: String(term.amount === null ? remaining : Math.min(term.amount, remaining)) } };
}

/** 미확정 반이 있으면 확정 반의 입력액을 보존하고 잔액만 균등 배분한다. */
export function distributeLinkedReceipt(line: ReceiptLine, terms: { id: string; amount: number | null; confirmedSessions: number | null }[], draft: ReceiptAllocationDraft): Record<string, number> {
  const unconfirmed = terms.filter((term) => term.confirmedSessions === null);
  if (unconfirmed.length > 0) {
    const fixed = terms.filter((term) => term.confirmedSessions !== null).reduce((sum, term) => sum + (Number(draft[term.id]?.amount) || 0), 0);
    return distributeReceipt(Math.max(0, line.amount - fixed), unconfirmed.map((term) => ({ id: term.id, amount: 1 })));
  }
  return distributeReceipt(line.amount, terms.map((term) => ({ id: term.id, amount: term.amount ?? 0 })));
}

export function receiptLines(raw: unknown): ReceiptLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((source, index) => {
    const line = (source ?? {}) as Record<string, unknown>;
    return { index, description: String(line.description ?? line.name ?? ""), kind: String(line.kind ?? ""), amount: receiptSalaryAmount(source) ?? 0, source };
  });
}

/** 배분 근거가 되는 청구 항목의 모양(종류·항목명·급여 기준액·반·합산 묶음) — 할인·납부 기록·키 순서는 안 본다. */
function billShape(value: unknown): string {
  const row = receiptLines([value])[0];
  const source = value && typeof value === "object" ? value as { receiptGroupId?: unknown; classId?: unknown } : {};
  return JSON.stringify([row.kind, row.description, row.amount, source.classId ?? "", source.receiptGroupId ?? ""]);
}

/** 객체 키 순서나 할인·납부 기록 갱신은 배분 근거(청구액·항목명)를 바꾸지 않는다. */
function sameBill(a: unknown, b: unknown): boolean {
  return a != null && b != null && billShape(a) === billShape(b);
}

/** 합계는 정확히 총액과 일치한다. 원 미만 잔액은 나머지가 큰 반부터 1원씩 배정한다. */
export function distributeReceipt(total: number, rows: { id: string; amount: number }[]): Record<string, number> {
  if (!Number.isSafeInteger(total) || total < 0 || rows.length === 0) return {};
  const sum = rows.reduce((n, row) => n + Math.max(0, row.amount), 0);
  if (sum <= 0) return {};
  const shares = rows.map((row) => {
    const exact = total * Math.max(0, row.amount) / sum;
    return { id: row.id, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((n, row) => n + row.amount, 0);
  for (const row of [...shares].sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))) {
    if (left-- <= 0) break;
    row.amount++;
  }
  return Object.fromEntries(shares.map((row) => [row.id, row.amount]));
}

/**
 * 연결할 수납 항목이 없어 **0원으로 저장한 확정 반**(원장 2026-09-17 *"배분 금액이 없으면 0으로 입력해서 저장할 수 있게"* ·
 * *"연결 안함 처리시 자동으로 0"*) — 행은 `lineIndex = null · allocatedAmount = 0 · source = 저장 때의 청구 항목 전체(배열)`.
 * 🔴 저장 뒤 **수업 수납 항목**이 바뀌면(새 수납이 들어오는 등) 0원을 그대로 믿지 않는다 — 연결한 반이 항목이 바뀌면 재확인으로 가는 것과 같은 결.
 *    교재·셔틀 같은 수업 아닌 항목과 순서는 보지 않는다(그것만 바뀌어도 재확인이 되면 그 달 분배 저장이 통째로 막힌다 — 리뷰 2026-09-17).
 */
function sameTuitionLines(snapshot: unknown, lines: ReceiptLine[]): boolean {
  if (!Array.isArray(snapshot)) return false;
  const shapes = (values: unknown[]) => values.filter((v) => v != null && isTuitionReceipt(v)).map(billShape).sort();
  const before = shapes(snapshot);
  const now = shapes(lines.map((line) => line.source));
  return before.length === now.length && before.every((shape, i) => shape === now[i]);
}

/** 화면 초안 → 저장 행. 수납 항목에 하나라도 연결했으면, 연결하지 않은 **확정** 반은 0원으로 함께 보낸다(`lineIndex: null`). */
export function receiptAllocationSaveRows<T extends { id: string; amount: number | null; confirmedSessions: number | null; confirmedAt: string | null }>(
  terms: T[],
  draft: ReceiptAllocationDraft,
  /** 어느 반에도 안 붙은 수업 항목이 남는다는 확인을 받았다 — 0원 행에 표식을 싣는다(0269a가 확인 없는 0원 행을 거절). */
  ackUnlinked = false,
): { termId: string; lineIndex: number | null; amount: number; baseAmount: number | null; confirmedAt: string | null; ackUnlinked?: boolean }[] {
  const linked = terms.filter((term) => draft[term.id]?.line !== "" && draft[term.id]?.line !== undefined);
  const zero = linked.length > 0 ? terms.filter((term) => term.confirmedSessions !== null && (draft[term.id]?.line ?? "") === "") : [];
  return [
    ...linked.map((term) => ({ termId: term.id, lineIndex: Number(draft[term.id].line), amount: Number(draft[term.id].amount), baseAmount: term.amount, confirmedAt: term.confirmedAt })),
    ...zero.map((term) => ({ termId: term.id, lineIndex: null, amount: 0, baseAmount: term.amount, confirmedAt: term.confirmedAt, ...(ackUnlinked ? { ackUnlinked: true } : {}) })),
  ];
}

/** 수업 청구액 합계(급여 기준 — 할인 전·환불 반영) — 자유 배분의 상한('받은 돈보다 더 줄 수 없다'). */
export function tuitionTotal(lines: readonly ReceiptLine[]): number {
  return lines.reduce((sum, line) => sum + (isTuitionReceipt(line.source) ? Math.max(0, line.amount) : 0), 0);
}

/** 동기화·재확정으로 근거가 바뀌거나 그룹 합계가 깨졌으면 급여에서 사용하지 않는다. */
export function effectiveAllocations(lines: ReceiptLine[], terms: AllocationTerm[]): Map<string, number> {
  const groups = new Map<number, AllocationTerm[]>();
  for (const term of terms) if (term.lineIndex !== null) {
    (groups.get(term.lineIndex) ?? groups.set(term.lineIndex, []).get(term.lineIndex)!).push(term);
  }
  const out = new Map<string, number>();
  for (const [index, group] of groups) {
    const line = lines.find((row) => row.index === index);
    if (!line || line.amount < 0 || !isTuitionReceipt(line.source)) continue;
    // 실제 전체환불은 이전에 저장한 양수 배분보다 우선한다. 다른 항목으로 바뀐 인덱스는 제외한다.
    const identity = (value: unknown) => {
      const s = (value ?? {}) as Record<string, unknown>;
      return JSON.stringify([s.kind ?? "", s.description ?? s.name ?? "", s.classId ?? "", s.receiptGroupId ?? "", Number(s.amount)]);
    };
    if (receiptRefundState(line.source) === "full" && group.every((t) => identity(t.source) === identity(line.source))) {
      for (const term of group) out.set(term.id, 0);
      continue;
    }
    if (group.some((term) => (term.confirmedSessions === null && term.amount !== null) || term.allocatedAmount === null || !Number.isSafeInteger(term.allocatedAmount) || term.allocatedAmount < 0 || term.baseAmount !== term.amount || !sameBill(term.source, line.source))) continue;
    if (group.reduce((sum, term) => sum + term.allocatedAmount!, 0) !== line.amount) continue;
    for (const term of group) out.set(term.id, term.allocatedAmount!);
  }
  // 연결 없이 0원으로 저장한 확정 반 — 확정금액·청구 항목이 저장 때 그대로일 때만.
  for (const term of terms) {
    if (term.lineIndex !== null || term.allocatedAmount !== 0 || term.confirmedSessions === null || term.amount === null) continue;
    if (term.baseAmount !== term.amount || !sameTuitionLines(term.source, lines)) continue;
    out.set(term.id, 0);
  }
  // 자유 배분(0279a, 관리자 이상 — 원장 2026-09-21) — 수납 항목에 **하나도 연결하지 않고** 금액만 둔 청구서. 0원 행은 위에서 본다.
  // 금액 행은 확정금액·청구 항목이 저장 때 그대로이고, 합계가 수업 청구액 이하일 때만(받은 돈보다 더 줄 수 없다 · 덜 주는 건 괜찮다).
  if (!terms.some((term) => term.lineIndex !== null)) {
    const free = terms.filter((term) => term.lineIndex === null && term.allocatedAmount !== null && term.allocatedAmount > 0);
    const intact = free.every((term) => Number.isSafeInteger(term.allocatedAmount) && !(term.confirmedSessions === null && term.amount !== null)
      && term.baseAmount === term.amount && sameTuitionLines(term.source, lines));
    if (free.length && intact && free.reduce((sum, term) => sum + term.allocatedAmount!, 0) <= tuitionTotal(lines)) {
      for (const term of free) out.set(term.id, term.allocatedAmount!);
    }
  }
  return out;
}
