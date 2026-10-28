/**
 * 메이크에듀 수납 원자료(0384a `makeedu_history_bills`) → '지난 기록' 청구서 모양 — 운영자 스크립트(`scripts/_makeedu/rebuild-history-monthly.mts`)가
 * 메이크에듀 줄을 다시 셀 때 쓰는 규칙. 순수 함수(Vitest).
 *
 * 원장 2026-10-28 *"EiE라고 되어있는데. 수납명에 교재를 보면 그 학생이 EiE 수업인지 판단가능함"* · *"LE도 줄임말이고"* ·
 * *"청구건수가 이상할정도로 적은달은 건너뛰는게 차라리 나음. 애매한것보다"*.
 *  · 2025-05 전엔 EiE·일부 과목 수업료가 **'교재' 구분**으로 청구됐다('ROOKIES (LE) 월수목 Aaron' 낸 돈 234,000 · 메모 '수강료') — 교재 줄 중
 *    요일·시간·nT 표기가 있거나 낸 돈 8만 원 이상이면 수업료(진짜 교재비는 3~4만 원 · '[EiE] Let`s Speak 1' 39,000).
 *  · 그 시기 기타 항목의 청구액 칸은 연도 숫자(2,023 · 2,024)라 믿을 수 없다 — 그 줄은 **낸 돈**을 금액으로.
 *  · EiE 수업명 — ROOKIES·LEADERS·PHONICS·Let's·Pre Let's(레벨 줄임말 (LE)·(LT)·(PL)·(LS)·(JP)는 이 낱말과 함께 나온다) → `[EiE]`를 붙여
 *    앱의 EiE 판정(`isEieLesson`)에 그대로 태운다.
 */
import type { HistoryInvoice } from "./history-aywa";

export type HistoryBill = {
  makeedu_no: string | number;
  bill_month: Date | string;
  item_kind: string | null;
  category: string | null;
  item_name: string | null;
  billed: string | number | null;
  discount: string | number | null;
  points: string | number | null;
  paid: string | number | null;
};
export type HistoryLine = { kind: string; amount: number; paid: number; description: string };

/** 요일 묶음('월수목')·매일·'(금)'·'3T'·'8:00' — 수업 표시. */
const LESSON_MARK = /[월화수목금토일]{2,}|매일|\(\s*[월화수목금토일]\s*\)|\d\s*T\b|\d{1,2}:\d{2}/;
const EIE_WORD = /\beie\b|rookie|leader|phonics|\blet.?s\b|pre\s*let/i;
/** 교재 구분인데 수업료로 볼 낸 돈 하한 — 진짜 교재비(3~4만 원)와 수업료(16~27만 원) 사이. */
export const BOOK_TUITION_MIN = 80_000;
/**
 * 수납명 단위 — 낸 돈이 있는 줄 중 이 몫 이상이 하한 이상이면 그 이름은 수업료(나눠 낸 줄 '75,000·50,000'도 같은 수업료 · 리뷰 2026-10-28 실측
 * 약 150줄). 침산: 수업료 이름은 가장 낮은 것이 29%('매쓰몽 사고력정규/강아 화 Jinny' — 7만5천 원 반), 교재 묶음 이름은 0.2% 아래
 * ('[EiE] ROOKIES&LEADERS' 1,417줄 중 1줄만 27만 원) — 그 사이.
 */
export const BOOK_TUITION_SHARE = 0.2;

const ym = (d: Date | string) => (typeof d === "string" ? d.slice(0, 7) : d.toISOString().slice(0, 7));
const isBookLine = (b: HistoryBill) => b.item_kind !== "lesson" && b.category === "교재";

/** 교재 구분 수납명 중 수업료인 이름 — 수업 표시가 있거나, 낸 돈이 있는 줄의 `BOOK_TUITION_SHARE` 이상이 하한 이상. */
export function bookTuitionNames(bills: readonly HistoryBill[]): Set<string> {
  const tally = new Map<string, { paid: number; big: number }>();
  for (const b of bills) {
    if (!isBookLine(b) || Number(b.paid ?? 0) <= 0) continue;
    const name = String(b.item_name ?? "");
    const t = tally.get(name) ?? tally.set(name, { paid: 0, big: 0 }).get(name)!;
    t.paid++;
    if (Number(b.paid) >= BOOK_TUITION_MIN) t.big++;
  }
  const out = new Set<string>();
  for (const b of bills) {
    if (!isBookLine(b)) continue;
    const name = String(b.item_name ?? "");
    const t = tally.get(name);
    if (LESSON_MARK.test(name) || (t && t.big / t.paid >= BOOK_TUITION_SHARE)) out.add(name);
  }
  return out;
}

/**
 * 수납 한 줄 → 청구 줄. `tuitionNames` = 교재 구분 중 수업료인 수납명(`bookTuitionNames` — 주지 않으면 이 줄 하나로 판정).
 * 교재 구분 수업료의 낸 돈이 0인 줄(침산 187줄 · 미납액·할인 칸도 0)은 금액 0 — '수업' 구분 0원 줄과 같은 뜻으로 세지 않는다.
 */
export function historyLine(b: HistoryBill, tuitionNames: ReadonlySet<string> = bookTuitionNames([b])): HistoryLine {
  const name = String(b.item_name ?? "");
  const paid = Number(b.paid ?? 0);
  const bookTuition = isBookLine(b) && tuitionNames.has(name);
  const lesson = b.item_kind === "lesson" || bookTuition;
  // EiE 낱말은 교재 구분에서 수업료가 된 줄에만('수업' 구분 EiE는 이미 `[EiE]`로 적혔다 — 인재원 'Phonics' 수업을 EiE로 넘기지 않게).
  const eie = bookTuition && !/^\s*\[eie\]/i.test(name) && EIE_WORD.test(name);
  const amount = bookTuition ? paid : Number(b.billed ?? 0) - Number(b.discount ?? 0) - Number(b.points ?? 0);
  return { kind: lesson ? "수업" : String(b.category ?? "기타"), amount, paid, description: eie ? `[EiE] ${name}` : name };
}

/** 학생(원생번호)·청구월마다 청구서 한 장. */
export function historyInvoices(bills: readonly HistoryBill[]): (HistoryInvoice & { line_items: HistoryLine[] })[] {
  const byKey = new Map<string, HistoryInvoice & { line_items: HistoryLine[] }>();
  const tuitionNames = bookTuitionNames(bills);
  for (const b of bills) {
    const period = ym(b.bill_month);
    const key = `${b.makeedu_no}|${period}`;
    const inv = byKey.get(key) ?? { student_id: String(b.makeedu_no), period, status: "issued", category: "tuition", line_items: [], amount_total: 0, amount_paid: 0 };
    const line = historyLine(b, tuitionNames);
    inv.line_items.push(line);
    inv.amount_total = Number(inv.amount_total) + line.amount;
    inv.amount_paid = Number(inv.amount_paid) + line.paid;
    byKey.set(key, inv);
  }
  return [...byKey.values()];
}

/**
 * 청구가 비정상으로 적은 달 — 앞뒤 3개월(있는 만큼) 학생 수 중앙값의 `ratio` 미만. 침산: 2025-04(23% · 청구 방식이 바뀐 달) ·
 * 2020-02(55% · 대구 코로나 휴원기 — 원장 2026-10-28 *"2020년 2월도 비울것"*) 둘만 걸린다(그다음 낮은 달이 85%).
 */
export function lowBillingMonths(totals: ReadonlyMap<string, number>, months: readonly string[], ratio = 0.6): string[] {
  const out: string[] = [];
  months.forEach((m, i) => {
    const around = [...months.slice(Math.max(0, i - 3), i), ...months.slice(i + 1, i + 4)].map((x) => totals.get(x) ?? 0).sort((a, b) => a - b);
    const med = around[Math.floor(around.length / 2)] ?? 0;
    if (med > 0 && (totals.get(m) ?? 0) / med < ratio) out.push(m);
  });
  return out;
}
