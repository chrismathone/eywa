import { describe, expect, it } from "vitest";
import { attendanceClassBilledAmounts, attendanceClassConfirmedSessions, type AttendanceBillingTerm } from "./class-billing";
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

describe("출석부 이 반 청구액", () => {
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
