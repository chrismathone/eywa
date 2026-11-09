import { describe, expect, it } from "vitest";
import {
  attendanceCarryMarks,
  attendanceClassBilledAmounts,
  attendanceClassBilledDetail,
  attendanceClassConfirmedSessions,
  attendanceClassConfirmedPrices,
  attendanceClassPriceConfirmedRows,
  attendanceInvoiceStateByStudent,
  attendanceNoInvoiceRows,
  type AttendanceBillingTerm,
} from "./class-billing";
import { rowKey } from "./grid/model";

const classes = [
  { classId: "c1", className: "고등M 개별 TP4E", studentIds: ["s1", "s2"] },
  { classId: "c2", className: "고등M 개별 토일", studentIds: ["s1"] },
];
const key = rowKey("c1", "s1");
const line = { description: "고등M 개별 TP4E 화금", amount: 210000 };
const invoice = { id: "i1", student_id: "s1", line_items: [line] };
function term(overrides: Partial<AttendanceBillingTerm> = {}): AttendanceBillingTerm {
  return {
    id: "t1", invoice_id: "i1", class_id: "c1", amount: 150000, confirmed_sessions: 5,
    quantity_basis: "attendance_units", pricing_mode: "per_session",
    allocation_line_index: null, allocation_amount: null, allocation_source: null, allocation_base_amount: null,
    ...overrides,
  };
}

describe("출석부 확정 단가", () => {
  it("저장된 단가만 사용하고 청구액÷시수로 역산하지 않는다", () => {
    expect(attendanceClassConfirmedPrices(classes, [invoice], [term({ unit_price: 25000 })])).toEqual({
      [key]: [{ unitPrice: 25000, monthly: false, daysBasis: false }],
    });
    expect(attendanceClassConfirmedPrices(classes, [invoice], [term({ unit_price: 0, confirmed_sessions: 0 })])[key]?.[0]?.unitPrice).toBe(0);
  });

  it("월 정액과 옛 일수 단가를 구분하고 서로 다른 단가를 합산하지 않는다", () => {
    const prices = attendanceClassConfirmedPrices(classes, [invoice], [
      term({ unit_price: 25000 }), term({ id: "duplicate", unit_price: 25000 }),
      term({ id: "monthly", unit_price: 250000, pricing_mode: "monthly", quantity_basis: null }),
      term({ id: "legacy", unit_price: 25000, quantity_basis: "days" }),
    ]);
    expect(prices[key]).toEqual([
      { unitPrice: 25000, monthly: false, daysBasis: false },
      { unitPrice: 250000, monthly: true, daysBasis: false },
      { unitPrice: 25000, monthly: false, daysBasis: true },
    ]);
  });

  it("일부만 확정된 줄과 허용되지 않은 반·학생·청구서는 노출하지 않는다", () => {
    for (const pending of [term(), term({ unit_price: 25000, confirmed_sessions: null })]) {
      expect(attendanceClassConfirmedPrices(classes, [invoice], [term({ unit_price: 25000 }), pending])).toEqual({});
    }
    expect(attendanceClassConfirmedPrices([classes[0]!], [invoice], [
      term({ unit_price: 25000, class_id: "c2" }),
      term({ unit_price: 25000, invoice_id: "missing" }),
    ])).toEqual({});
    expect(attendanceClassConfirmedPrices(classes, [{ ...invoice, student_id: "outsider" }], [term({ unit_price: 25000 })])).toEqual({});
  });
});

describe("출석부 이 반 청구액", () => {
  it("금액 이월(0278a) — 배분이 있는 줄은 보낸 이월을 빼고 받은 이월을 더한다(회차 확정 실납과 같은 규칙)", () => {
    // 김지호 모양: 확정 150,000인데 배분 160,000(10,000원 더 받음) → 10,000원을 다음 달로.
    const paid = { ...line, amount: 160000 };
    const allocated = term({ allocation_line_index: 0, allocation_amount: 160000, allocation_source: paid, allocation_base_amount: 150000 });
    const inv = { ...invoice, line_items: [paid] };
    const carryIn = (amount: number, over: object = {}) => ({ amount, fromPeriod: "2026-08", fromClassName: "고등M 개별 TP4E", note: null, valid: true, ...over });
    expect(attendanceClassBilledAmounts(classes, [inv], [allocated], { outs: new Map([["t1", 10000]]), ins: new Map() })).toEqual({ [key]: 150000 });
    // 더 받은 몫보다 큰 이월은 무효 — 빼지 않는다(받는 달도 같은 판정으로 안 더한다).
    expect(attendanceClassBilledAmounts(classes, [inv], [allocated], { outs: new Map([["t1", 20000]]), ins: new Map() })).toEqual({ [key]: 160000 });
    // 받은 이월은 (학생|반) 키로 한 번만 — 유효한 것만.
    const ins = new Map([["s1|c1", [carryIn(5000), carryIn(7000, { valid: false })]]]);
    expect(attendanceClassBilledAmounts(classes, [inv], [allocated], { outs: new Map(), ins })).toEqual({ [key]: 165000 });
    // 배분이 없는 줄(이름 매칭 참고값)엔 이월을 싣지 않는다 — 회차 확정 면도 배분 전엔 실납이 없다.
    expect(attendanceClassBilledAmounts(classes, [invoice], [term()], { outs: new Map(), ins })).toEqual({ [key]: 210000 });
 
    // 받을 줄이 전액 환불이면 싣지 않는다(회차 확정 `canReceiveCarry`와 같은 규칙).
    const refundedLine = { ...paid, refunds: [{ status: "active", type: "full", amount: 160000 }] };
    const refundedTerm = term({ allocation_line_index: 0, allocation_amount: 160000, allocation_source: refundedLine, allocation_base_amount: 150000 });
    expect(attendanceClassBilledAmounts(classes, [{ ...invoice, line_items: [refundedLine] }], [refundedTerm], { outs: new Map(), ins })).toEqual({ [key]: 0 });
    // 같은 학생·반이 청구서 두 장이어도 받은 이월은 한 번만.
    const twice = [allocated, { ...allocated, id: "t9", invoice_id: "i9" }];
    expect(attendanceClassBilledAmounts(classes, [inv, { ...inv, id: "i9" }], twice, { outs: new Map(), ins })[key]).toBe(160000 * 2 + 5000);
  });

  it("연쇄 이월(원장 2026-11-09) — 받은 이월에서 남은 몫을 보낸 줄은 그만큼 빼고, 받은 이월은 더한다(회차 확정 실납과 같은 판정)", () => {
    // 조은준 9월 모양: 확정 324,000(27시수) · 배분 312,000 + 8월 이월 24,000 = 336,000 → 12,000을 10월로.
    const paid = { ...line, amount: 312000 };
    const allocated = term({ amount: 324000, confirmed_sessions: 27, allocation_line_index: 0, allocation_amount: 312000, allocation_source: paid, allocation_base_amount: 324000 });
    const inv = { ...invoice, line_items: [paid] };
    const ins = new Map([["s1|c1", [{ amount: 24000, fromPeriod: "2026-08", fromClassName: "고등M 개별 TP4E", note: null, valid: true }]]]);
    expect(attendanceClassBilledAmounts(classes, [inv], [allocated], { outs: new Map([["t1", 12000]]), ins })).toEqual({ [key]: 324000 });
    // 받은 이월이 없으면 더 받은 몫이 없다 — 보낸 이월은 무효라 빼지 않는다(받는 달도 같은 판정으로 안 더한다).
    expect(attendanceClassBilledAmounts(classes, [inv], [allocated], { outs: new Map([["t1", 12000]]), ins: new Map() })).toEqual({ [key]: 312000 });
    // 남은 몫보다 많이 보낸 이월은 무효.
    expect(attendanceClassBilledAmounts(classes, [inv], [allocated], { outs: new Map([["t1", 12001]]), ins })).toEqual({ [key]: 336000 });
  });

  it("이월 표식(원장 2026-10-06) — 금액과 같은 판정으로 받은·보낸 이월을 줄마다 내고, 단가로 나눠 회차를 적는다", () => {
    const paid = { ...line, amount: 160000 };
    const allocated = term({ unit_price: 30000, allocation_line_index: 0, allocation_amount: 160000, allocation_source: paid, allocation_base_amount: 150000 });
    const inv = { ...invoice, line_items: [paid] };
    const prices = attendanceClassConfirmedPrices(classes, [inv], [allocated]);
    const carryIn = (amount: number, over: object = {}) => ({ amount, fromPeriod: "2026-08", fromClassName: "고등M 개별 TP4E", note: null, valid: true, ...over });
    const marks = (carry: Parameters<typeof attendanceCarryMarks>[1], terms = [allocated], invoices = [inv], p = prices) =>
      attendanceCarryMarks(classes, carry, attendanceClassBilledDetail(classes, invoices, terms, carry), p);

    // 받은 이월 — 유효한 것만 담고(무효·받을 반 없음은 뺀다), 30,000원 단가로 나눠 회차를 적는다.
    const ins = new Map([["s1|c1", [carryIn(60000), carryIn(7000, { valid: false }), carryIn(9000, { orphan: true })]]]);
    expect(marks({ outs: new Map(), ins })).toEqual({
      [key]: { ins: [{ amount: 60000, period: "2026-08", units: 2 }], inState: "applied", out: null },
    });
    // 보낸 이월 — 청구액에서 실제로 뺀 것만. 가는 달은 호출부가 준 값.
    expect(marks({ outs: new Map([["t1", 10000]]), ins: new Map(), outPeriod: "2026-10" })[key]).toEqual({
      ins: [], inState: "pending", out: { amount: 10000, period: "2026-10", units: 10000 / 30000 },
    });
    // 더 받은 몫보다 큰 이월은 무효 — 금액에서 안 뺐으니 표식도 없다.
    expect(marks({ outs: new Map([["t1", 20000]]), ins: new Map() })).toEqual({});
    // 🔴 배분이 무효면(확정액이 바뀌어 재확인) 받은 이월이 청구액에 안 실린다 — 표식은 남기고 '안 실렸다'고 적는다.
    const stale = [{ ...allocated, amount: 180000, confirmed_sessions: 6 }];
    expect(attendanceClassBilledDetail(classes, [inv], stale, { outs: new Map(), ins }).billed).toEqual({ [key]: 160000 });
    expect(marks({ outs: new Map(), ins }, stale)[key]).toEqual({ ins: [{ amount: 60000, period: "2026-08", units: 2 }], inState: "pending", out: null });
    // 🔴 받는 줄이 전액 환불이면 배분을 다시 저장해도 안 실린다 — '환불'로 갈라 적는다(할 일이 다르다).
    const refundedLine = { ...paid, refunds: [{ status: "active", type: "full", amount: 160000 }] };
    const refundedTerm = { ...allocated, allocation_source: refundedLine };
    expect(marks({ outs: new Map(), ins }, [refundedTerm], [{ ...invoice, line_items: [refundedLine] }])[key]!.inState).toBe("refunded");
    // 같은 학생·반이 청구서 두 장이어도 받은 이월 표식은 한 줄에 한 번(금액도 한 번만 더했다).
    const twice = [allocated, { ...allocated, id: "t9", invoice_id: "i9" }];
    expect(marks({ outs: new Map(), ins }, twice, [inv, { ...inv, id: "i9" }])[key]).toEqual({ ins: [{ amount: 60000, period: "2026-08", units: 2 }], inState: "applied", out: null });
    // 보낸 이월은 청구서마다 뺀 만큼 합친다.
    expect(marks({ outs: new Map([["t1", 10000], ["t9", 10000]]), ins: new Map(), outPeriod: "2026-10" }, twice, [inv, { ...inv, id: "i9" }])[key]!.out!.amount).toBe(20000);
    // 등록 차수가 미확정인 줄(단가 없음)도 표식은 선다 — 회차 없이 금액만.
    const unconfirmed = [{ ...allocated, amount: null, confirmed_sessions: null, unit_price: null, allocation_base_amount: null }];
    expect(marks({ outs: new Map(), ins }, unconfirmed, [inv], attendanceClassConfirmedPrices(classes, [inv], unconfirmed))[key]).toEqual({
      ins: [{ amount: 60000, period: "2026-08", units: null }], inState: "applied", out: null,
    });
    // 이월이 없는 줄은 키를 만들지 않는다.
    expect(marks({ outs: new Map(), ins: new Map() })).toEqual({});
  });

  it("이월 회차는 그 줄 확정 단가가 회당 하나일 때만 — 월 정액·옛 일수 기준·단가 여럿·미확정은 금액만", () => {
    const ins = new Map([["s1|c1", [{ amount: 60000, fromPeriod: "2026-08", fromClassName: null, note: null, valid: true }]]]);
    const detail = { carryInApplied: new Set<string>(), carryInRefunded: new Set<string>(), carryOut: {} };
    const unitsOf = (p: Parameters<typeof attendanceCarryMarks>[3]) => attendanceCarryMarks(classes, { outs: new Map(), ins }, detail, p)[key]!.ins[0]!.units;
    expect(unitsOf({ [key]: [{ unitPrice: 30000, monthly: false, daysBasis: false }] })).toBe(2);
    expect(unitsOf({ [key]: [{ unitPrice: 250000, monthly: true, daysBasis: false }] })).toBeNull();
    expect(unitsOf({ [key]: [{ unitPrice: 30000, monthly: false, daysBasis: true }] })).toBeNull();
    expect(unitsOf({ [key]: [{ unitPrice: 30000, monthly: false, daysBasis: false }, { unitPrice: 25000, monthly: false, daysBasis: false }] })).toBeNull();
    expect(unitsOf({ [key]: [{ unitPrice: 0, monthly: false, daysBasis: false }] })).toBeNull();
    expect(unitsOf({})).toBeNull();
  });

  it("같은 학생의 반을 구분하고 회차×단가 대신 해당 반 청구 항목을 표시한다", () => {
    const invoices = [{ ...invoice, line_items: [line, { description: "고등M 개별 토일", amount: 90000 }, { description: "다른 과목", amount: 300000 }] }];
    expect(attendanceClassBilledAmounts(classes, invoices, [term(), term({ id: "t2", class_id: "c2" })])).toEqual({
      [key]: 210000, [rowKey("c2", "s1")]: 90000,
    });
  });

  it("다른 반과 나눈 유효한 배분을 이름 매칭보다 우선하고 보이는 반만 반환한다", () => {
    const terms = [
      term({ allocation_line_index: 0, allocation_amount: 150000, allocation_source: line, allocation_base_amount: 150000 }),
      term({ id: "t2", class_id: "c2", amount: 60000, allocation_line_index: 0, allocation_amount: 60000, allocation_source: line, allocation_base_amount: 60000 }),
    ];
    expect(attendanceClassBilledAmounts([classes[0]!], [invoice], terms)).toEqual({ [key]: 150000 });
  });

  it("🔴 유효한 자유 배분(0279a)이 있으면 금액을 안 받은 반을 이름 매칭으로 채우지 않는다 — 합계가 청구액을 넘지 않게", () => {
    const weekend = { description: "고등M 개별 토일", amount: 90000 };
    const items = [line, weekend];
    const freeInvoice = { ...invoice, line_items: items };
    const terms = [
      // 관리자가 수업 청구액 300,000원을 전부 TP4E에 줬다(항목 연결 없음 · 저장 때 청구 항목 전체 스냅샷).
      term({ allocation_amount: 300000, allocation_source: items, allocation_base_amount: 150000 }),
      // 토일 반은 미확정이라 0원으로 두면 저장하지 않는다(행은 배분 없음).
      term({ id: "t2", class_id: "c2", amount: null, confirmed_sessions: null }),
    ];
    expect(attendanceClassBilledAmounts(classes, [freeInvoice], terms)).toEqual({ [key]: 300000, [rowKey("c2", "s1")]: 0 });
    // 자유 배분이 없던 때는 종전대로 이름 매칭(토일 90,000원).
    expect(attendanceClassBilledAmounts(classes, [freeInvoice], [term({ id: "t2", class_id: "c2", amount: null, confirmed_sessions: null })])).toEqual({ [rowKey("c2", "s1")]: 90000 });
  });

  it("동기화로 무효가 된 배분은 회차 확정처럼 이름 매칭으로 돌아간다", () => {
    const stale = term({ allocation_line_index: 0, allocation_amount: 210000, allocation_source: { ...line, amount: 220000 }, allocation_base_amount: 150000 });
    expect(attendanceClassBilledAmounts(classes, [invoice], [stale])).toEqual({ [key]: 210000 });
    expect(attendanceClassBilledAmounts(classes, [{ ...invoice, line_items: [{ description: "통합 청구", amount: 220000 }] }], [stale])).toEqual({});
  });

  it("미매칭·청구서 없음·회차 행 없음은 금액을 만들어내지 않는다", () => {
    expect(attendanceClassBilledAmounts(classes, [{ ...invoice, line_items: null }], [term()])).toEqual({});
    expect(attendanceClassBilledAmounts(classes, [], [term()])).toEqual({});
    expect(attendanceClassBilledAmounts(classes, [invoice], [])).toEqual({});
  });

  it("매칭된 0원과 0원 배분은 미확정이 아니다", () => {
    const zero = { ...line, amount: 0 };
    expect(attendanceClassBilledAmounts(classes, [{ ...invoice, line_items: [zero] }], [term()])).toEqual({ [key]: 0 });
    const terms = [
      term({ allocation_line_index: 0, allocation_amount: 0, allocation_source: line, allocation_base_amount: 150000 }),
      term({ id: "t2", class_id: "c2", allocation_line_index: 0, allocation_amount: 210000, allocation_source: line, allocation_base_amount: 150000 }),
    ];
    expect(attendanceClassBilledAmounts([classes[0]!], [invoice], terms)).toEqual({ [key]: 0 });
  });

  it("같은 월의 분할 청구를 합치고 출석부에 없는 학생은 제외한다", () => {
    const invoices = [invoice, { ...invoice, id: "i2" }, { ...invoice, id: "i3", student_id: "other" }];
    const terms = [term(), term({ id: "t2", invoice_id: "i2" }), term({ id: "t3", invoice_id: "i3" })];
    expect(attendanceClassBilledAmounts(classes, invoices, terms)).toEqual({ [key]: 420000 });
  });
});

describe("출석부 '등록 차수' — 회차 확정의 확정 시수 (원장 2026-09-17)", () => {
  it("확정한 시수를 학생×반으로 돌려준다", () => {
    expect(attendanceClassConfirmedSessions(classes, [invoice], [term({ confirmed_sessions: 8 })])).toEqual({
      [key]: { units: 8, daysBasis: false },
    });
  });

  it("🔴 미확정은 키를 안 만든다 — 0을 지어내면 '등록 0차수'가 사실처럼 읽힌다", () => {
    expect(attendanceClassConfirmedSessions(classes, [invoice], [term({ confirmed_sessions: null })])).toEqual({});
  });

  it("같은 학생·반의 청구서가 둘이면 합친다(청구액과 같은 규약) · 출석부에 없는 학생·반은 뺀다", () => {
    const second = { id: "i2", student_id: "s1", line_items: [line] };
    const rows = [
      term({ confirmed_sessions: 4 }),
      term({ id: "t2", invoice_id: "i2", confirmed_sessions: 1.5 }),
      term({ id: "t3", class_id: "c9", confirmed_sessions: 9 }),
      term({ id: "t4", invoice_id: "i3", confirmed_sessions: 7 }),
    ];
    expect(attendanceClassConfirmedSessions(classes, [invoice, second], rows)).toEqual({
      [key]: { units: 5.5, daysBasis: false },
    });
  });

  it("🔴 옛 **일수 기준** 확정은 단위가 다르다고 표시한다 — null도 일수(회차 확정과 같은 폴백)", () => {
    for (const basis of ["days", null]) {
      expect(attendanceClassConfirmedSessions(classes, [invoice], [term({ quantity_basis: basis, confirmed_sessions: 6 })]))
        .toEqual({ [key]: { units: 6, daysBasis: true } });
    }
    // 하나라도 섞이면 그 합은 단위가 섞인 것이다.
    const mixed = [term({ confirmed_sessions: 4 }), term({ id: "t2", quantity_basis: "days", confirmed_sessions: 2 })];
    expect(attendanceClassConfirmedSessions(classes, [invoice], mixed)).toEqual({ [key]: { units: 6, daysBasis: true } });
  });

  it("월 정액(EiE)은 일수·시수 축이 없어 표식을 달지 않는다", () => {
    const monthly = term({ pricing_mode: "monthly", quantity_basis: null, confirmed_sessions: 1 });
    expect(attendanceClassConfirmedSessions(classes, [invoice], [monthly])).toEqual({
      [key]: { units: 1, daysBasis: false },
    });
  });

  it("합은 0.1 단위로 정리한다 — 부동소수 꼬리가 '1'을 '1.0'으로 찍는다", () => {
    const second = { id: "i2", student_id: "s1", line_items: [line] };
    const rows = [
      term({ confirmed_sessions: 1.1 }),
      term({ id: "t2", invoice_id: "i2", confirmed_sessions: 2.2 }),
    ];
    expect(attendanceClassConfirmedSessions(classes, [invoice, second], rows)[key]!.units).toBe(3.3);
  });
});

describe("「단가」 표식 연동 — 회차 확정에서 단가까지 확정된 줄 (원장 2026-09-18)", () => {
  it("확정 시수와 단가가 함께 있는 줄만 돌려준다", () => {
    expect(attendanceClassPriceConfirmedRows(classes, [invoice], [term({ unit_price: 30000 })])).toEqual([key]);
    expect(attendanceClassPriceConfirmedRows(classes, [invoice], [term({ unit_price: null })])).toEqual([]);
    expect(attendanceClassPriceConfirmedRows(classes, [invoice], [term({ confirmed_sessions: null, unit_price: null })])).toEqual([]);
  });

  it("🔴 같은 학생·반 회차 행이 둘이면 **둘 다** 확정이어야 한다 — 하나라도 미확정이면 회차 확정에 남아 있다", () => {
    const invoices = [invoice, { ...invoice, id: "i2" }];
    const done = term({ unit_price: 30000 });
    expect(attendanceClassPriceConfirmedRows(classes, invoices, [done, term({ id: "t2", invoice_id: "i2", confirmed_sessions: null })])).toEqual([]);
    expect(attendanceClassPriceConfirmedRows(classes, invoices, [done, term({ id: "t2", invoice_id: "i2", unit_price: 10000 })])).toEqual([key]);
  });

  it("출석부에 없는 학생·반, 반 없는 회차 행은 담지 않는다", () => {
    expect(attendanceClassPriceConfirmedRows([classes[1]!], [invoice], [term({ unit_price: 30000 })])).toEqual([]);
    expect(attendanceClassPriceConfirmedRows(classes, [invoice], [term({ class_id: null, unit_price: 30000 })])).toEqual([]);
    expect(attendanceClassPriceConfirmedRows(classes, [], [term({ unit_price: 30000 })])).toEqual([]);
  });
});

/**
 * 회차 행이 없는 줄의 두 갈래(원장 2026-09-18 선택) — 청구서가 있으면 '미확정'(회차 확정에서 만들 수 있다), 없거나 취소됐으면
 * `—`(만들 곳이 없다). 회차 확정 화면의 `termRowState`(`missing` / `no_invoice` / `void_invoice`)와 같은 줄이어야 한다.
 */
describe("학생별 청구서 상태 · '—'로 적을 줄 (2026-09-18)", () => {
  it("살아 있는 청구서가 하나라도 있으면 ok · 취소뿐이면 void · 없으면 none — 물어본 학생 전원에게 키가 선다", () => {
    expect(
      attendanceInvoiceStateByStudent(
        ["s1", "s2", "s3", "s4"],
        [
          { student_id: "s1", status: "issued" },
          { student_id: "s2", status: "void" },
          // s4 = 취소 + 재발행: 순서와 무관하게 ok(살아 있는 게 하나라도 있다).
          { student_id: "s4", status: "void" },
          { student_id: "s4", status: "paid" },
          { student_id: "outsider", status: "issued" },
        ],
      ),
    ).toEqual({ s1: "ok", s2: "void", s3: "none", s4: "ok" });
  });

  it("🔴 청구서 상태가 null이어도 취소는 아니다 — void 글자 그대로만 취소", () => {
    expect(attendanceInvoiceStateByStudent(["s1"], [{ student_id: "s1", status: null }])).toEqual({ s1: "ok" });
  });

  it("`—` 줄 = 상태가 none·void인 학생의 **모든 반 줄** — ok·모름(키 없음)은 넣지 않는다", () => {
    const rows = attendanceNoInvoiceRows(classes, { s1: "none", s2: "void" });
    expect([...rows]).toEqual([
      [rowKey("c1", "s1"), "none"],
      [rowKey("c1", "s2"), "void"],
      [rowKey("c2", "s1"), "none"],
    ]);
    expect(attendanceNoInvoiceRows(classes, { s1: "ok" }).size).toBe(0);
    // 🔴 상태 맵에 없는 학생(출석부가 안 물어본 반)은 '청구서 없음'으로 읽지 않는다 — 종전 '미확정' 그대로.
    expect(attendanceNoInvoiceRows(classes, {}).size).toBe(0);
  });
});
