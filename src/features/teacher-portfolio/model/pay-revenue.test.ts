import { describe, expect, it } from "vitest";
import type { LineItemLike } from "@/features/billing/session-terms/class-amount";
import { rowRevenue, soleLeftover, type RevenueInvoice } from "./pay-revenue";

/** 매출 = 줄마다 그 달 청구액 — 회차 행이 있으면 출석부 청구액, 없으면 청구서 항목을 반에 맞춘 금액(원장 2026-10-14). */
const items = [{ description: "중등M 중2 PS2S 화목", amount: 300_000 }, { description: "중등M 중2 PA1B 월수", amount: 200_000 }];
const inv = (over: Partial<RevenueInvoice> = {}): RevenueInvoice => ({
  items, termClassIds: new Set(), freeAllocated: false, allocatedClassIds: new Set(), allocatedLines: new Set(), ...over,
});
const row = (invoices: RevenueInvoice[], billed?: number) => rowRevenue({ classId: "c1", className: "중등M 중2 PS2S", billed, invoices, enrolled: true });

describe("매출 대비 급여 — 줄 하나의 청구액", () => {
  it("회차 행이 없으면 청구서 항목을 반 코드로 맞춘 금액 — 회차 확정을 기다리지 않는다", () => {
    expect(row([inv()])).toBe(300_000);
  });
  it("회차 행이 있는 청구서는 출석부 청구액 그대로 · 다른 청구서는 따로 맞춘다", () => {
    expect(row([inv({ termClassIds: new Set(["c1"]) })], 280_000)).toBe(280_000);
    expect(row([inv({ termClassIds: new Set(["c1"]) }), inv()], 280_000)).toBe(580_000);
  });
  it("자유 배분이 있는 청구서는 회차 행이 없는 반을 이름으로 채우지도, 0원으로 세지도 않는다", () => {
    expect(row([inv({ freeAllocated: true, termClassIds: new Set(["c2"]) })])).toBeNull();
  });
  it("맞춘 항목이 없으면 null — 0원을 지어내지 않는다 · 짝이 이 반이면 그 금액", () => {
    const pl5 = { classId: "e1", className: "PL5", billed: undefined, invoices: [inv()], enrolled: true };
    expect(rowRevenue(pl5)).toBeNull();
    expect(row([inv({ termClassIds: new Set(["c1"]) })])).toBeNull();
    expect(rowRevenue({ ...pl5, sole: { classId: "e1", amount: 250_000 } })).toBe(250_000);
    expect(rowRevenue({ ...pl5, sole: { classId: "e2", amount: 250_000 } })).toBeNull();
    // 이름으로 맞춘 금액이 있으면 짝은 쓰지 않는다.
    expect(rowRevenue({ classId: "c1", className: "중등M 중2 PS2S", billed: undefined, invoices: [inv()], enrolled: true, sole: { classId: "c1", amount: 1 } })).toBe(300_000);
  });
  it("그 반 수강이 없는 줄(보강 방문)은 출석부 청구액만 — 같은 코드 분반에서 자기 반 항목이 또 잡히지 않게", () => {
    const visit = { classId: "c9", className: "중등M 중2 PS2S-1", billed: undefined, invoices: [inv()], enrolled: false };
    expect(rowRevenue({ ...visit, enrolled: true })).toBe(300_000);
    expect(rowRevenue(visit)).toBeNull();
    expect(rowRevenue({ ...visit, billed: 50_000 })).toBe(50_000);
    expect(rowRevenue({ ...visit, sole: { classId: "c9", amount: 1 } })).toBeNull();
  });
});

describe("짝이 하나뿐인 청구서 항목 — 이름이 안 맞는 영어 항목을 회차 확정 없이", () => {
  const eie = [
    { kind: "수업", description: "중등M 중2 PS2S 화목", amount: 300_000 },
    { kind: "수업", description: "[EiE] Pre Let's 5", amount: 250_000 },
    { kind: "수업", description: "[EiE] PHONICS&ROOKIES 40,000", amount: 40_000 }, // 프로그램 비용 — 수강료 아님
    { kind: "기타", description: "스쿨버스비", amount: 30_000 },
  ];
  const classes = [{ id: "m1", name: "중등M 중2 PS2S", open: true }, { id: "e1", name: "PL5", open: true }];
  it("못 맞춘 반 하나 · 남은 수강료 항목 하나면 그 짝", () => {
    expect(soleLeftover(classes, [inv({ items: eie })])).toEqual({ classId: "e1", amount: 250_000 });
  });
  it("못 맞춘 반이 둘이면(반 이동한 달 등) 짓지 않는다 · 그 달 안 다니는 반(휴원·앞뒤 달)은 짝을 받지 않는다", () => {
    expect(soleLeftover([...classes, { id: "e2", name: "PL2a", open: true }], [inv({ items: eie })])).toBeNull();
    expect(soleLeftover([...classes, { id: "e2", name: "PL2a", open: false }], [inv({ items: eie })])).toEqual({ classId: "e1", amount: 250_000 });
    expect(soleLeftover([classes[0]!, { id: "e1", name: "PL5", open: false }], [inv({ items: eie })])).toBeNull();
  });
  it("남은 수강료 항목이 둘이거나 없으면 짓지 않는다", () => {
    expect(soleLeftover(classes, [inv({ items: [...eie, { kind: "수업", description: "[EiE] Let's Talk 5", amount: 1 } as LineItemLike] })])).toBeNull();
    expect(soleLeftover(classes, [inv({ items: eie.filter((x) => !String(x.description).startsWith("[EiE] Pre")) })])).toBeNull();
  });
  it("앞뒤 달 반 이름에 맞는 항목은 남은 항목이 아니다(다음 달 반 선납 등)", () => {
    const prepaid = [...eie, { kind: "수업", description: "겨울특강 수학", amount: 400_000 } as LineItemLike];
    expect(soleLeftover(classes, [inv({ items: prepaid })])).toBeNull();
    expect(soleLeftover([...classes, { id: "w1", name: "겨울특강 수학", open: false }], [inv({ items: prepaid })])).toEqual({ classId: "e1", amount: 250_000 });
  });
  it("부분 환불로 금액을 못 정한 항목도 그 반 것 — 그 반이 남의 항목을 받지 않는다", () => {
    const refunded = { kind: "수업", description: "중등M 중2 PS2S 화목", amount: 300_000, refunds: [{ status: "active", type: "partial", amount: 10_000 }] };
    const special = { kind: "수업", description: "겨울특강 수학", amount: 400_000 };
    expect(soleLeftover([classes[0]!], [inv({ items: [refunded, special] as LineItemLike[] })])).toBeNull();
  });
  it("배분이 걸린 항목·배분을 받은 반 · 자유 배분 청구서는 짝 후보가 아니다", () => {
    expect(soleLeftover(classes, [inv({ items: eie, allocatedLines: new Set([1]) })])).toBeNull();
    expect(soleLeftover(classes, [inv({ items: eie, allocatedClassIds: new Set(["e1"]) })])).toBeNull();
    expect(soleLeftover(classes, [inv({ items: eie, freeAllocated: true })])).toBeNull();
  });
  it("같은 반 수강이 두 줄이어도 반 하나로 센다", () => {
    expect(soleLeftover([...classes, { id: "e1", name: "PL5", open: true }], [inv({ items: eie })])).toEqual({ classId: "e1", amount: 250_000 });
  });
});
