// 할인은 학부모 혜택이다. 반별 급여 기준의 배분 총액은 할인 전 청구액이다.
export type ReceiptLine = { index: number; description: string; kind: string; amount: number; source: unknown };
export type AllocationTerm = {
  id: string; amount: number | null; confirmedSessions: number | null;
  lineIndex: number | null; allocatedAmount: number | null; source: unknown; baseAmount: number | null;
};

export function receiptLines(raw: unknown): ReceiptLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((source, index) => {
    const line = (source ?? {}) as Record<string, unknown>;
    return { index, description: String(line.description ?? line.name ?? ""), kind: String(line.kind ?? ""), amount: Math.round(Number(line.amount) || 0), source };
  });
}

/** 객체 키 순서나 할인·납부 기록 갱신은 배분 근거(청구액·항목명)를 바꾸지 않는다. */
function sameBill(a: unknown, b: unknown): boolean {
  const shape = (value: unknown) => {
    const row = receiptLines([value])[0];
    return `${row.kind}\n${row.description}\n${row.amount}`;
  };
  return a != null && b != null && shape(a) === shape(b);
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

/** 동기화·재확정으로 근거가 바뀌거나 그룹 합계가 깨졌으면 급여에서 사용하지 않는다. */
export function effectiveAllocations(lines: ReceiptLine[], terms: AllocationTerm[]): Map<string, number> {
  const groups = new Map<number, AllocationTerm[]>();
  for (const term of terms) if (term.lineIndex !== null) {
    (groups.get(term.lineIndex) ?? groups.set(term.lineIndex, []).get(term.lineIndex)!).push(term);
  }
  const out = new Map<string, number>();
  for (const [index, group] of groups) {
    const line = lines.find((row) => row.index === index);
    if (!line || line.amount < 0) continue;
    if (group.some((term) => term.confirmedSessions === null || term.allocatedAmount === null || !Number.isSafeInteger(term.allocatedAmount) || term.allocatedAmount < 0 || term.baseAmount !== term.amount || !sameBill(term.source, line.source))) continue;
    if (group.reduce((sum, term) => sum + term.allocatedAmount!, 0) !== line.amount) continue;
    for (const term of group) out.set(term.id, term.allocatedAmount!);
  }
  return out;
}
