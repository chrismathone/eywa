import { describe, expect, it } from "vitest";
import { bookTuitionNames, historyInvoices, historyLine, lowBillingMonths, type HistoryBill } from "./makeedu-history-bills";
import { isEieLesson } from "./lesson-program";

const bill = (over: Partial<HistoryBill>): HistoryBill => ({
  makeedu_no: 1, bill_month: "2023-01-01", item_kind: "other", category: "교재", item_name: "", billed: 2023, discount: 0, points: 0, paid: 0, ...over,
});

describe("메이크에듀 수납 → 지난 기록 청구 줄(원장 2026-10-28)", () => {
  it("🔴 2025-05 전 '교재' 구분 EiE 수업료 = 수업 · `[EiE]` · 금액은 낸 돈(그 시기 청구액 칸은 연도 숫자)", () => {
    const l = historyLine(bill({ item_name: "ROOKIES (LE) 월수목 Aaron", paid: 234000 }));
    expect(l).toEqual({ kind: "수업", amount: 234000, paid: 234000, description: "[EiE] ROOKIES (LE) 월수목 Aaron" });
    expect(isEieLesson(l.description)).toBe(true);
    expect(historyLine(bill({ item_name: "[EIE] ROOKIES 3T 화수금", paid: 270000 })).description).toBe("[EIE] ROOKIES 3T 화수금"); // 이미 표시 — 두 번 붙이지 않는다
    expect(historyLine(bill({ item_name: "PHONICS 5T (2:00~3:20) Joy", paid: 200000 })).kind).toBe("수업");
  });

  it("진짜 교재비(수업 표시 없음 · 8만 원 미만)는 교재 그대로 — EiE 교재도", () => {
    expect(historyLine(bill({ item_name: "[EiE] Let`s Speak 1", paid: 39000 }))).toMatchObject({ kind: "교재", amount: 2023 });
    expect(historyLine(bill({ item_name: "중2-2 중간 내신대비(ALL-KILL)", paid: 15000 })).kind).toBe("교재");
  });

  it("교재 구분 다른 과목 수업료 = 수업(EiE 아님) · 수업 구분은 청구액 − 할인 − 적립금", () => {
    expect(historyLine(bill({ item_name: "(NEW) 중3 국어 화금2T 8:00", paid: 180000 }))).toEqual({ kind: "수업", amount: 180000, paid: 180000, description: "(NEW) 중3 국어 화금2T 8:00" });
    expect(historyLine(bill({ item_name: "매쓰몽 사고력", paid: 100000 })).kind).toBe("수업"); // 8만 원 이상
    expect(historyLine(bill({ item_kind: "lesson", category: "수업", item_name: "수학 A", billed: 300000, discount: 20000, points: 5000, paid: 275000 }))).toMatchObject({ kind: "수업", amount: 275000 });
    expect(historyLine(bill({ category: "차량비", item_name: "차량비 월수금", paid: 50000 })).kind).toBe("차량비"); // 교재 구분만
  });

  it("🔴 수납명 단위 — 같은 이름 줄의 20% 이상이 8만 원 이상이면 나눠 낸 줄(7만5천·5만)도 수업료 · 교재 묶음 이름의 큰 한 줄은 교재 그대로(리뷰 2026-10-28)", () => {
    const split = (paid: number, no = 1) => bill({ makeedu_no: no, item_name: "매쓰몽 사고력정규/동화 월 Jinny", paid });
    const bundle = (paid: number, no = 9) => bill({ makeedu_no: no, item_name: "[EiE] ROOKIES&LEADERS", paid });
    const bills = [split(110000), split(110000, 2), split(75000, 3), split(50000, 4), ...Array.from({ length: 30 }, (_, i) => bundle(39000, 10 + i)), bundle(270000)];
    const names = bookTuitionNames(bills);
    expect(names.has("매쓰몽 사고력정규/동화 월 Jinny")).toBe(true);
    expect(names.has("[EiE] ROOKIES&LEADERS")).toBe(false);
    const lines = historyInvoices(bills).flatMap((i) => i.line_items);
    expect(lines.filter((l) => l.description.startsWith("매쓰몽")).map((l) => [l.kind, l.amount])).toEqual([["수업", 110000], ["수업", 110000], ["수업", 75000], ["수업", 50000]]);
    expect(lines.find((l) => l.paid === 270000)!.kind).toBe("교재");
  });

  it("EiE 낱말은 교재 구분에서 수업료가 된 줄에만 — '수업' 구분 인재원 'Phonics' 수업은 EiE로 넘기지 않는다 · 'Tablets'는 Let's가 아니다", () => {
    expect(historyLine(bill({ item_kind: "lesson", category: "수업", item_name: "초등 Phonics 정규 월수", billed: 200000 })).description).toBe("초등 Phonics 정규 월수");
    expect(historyLine(bill({ item_name: "Tablets 코딩 월수", paid: 150000 })).description).toBe("Tablets 코딩 월수");
  });

  it("학생·청구월마다 한 장", () => {
    const invs = historyInvoices([
      bill({ makeedu_no: 7, bill_month: new Date("2023-01-01T00:00:00Z"), item_name: "ROOKIES (LE) 월수목 Aaron", paid: 234000 }),
      bill({ makeedu_no: 7, bill_month: "2023-01-01", item_name: "[EiE] Let`s Express 2", paid: 39000 }),
      bill({ makeedu_no: 7, bill_month: "2023-02-01", item_name: "ROOKIES (LE) 월수목 Aaron", paid: 234000 }),
    ]);
    expect(invs.map((i) => [i.student_id, i.period, i.line_items.length])).toEqual([["7", "2023-01", 2], ["7", "2023-02", 1]]);
  });

  it("🔴 비정상으로 적은 달 — 앞뒤 3개월 중앙값의 60% 미만(2025-04 23% · 코로나 휴원기 2020-02 55% — 원장 '2020년 2월도 비울것') · 85%는 둔다", () => {
    const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"];
    const totals = new Map([["2025-01", 339], ["2025-02", 327], ["2025-03", 388], ["2025-04", 97], ["2025-05", 416], ["2025-06", 424], ["2025-07", 426]]);
    expect(lowBillingMonths(totals, months)).toEqual(["2025-04"]);
    const covid = new Map([["2020-01", 342], ["2020-02", 161], ["2020-03", 256], ["2020-04", 262], ["2020-05", 295], ["2020-06", 309], ["2020-07", 315]]);
    expect(lowBillingMonths(covid, [...covid.keys()])).toEqual(["2020-02"]); // 2020-03 87% · 2020-04 85%는 진짜로 줄어든 달
  });
});
