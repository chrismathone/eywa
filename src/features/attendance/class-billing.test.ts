import { describe, expect, it } from "vitest";
import { attendanceClassBilledAmounts, type AttendanceBillingTerm } from "./class-billing";
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
