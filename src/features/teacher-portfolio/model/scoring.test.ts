import { describe, expect, it } from "vitest";
import { buildCoverage, datesInNote, monthDeadline } from "./coverage";
import { buildRevenue, matchesClass, netReceipt, receiptSubject, revenuePoints } from "./revenue";
import type { SnapshotAttendance, SnapshotClass, SnapshotEnrollment, SnapshotInvoice, SnapshotMakeup, SnapshotSchedule, SnapshotTerm } from "./types";

/** 매출 기여(과목 매출 대비 담당 비중)와 보강관리(결석 다음 달 같은 날까지)의 계산 규칙. */
const week = { start: "2026-10-05", end: "2026-10-11" };
const klass = (over: Partial<SnapshotClass> = {}): SnapshotClass => ({
  id: "c", class_name: "수학 A1", subject: "math", english_track: null, teacher_id: "t", is_active: true, closed_at: null,
  report_optout: false, is_makeup_pool: false, ...over,
});
const slot = (over: Partial<SnapshotSchedule> = {}): SnapshotSchedule => ({
  id: "s", class_id: "c", day_of_week: "tue", start_time: "14:00", end_time: "14:50", teacher_id: null, slot_teacher_label: null,
  lab_separate: false, valid_from: "2026-01-01", valid_to: null, ...over,
});
const enroll = (over: Partial<SnapshotEnrollment> = {}): SnapshotEnrollment => ({
  id: "e", student_id: "s", class_id: "c", start_date: "2026-01-01", end_date: null, on_hold: false, attendance_days: [],
  is_transferred: false, is_transferred_in: false, ...over,
});
const invoice = (over: Partial<SnapshotInvoice> = {}): SnapshotInvoice => ({
  id: "i", student_id: "s", period: "2026-10", amount_total: 400, amount_discount: 0,
  line_items: [{ kind: "수업", description: "수학 A1", amount: 400, discount: 0 }], ...over,
});
type Data = {
  classes: SnapshotClass[]; schedules: SnapshotSchedule[]; enrollments: SnapshotEnrollment[]; invoices: SnapshotInvoice[];
  terms: SnapshotTerm[]; holidays: string[];
};
const data = (): Data => ({ classes: [klass()], schedules: [slot()], enrollments: [enroll()], invoices: [invoice()], terms: [], holidays: [] });
const revenue = (d: Data) => buildRevenue({ ...d, holidays: new Set(d.holidays), subjectLabel: (key) => key, owner: (c) => c.teacher_id });

describe("매출 기여", () => {
  it("월 수강료를 실제 주간 시간표에 나눈다 — 청구서마다 금액이 보존된다", () => {
    const model = revenue(data());
    expect([model.period("t", week, []).amount, model.period("t", week, []).value]).toEqual([100, 10]);
    expect(model.audit.every((r) => r.amount === r.allocated)).toBe(true);
  });
  it("같은 시간표 줄이 겹쳐도 매출은 두 배가 되지 않는다", () => {
    const d = data();
    d.schedules.push(slot({ id: "dup" }));
    expect(revenue(d).period("t", week, []).amount).toBe(100);
  });
  it("교시 담당이 둘이면 한 반의 매출을 나눈다", () => {
    const d = data();
    d.schedules.push(slot({ id: "s2", start_time: "14:50", end_time: "15:40", teacher_id: "t2" }));
    const model = revenue(d);
    expect([model.period("t", week, []).amount, model.period("t2", week, []).amount]).toEqual([50, 50]);
  });
  it("휴원일·수강 전·반이동 당일의 옛 반은 매출이 아니다", () => {
    const holiday = data();
    holiday.holidays = ["2026-10-06"];
    expect(revenue(holiday).period("t", week, []).amount).toBe(0);
    const future = data();
    future.enrollments[0].start_date = "2026-10-13";
    expect(revenue(future).period("t", week, []).amount).toBe(0);
    const moved = data();
    Object.assign(moved.enrollments[0], { end_date: "2026-10-06", is_transferred: true });
    expect(revenue(moved).period("t", week, []).amount).toBe(0);
  });
  it("후보 반이 둘이면 잇지 않고 과목 합계에 한 번만 넣는다", () => {
    const d = data();
    d.classes.push(klass({ id: "c2" }));
    d.enrollments.push(enroll({ id: "e2", class_id: "c2" }));
    d.schedules.push(slot({ id: "s2", class_id: "c2" }));
    const r = revenue(d).period("t", week, ["math"]);
    expect(r.amount).toBe(0);
    expect(r.unassigned).toBe(r.subjectTotal);
  });
  it("할인과 유효한 환불만 뺀다", () => {
    expect(netReceipt({ amount: 400, discount: 20, refunds: [{ status: "active", type: "partial", amount: 30 }, { status: "cancelled", type: "full", amount: 350 }] })).toBe(350);
    expect(netReceipt({ amount: 400, refunds: [{ status: "active", type: "full", amount: 400 }] })).toBe(0);
  });
  it("반 이름은 정확히 맞을 때만 잇는다", () => {
    expect(matchesClass({ description: "[EiE] Let's Talk 5" }, { class_name: "LT5", id: "lt" })).toBe(true);
    expect(matchesClass({ description: "[EiE] Let's Talk 5 a" }, { class_name: "LT6", id: "lt" })).toBe(false);
    expect(matchesClass({ description: "수학 A10" }, { class_name: "수학 A1", id: "a" })).toBe(false);
  });
  it("저장된 반 배분을 쓰되, 깨진 배분이 매출을 부풀리지 못한다", () => {
    const d = data();
    const line = (d.invoices[0].line_items as unknown[])[0];
    d.terms = [{ id: "term", invoice_id: "i", class_id: "c", amount: 400, confirmed_sessions: 4, allocation_line_index: 0, allocation_amount: 400, allocation_source: line, allocation_base_amount: 400 }];
    expect(revenue(d).period("t", week, []).amount).toBe(100);
    d.terms[0].allocation_amount = 800;
    expect(revenue(d).audit[0].allocated).toBe(400);
  });
  it("과목 매출의 30%부터 10점이다", () => {
    expect([revenuePoints(15, 100), revenuePoints(24, 100), revenuePoints(30, 100), revenuePoints(60, 100)]).toEqual([5, 8, 10, 10]);
    expect([revenuePoints(29.99, 100), revenuePoints(0, 0)]).toEqual([9.9, 0]);
  });
  it("과목은 문구로 분명할 때만 정한다", () => {
    expect([receiptSubject({ description: "[EiE] Let's Talk" }), receiptSubject({ description: "초등M 개별" }), receiptSubject({ description: "별도 수업" })])
      .toEqual(["english", "math", null]);
    // 지난 수납의 '수학(심화)'도 수학이다(과목을 없앴다).
    expect(receiptSubject({ description: "수학(심화) 중2" })).toBe("math");
  });
  it("🔴 분모는 담당 과목 전체다 — 다른 과목 매출이 섞이지 않고, 담당 미확인 금액은 분모에 남는다", () => {
    const d = data();
    d.classes.push(klass({ id: "english", class_name: "영어 E1", teacher_id: "eng", subject: "english" }));
    d.enrollments.push(enroll({ id: "e2", class_id: "english" }));
    d.schedules.push(slot({ id: "s2", class_id: "english" }));
    d.invoices.push(invoice({ id: "eng-i", line_items: [{ kind: "수업", description: "영어 E1", amount: 4000 }] }));
    expect(revenue(d).period("t", week, ["math"]).subjectTotal).toBe(100);
    d.invoices.push(invoice({ id: "unknown-math", line_items: [{ kind: "수업", description: "수학 미확인반", amount: 400 }] }));
    expect(revenue(d).period("t", week, ["math"]).subjectTotal).toBeGreaterThan(100);
  });
});

const absent = (over: Partial<SnapshotAttendance> = {}): SnapshotAttendance => ({
  id: "a", student_id: "s", class_id: "c", session_date: "2026-09-06", slot_start: "14:00", status: "absent", recorded_at: "2026-09-06T05:00:00Z",
  supersedes_id: null, seat_label: null, recorded_via: null, taught_by: null, note: "", ...over,
});
const makeup = (day: string, note = "", classId = "c") => absent({ id: `m${day}`, session_date: day, status: "makeup", note, class_id: classId });
const coverage = (rows: SnapshotAttendance[], w = week, extra: { classes?: SnapshotClass[]; makeupLegacy?: SnapshotMakeup[] } = {}) =>
  buildCoverage({ classes: extra.classes ?? [klass()], attendance: rows, makeupLegacy: extra.makeupLegacy ?? [], owner: (c) => c.teacher_id }).period("t", w);

describe("보강관리", () => {
  it("기한은 다음 달 같은 날이고, 없으면 말일이다", () => {
    expect([monthDeadline("2026-01-31"), monthDeadline("2028-01-31"), monthDeadline("2026-12-31")]).toEqual(["2026-02-28", "2028-02-29", "2027-01-31"]);
  });
  it("메모의 날짜를 읽되 없는 날짜는 근거가 아니다", () => {
    expect(datesInNote("2026/9/6 보강 완료", "2026-09-01")[0]).toBe("2026-09-06");
    expect(datesInNote("2/31 보강 완료", "2026-02-01")).toEqual([]);
  });
  it("결석이 없으면 10점, 기한이 남은 결석은 감점하지 않는다", () => {
    expect(coverage([]).value).toBe(10);
    const pending = coverage([absent({ session_date: "2026-10-06" })]);
    expect([pending.value, pending.pending]).toEqual([10, 1]);
  });
  it("기한 당일까지의 보강만 인정한다", () => {
    expect([coverage([absent()]).value, coverage([absent()]).due]).toEqual([0, 1]);
    expect(coverage([absent(), makeup("2026-10-06", "9/6 결석 보강")]).value).toBe(10);
    expect(coverage([absent(), makeup("2026-10-07", "9/6 결석 보강")]).value).toBe(0);
    expect(coverage([absent(), makeup("2026-10-12", "9/6 결석 보강")]).value).toBe(0);
  });
  it("날짜가 적힌 완료 메모는 인정하고, 예정·취소·날짜 없는 메모는 완료로 바꾸지 않는다", () => {
    expect(coverage([absent({ note: "9/20 보강 완료" })]).value).toBe(10);
    for (const note of ["9/20 보강 예정", "9/20 보강 취소", "9/20 보강 미완료", "9/20 보강 안 함", "9/20 보강 필요", "보강 완료"]) {
      expect(coverage([absent({ note })]).value, note).toBe(0);
    }
  });
  it("결석 하루에 의무 하나, 보강 한 번은 결석 하나만 채운다", () => {
    expect(coverage([absent(), absent({ id: "a2", slot_start: "15:00" }), makeup("2026-09-20", "9/6 결석 보강")]).due).toBe(1);
    expect(coverage([absent(), absent({ id: "b", session_date: "2026-09-07" }), makeup("2026-09-20", "9/6 결석 보강")]).value).toBe(5);
    expect(coverage([absent(), absent({ id: "b", session_date: "2026-09-07" }), makeup("2026-09-20")]).done).toBe(0);
  });
  it("다른 과목의 보강은 원래 결석을 채우지 못한다", () => {
    const classes = [klass(), klass({ id: "english", subject: "english" })];
    expect(coverage([absent(), makeup("2026-09-20", "9/6 결석 보강", "english")], week, { classes }).value).toBe(0);
  });
  it("기한이 끝난 달에 한 번만 평가하고, 예약과 출결의 중복은 한 건으로 센다", () => {
    expect(coverage([absent()], { start: "2026-10-12", end: "2026-10-18" }).due).toBe(0);
    const legacy: SnapshotMakeup[] = [{ id: "r", student_id: "s", class_id: "c", absence_date: "2026-09-06", makeup_date: "2026-09-20", status: "done", done_at: "2026-09-20T05:00:00Z" }];
    expect(coverage([absent(), makeup("2026-09-20", "9/6 결석 보강")], week, { makeupLegacy: legacy }).done).toBe(1);
  });
});
