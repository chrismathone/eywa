import { describe, expect, it } from "vitest";
import { absenceClassOf, pickReservationHost, type ReservationHost } from "./makeup-reservation";

// 보강 예약 '기록할 반'(원장 2026-10-22) — 기본값은 추측하지 않는다('+ 보강 학생 추가'의 defaultHostClassId와 같은 결).
const h = (classId: string, absenceClass = false): ReservationHost => ({ classId, className: classId, absenceClass });

describe("pickReservationHost", () => {
  it("고른 반이 후보면 그 반", () => {
    expect(pickReservationHost([h("JJ2B", true), h("JJ2G")], "JJ2G")).toBe("JJ2G");
  });
  it("고르지 않았거나 후보가 아니면 결석난 반(후보일 때)", () => {
    expect(pickReservationHost([h("BS2G", true), h("JJ2G")], null)).toBe("BS2G");
    expect(pickReservationHost([h("BS2G", true), h("JJ2G")], "남의반")).toBe("BS2G");
  });
  it("결석난 반이 닫혔으면(후보 아님) 하나뿐인 후보 — 전주율 JJ2B → JJ2G", () => {
    expect(pickReservationHost([h("JJ2G")], null)).toBe("JJ2G");
  });
  it("결석난 반이 후보가 아니고 후보가 둘 이상이면 고르기 전(null)", () => {
    expect(pickReservationHost([h("A"), h("B")], null)).toBeNull();
    expect(pickReservationHost([], null)).toBeNull();
  });
});

describe("absenceClassOf", () => {
  it("결석난 반이 따로 적혀 있으면 그 반, 없으면(옛 예약 · 같은 반) 기록할 반", () => {
    expect(absenceClassOf({ classId: "JJ2G", absenceClassId: "JJ2B" })).toBe("JJ2B");
    expect(absenceClassOf({ classId: "BS2G", absenceClassId: null })).toBe("BS2G");
    expect(absenceClassOf({ classId: "BS2G" })).toBe("BS2G");
  });
});
