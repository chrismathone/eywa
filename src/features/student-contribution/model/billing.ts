import { isLiveTuition, lessonKinds, lessonPaid, type HistoryInvoice } from "@/features/students/stats/history-aywa";
import { emptyRaws, type Raws } from "./config";
import { isMonth } from "./dates";
import { isOtherContributionItem } from "./other-items";

export type ContributionInvoice = HistoryInvoice & { id: string };
export type SubjectResolution = { billId: string; month: string; name: string; subject: string; basis: string; reference: string };
export type HistoricalBill = { id: string; studentId: string; month: string; lesson: boolean; billed: number; name?: string;
  paid: number; refunded: boolean; subject: string | null; subjectResolutions?: SubjectResolution[] };
export type BillingSeed = { id: string; studentId: string; month: string; tuitionWon: number; subjects: string[];
  active: boolean; evidenceIds: string[]; unknownSubjects: number; unknownNames?: string[]; subjectResolutions?: SubjectResolution[] };
export type BillingMonth = { studentId: string; month: string; raws: Raws; evidenceIds: string[]; unknownSubjects: number; seed: BillingSeed };
type Item = Record<string, unknown>;
const isLesson = (x: Item) => x.kind == null || x.kind === "" || x.kind === "수업" || x.kind === "tuition";

/** 청구 달을 사용한다. 실제 휴원 기간·수업일 수로 해석하지 않는다(D6, 최종 5절). */
export function billingMonths(input: {
  invoices: readonly ContributionInvoice[]; history: readonly HistoricalBill[]; through: string;
  /** 지점의 신뢰할 에이와 청구 시작 달. 이 달부터는 취소/빈 청구도 옛 청구로 되살리지 않는다. */
  aywaFrom: string; subjectOf: (item: Item) => string | null;
  cachedHistory?: readonly BillingSeed[];
}) {
  if (!isMonth(input.through) || !isMonth(input.aywaFrom)) throw new RangeError("Invalid billing month");
  const rows = new Map<string, Omit<BillingMonth, "seed"> & { active: boolean; subjects: Set<string>; unknownNames: Set<string>; subjectResolutions: SubjectResolution[] }>();
  const get = (studentId: string, month: string) => {
    const key = `${studentId}\0${month}`;
    if (!rows.has(key)) rows.set(key, { studentId, month, raws: emptyRaws(), evidenceIds: [], unknownSubjects: 0, active: false, subjects: new Set(), unknownNames: new Set(), subjectResolutions: [] });
    return rows.get(key)!;
  };
  const seen = new Set<string>();
  if (input.history.length && input.cachedHistory?.length) throw new Error("지난 청구 원본과 캐시를 동시에 합칠 수 없습니다");
  for (const seed of input.cachedHistory ?? []) {
    if (seen.has(`seed:${seed.id}`) || seed.month >= input.aywaFrom || seed.month > input.through) continue;
    seen.add(`seed:${seed.id}`);
    const row = get(seed.studentId, seed.month);
    row.raws.tuitionWon += seed.tuitionWon;
    row.active ||= seed.active;
    seed.subjects.forEach((s) => row.subjects.add(s));
    row.evidenceIds.push(...seed.evidenceIds);
    row.unknownSubjects += seed.unknownSubjects;
    seed.unknownNames?.forEach(name => row.unknownNames.add(name));
    row.subjectResolutions.push(...(seed.subjectResolutions ?? []));
  }
  const historicalBalances = new Map<string, Map<string | null, number>>();
  for (const bill of input.history) {
    if (!bill.lesson || isOtherContributionItem(bill.name ?? "") || !isMonth(bill.month) || bill.month >= input.aywaFrom || bill.month > input.through || seen.has(`h:${bill.id}`)) continue;
    seen.add(`h:${bill.id}`);
    const row = get(bill.studentId, bill.month);
    // 메이크에듀 환불 줄의 paid는 양수로 수집된다. 환불 줄 자체를 양의 수납으로 세지 않는다.
    row.raws.tuitionWon += bill.refunded ? -Math.abs(bill.paid) : bill.paid;
    row.evidenceIds.push(`history:${bill.id}`);
    row.subjectResolutions.push(...(bill.subjectResolutions ?? []));
    if (!bill.subject && bill.name) row.unknownNames.add(bill.name);
    const key = `${bill.studentId}\0${bill.month}`;
    const balance = historicalBalances.get(key) ?? new Map<string | null, number>();
    const amount = bill.refunded ? -Math.abs(bill.paid) : bill.paid < 0 ? bill.paid : Math.max(bill.billed, bill.paid);
    balance.set(bill.subject, (balance.get(bill.subject) ?? 0) + amount);
    historicalBalances.set(key, balance);
  }
  for (const [key, balances] of historicalBalances) {
    const row = rows.get(key)!;
    // 전액 환불된 달을 재원·과목 달로 남기지 않는다. 미납 청구는 여전히 살아 있는 달이다.
    if ([...balances.values()].reduce((sum, value) => sum + value, 0) <= 0) continue;
    row.active = true;
    for (const [subject, amount] of balances) if (amount > 0) {
      if (subject) row.subjects.add(subject); else row.unknownSubjects++;
    }
  }
  for (const source of input.invoices) {
    const invoice = { ...source, line_items: Array.isArray(source.line_items) ? source.line_items.map(item =>
      item && typeof item === "object" && isOtherContributionItem(String((item as Item).description ?? (item as Item).label ?? (item as Item).name ?? ""))
        ? { ...item, kind: "other" } : item) : source.line_items };
    const month = invoice.period;
    if (!month || !isMonth(month) || month < input.aywaFrom || month > input.through || seen.has(`a:${invoice.id}`)) continue;
    seen.add(`a:${invoice.id}`);
    if (!isLiveTuition(invoice)) continue;
    const row = get(invoice.student_id, month);
    const paid = lessonPaid(invoice.line_items, invoice.amount_paid);
    row.raws.tuitionWon += paid.general + paid.eie;
    row.evidenceIds.push(`invoice:${invoice.id}`);
    const kinds = lessonKinds(invoice.line_items, invoice.amount_total);
    row.active ||= kinds.general || kinds.eie;
    const items = (Array.isArray(invoice.line_items) ? invoice.line_items : []).filter((x): x is Item => !!x && typeof x === "object");
    if (!items.length && row.active) row.unknownSubjects++;
    for (const item of items) {
      if (!isLesson(item) || (Number(item.amount ?? 0) <= 0 && Number(item.paid ?? 0) <= 0)) continue;
      const subject = input.subjectOf(item);
      if (subject) row.subjects.add(subject); else { row.unknownSubjects++; row.unknownNames.add(String(item.description ?? item.label ?? item.name ?? "수업명 없음")); }
    }
  }
  const tenure = new Map<string, number>();
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.studentId.localeCompare(b.studentId)).map((row): BillingMonth => {
    row.raws.subjectMonths = row.subjects.size;
    if (row.active) {
      const months = (tenure.get(row.studentId) ?? 0) + 1;
      tenure.set(row.studentId, months);
      row.raws.tenureYears = months % 12 === 0 ? 1 : 0;
    }
    const seed: BillingSeed = { id: `${row.studentId}:${row.month}`, studentId: row.studentId, month: row.month,
      tuitionWon: row.raws.tuitionWon, subjects: [...row.subjects].sort(), active: row.active,
      evidenceIds: [...new Set(row.evidenceIds)], unknownSubjects: row.unknownSubjects, unknownNames: row.unknownSubjects ? [...row.unknownNames].sort() : [],
      ...(row.subjectResolutions.length ? { subjectResolutions: row.subjectResolutions } : {}) };
    return { studentId: row.studentId, month: row.month, raws: row.raws, evidenceIds: seed.evidenceIds, unknownSubjects: row.unknownSubjects, seed };
  });
}
