/**
 * 수납 항목 읽기 — 실납액, 과목, 반 연결. 매출 배분(revenue.ts)이 쓰는 순수 도구.
 * 과목·반은 분명할 때만 정한다. 비슷한 이름으로 짐작해 잇지 않는다.
 */
import { receiptMatchesClass } from "@/features/billing/session-terms/receipt-suggestion";
import { DEFAULT_ENGLISH_LEVELS, parseClassName } from "@/features/timetable/lib/level";
import { round1 } from "./dates";
import type { SnapshotClass } from "./types";

export type Line = Record<string, unknown>;
export const asLine = (value: unknown): Line => (value && typeof value === "object" ? (value as Line) : {});
export const sum = (values: readonly number[]) => values.reduce((n, x) => n + x, 0);
const textOf = (line: Line) => String(line.description ?? line.name ?? "");

export const isTuitionLine = (line: unknown) => ["", "수업", "수강료", "tuition"].includes(String(asLine(line).kind ?? ""));
/** 과목 매출의 30% 이상이면 10점. 그 아래는 비중 ÷ 0.3 × 10. */
export const revenuePoints = (amount: number, total: number) =>
  total > 0 ? (amount / total >= 0.3 ? 10 : Math.min(9.9, round1(Math.max(0, (amount / total / 0.3) * 10)))) : 0;

/**
 * 과목이 문구로 분명할 때만 돌려준다. 수납 가져오기의 '모르면 수학' 기본값은 쓰지 않는다.
 * 지난 수납의 '수학(심화)'도 수학이다 — 그 과목을 없앴다(원장 2026-10-30 "전부 수학").
 */
export function receiptSubject(source: unknown): string | null {
  const s = textOf(asLine(source));
  const hits: (string | null)[] = [];
  if (/과학|\bscience\b/i.test(s)) hits.push("science");
  if (/국어|\bkorean\b/i.test(s)) hits.push("korean");
  if (/\beie\b|영어|\benglish\b|(?:초등|중등|고등|중고)E(?:[_\s]|$)/i.test(s)) hits.push("english");
  if (/수학|\bmath\b|\[강아\]|강의하는\s*아이들|(?:초등|중등|고등|중고)M(?:[_\s]|$)/i.test(s)) hits.push("math");
  return hits.length === 1 ? hits[0] : null;
}

export function netReceipt(source: unknown): number {
  const x = asLine(source);
  if (Array.isArray(x.sourceItems) && x.sourceItems.length) return sum(x.sourceItems.map(netReceipt));
  const refunds = (Array.isArray(x.refunds) ? x.refunds.map(asLine) : []).filter((r) => r.status === "active");
  if (refunds.some((r) => r.type === "full")) return 0;
  return Math.max(0, Math.round((Number(x.amount) || 0) - (Number(x.discount) || 0) - sum(refunds.map((r) => Math.max(0, Number(r.amount) || 0)))));
}

export function matchesClass(source: unknown, c: Pick<SnapshotClass, "id" | "class_name">): boolean {
  const line = asLine(source);
  const name = c.class_name.replace(/\s*\(~.*\)\s*$/, "");
  if (receiptMatchesClass(line, { classId: c.id, className: name })) return true;
  if (line.classId) return false;
  const desc = textOf(line);
  const level = parseClassName(name);
  const def = DEFAULT_ENGLISH_LEVELS.find((l) => l.abbreviation === level?.levelAbbr);
  if (def && level) {
    const clean = desc.replace(/^\s*\[eie\]\s*/i, "");
    if (receiptMatchesClass({ ...line, description: clean }, { classId: c.id, className: `${def.fullName} ${level.number}${level.suffix}` })) return true;
  }
  // 영숫자 반 코드가 정확히 하나일 때만. 학년·강사 이름으로 비슷하게 맞추지 않는다.
  const codes = name.match(/(?:^|[\s가-힣(])([A-Z]{1,5}\d[A-Z0-9]*)(?=$|[\s)])/g)?.map((s) => s.trim().replace(/^[가-힣(]+/, "")) ?? [];
  return codes.length === 1 && desc.split(/\s+/).includes(codes[0]);
}
