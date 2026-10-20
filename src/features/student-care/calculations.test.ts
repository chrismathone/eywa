import { describe, it, expect } from "vitest";
import { tenureOf } from "./tenure";
import { homeworkOf, gradesOf, levelsOf, attendanceOf } from "./learning";
import { paymentsOf } from "./payments";
import { careFixture } from "./fixtures";
import { dayOf } from "./dates";
import type { Enrollment, Invoice } from "./types";

const enrollment = (id: string, start: string, end: string | null, extra: Partial<Enrollment> = {}): Enrollment =>
  ({ id, start_date: start, end_date: end, on_hold: false, is_transferred: false, ...extra });
describe("재원 등록 구간", () => {
  it("동시 두 과목과 같은 날 반 이동을 한 번만 센다", () => {
    const value = tenureOf([enrollment("a", "2026-10-01", "2026-10-10", { is_transferred: true }),
      enrollment("b", "2026-10-10", null), enrollment("c", "2026-10-05", null)], "2026-10-20", null);
    expect(value).toMatchObject({ first: "2026-10-01", registeredDays: 20, currentDays: 20, intervals: 1 });
  });
  it("일반 종료일은 포함하고 중간 공백과 미래 시작을 제외한다", () => {
    expect(tenureOf([enrollment("a", "2026-10-01", "2026-10-03"), enrollment("b", "2026-10-10", null),
      enrollment("future", "2026-11-01", null)], "2026-10-20", null)).toMatchObject({ registeredDays: 14, currentDays: 11, intervals: 2 });
  });
  it("현재 휴원은 과거 전체를 휴원 처리하지 않고 연속 기간을 보류한다", () => {
    expect(tenureOf([enrollment("a", "2026-10-01", null, { on_hold: true })], "2026-10-20", null))
      .toMatchObject({ registeredDays: 20, currentDays: null, onHold: true });
  });
  it("누락·존재하지 않는 날짜를 0일로 꾸미지 않는다", () => {
    expect(tenureOf([enrollment("a", "2026-02-30", null)], "2026-10-20", null)).toMatchObject({ registeredDays: null, invalid: 1 });
    expect(tenureOf([], "2026-10-20", "2026-11-01").first).toBeNull();
    expect(dayOf("2026-10-19T15:30:00Z")).toBe("2026-10-20");
    expect(dayOf("2026-10-20T00:30:00")).toBeNull();
    expect(dayOf("2026-02-30T00:30:00Z")).toBeNull();
  });
});

describe("학습 자료 비교", () => {
  it("보고서 과목이 비었을 때 연결된 반 과목으로 비교한다", () => {
    const raw = careFixture();
    const rows = raw.reports.rows.map((row) => ({ ...row, subject: null, class: { subject: "english" } }));
    expect(homeworkOf(rows, raw.today)[0]).toMatchObject({ subject: "english", delta: -30, flag: true });
    expect(homeworkOf(rows.map((row) => ({ ...row, class: [row.class] })), raw.today)[0]).toMatchObject({ subject: "english", delta: -30, flag: true });
    expect(homeworkOf(rows.map((row) => ({ ...row, class: null })), raw.today)[0]).toMatchObject({ comparable: false, flag: false });
  });
  it("과목별 4주 비교와 실제 0%, 미기록, 일부 미흡을 구분한다", () => {
    const raw = careFixture();
    raw.reports.rows.push({ id: "missing", report_date: "2026-10-10", subject: "math", homework_score: "일부 미흡" },
      { id: "en", report_date: "2026-10-10", subject: "english", homework_score: "미제출" });
    const result = homeworkOf(raw.reports.rows, raw.today);
    expect(result.find((r) => r.subject === "math")).toMatchObject({ delta: -30, recentCount: 4, previousCount: 4, missing: 1, flag: true });
    expect(result.find((r) => r.subject === "english")).toMatchObject({ recent: 0, previous: null, delta: null, flag: false });
  });
  it("미래·기간 밖·중복 보고서를 합산하지 않는다", () => {
    const raw = careFixture();
    const row = raw.reports.rows[0]!;
    expect(homeworkOf([...raw.reports.rows, row, { ...row, id: "future", report_date: "2026-10-21" }], raw.today)[0])
      .toMatchObject({ previousCount: 4, recentCount: 4 });
  });
  it("교시별 정정은 최신 기록만 남기고 취소 상태는 결석으로 세지 않는다", () => {
    const raw = careFixture(), old = raw.attendance.rows[0]!;
    expect(attendanceOf([...raw.attendance.rows, { ...old, id: "fix", recorded_at: "2026-10-02T10:00:00Z", status: "present" },
      { ...old, id: "cancelled", session_date: "2026-10-15", status: "cancelled" }], raw.today))
      .toEqual({ count: 4, absences: 1, late: 0 });
  });
  it("다른 과목과 다른 시험의 점수를 서로 비교하지 않는다", () => {
    const raw = careFixture();
    raw.grades.rows.push({ ...raw.grades.rows[1]!, id: "en", subject: "english", score: 20 });
    let result = gradesOf(raw.grades.rows, raw.today, raw.enrolledAt);
    expect(result.find((r) => r.subject === "math")?.delta).toBe(13);
    expect(result.find((r) => r.subject === "english")?.delta).toBeNull();
    raw.grades.rows[1]!.exam_name = "다른 난도 평가";
    result = gradesOf(raw.grades.rows, raw.today, raw.enrolledAt);
    expect(result.find((r) => r.subject === "math")?.delta).toBeNull();
  });
  it("입학 전·미래·결측 성적은 제외하고 레벨 척도를 합치지 않는다", () => {
    const raw = careFixture();
    expect(gradesOf([{ ...raw.grades.rows[0]!, score: null }, { ...raw.grades.rows[1]!, taken_on: "2027-01-01" }], raw.today, raw.enrolledAt)).toEqual([]);
    expect(gradesOf([{ ...raw.grades.rows[0]!, score: " " }], raw.today, raw.enrolledAt)).toEqual([]);
    expect(levelsOf([...raw.levels.rows, { ...raw.levels.rows[0]!, id: "p", test_type: "placement" }], raw.today)).toHaveLength(2);
  });
});

describe("수납 기록과 환불", () => {
  const invoice = (line: Record<string, unknown>, amount = 300000): Invoice => ({ id: "i", period: "2026-10", status: "paid", amount_paid: amount,
    line_items: [{ kind: "수업", description: "가상 수학반", amount: 300000, paid: 300000, refunds: [], ...line }] });
  it("수납 부모와 원본 항목을 이중 합산하지 않고 교재비를 분리한다", () => {
    const i = invoice({ sourceItems: [{ kind: "수업", paid: 300000, refunds: [] }, { kind: "교재", paid: 20000 }] }, 320000);
    expect(paymentsOf([i, i])).toMatchObject({ recordedPaid: 320000, tuitionPaid: 300000, netTuition: 300000, count: 1 });
  });
  it("부분 환불은 납부액에 다시 차감하지 않고 순납부 계산을 보류한다", () => {
    expect(paymentsOf([invoice({ refunds: [{ status: "active", type: "partial", amount: 10000 }] })]))
      .toMatchObject({ tuitionPaid: 300000, recordedRefunds: 10000, netTuition: null, activeRefund: true });
  });
  it("환불 내역 미수집을 환불 0원으로 바꾸지 않는다", () => {
    expect(paymentsOf([invoice({ refunds: undefined })])).toMatchObject({ recordedRefunds: null, netTuition: null });
  });
  it("취소된 환불과 무효 청구는 제외한다", () => {
    expect(paymentsOf([invoice({ refunds: [{ status: "cancelled", amount: 300000 }] }), { ...invoice({}), id: "void", status: "void" }]))
      .toMatchObject({ count: 1, netTuition: 300000, recordedRefunds: 0 });
  });
  it("청구서와 항목 합계 불일치·중복 충돌·분류 누락을 드러낸다", () => {
    expect(paymentsOf([invoice({}, 10000)])).toMatchObject({ conflict: true, recordedPaid: null, netTuition: null });
    expect(paymentsOf([invoice({}), invoice({}, 200000)]).conflict).toBe(true);
    expect(paymentsOf([invoice({ kind: null })])).toMatchObject({ unknownLines: 1, tuitionPaid: null });
    expect(paymentsOf([invoice({ paid: " " })])).toMatchObject({ conflict: true, recordedPaid: null });
    expect(paymentsOf([])).toMatchObject({ recordedPaid: null, tuitionPaid: null, netTuition: null });
  });
});
