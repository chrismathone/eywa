import type { ReceiptAllocationDraft, ReceiptLine } from "./receipt-allocation";
import { isTuitionReceipt } from "./tuition-receipt";

type RawLine = Record<string, unknown>;
const raw = (value: unknown): RawLine => value && typeof value === "object" ? value as RawLine : {};
export function receiptIdentity(value: unknown): string {
  const line = raw(value);
  return JSON.stringify([line.kind ?? "", line.classId ?? "", String(line.description ?? line.name ?? "").trim().replace(/\s+/g, " "), line.receiptGroupId ?? ""]);
}
export function receiptGroupId(line: ReceiptLine): string | null {
  const id = raw(line.source).receiptGroupId;
  return typeof id === "string" ? id : null;
}
export function canMergeReceipt(line: ReceiptLine): boolean {
  const source = raw(line.source);
  return isTuitionReceipt(line.source)
    && ["amount", "discount", "points", "paid", "unpaid"].every((key) => {
      const value = source[key];
      return !(key in source) && !["amount", "paid", "unpaid"].includes(key)
        || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    });
}
function originals(value: unknown): unknown[] {
  const sources = raw(value).sourceItems;
  return Array.isArray(sources) && sources.length ? sources : [value];
}
/** 합산 직전 입력 중이던 배분금액은 보존하고, 항목 번호만 새 위치로 옮긴다. */
export function remapReceiptDraft(before: ReceiptLine[], after: ReceiptLine[], draft: ReceiptAllocationDraft): ReceiptAllocationDraft {
  return Object.fromEntries(Object.entries(draft).map(([id, row]) => {
    const previous = row.line === "" ? null : before.find((line) => String(line.index) === row.line);
    if (!previous) return [id, row];
    const targets = after.filter((line) => receiptIdentity(line.source) === receiptIdentity(previous.source)
      || receiptGroupId(line) && originals(previous.source).every((p) => originals(line.source).some((n) => receiptIdentity(p) === receiptIdentity(n))));
    return [id, { ...row, line: targets.length === 1 ? String(targets[0].index) : "" }];
  }));
}

export function enrollmentPeriodLabel(period: string, records: { start_date: string; end_date: string | null }[], today: string): string {
  records = records.filter((r) => r.start_date.slice(0, 7) <= period && (!r.end_date || r.end_date >= `${period}-01`));
  if (!records.length) return `${Number(period.slice(5, 7))}월 수강 없음`;
  const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  return [...records].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((r) => {
    const from = r.start_date < `${period}-01` ? `${period}-01` : r.start_date;
    const end = r.end_date;
    const status = end && end < today ? "종료" : end && end.startsWith(period) ? "종료 예정" : "수강 중";
    return `${short(from)}~${end?.startsWith(period) ? short(end) : ""} · ${status}`;
  }).join(" / ");
}
