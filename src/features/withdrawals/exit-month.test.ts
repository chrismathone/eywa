import { describe, expect, it } from "vitest";
import { exitCountDate, exitMonthOf, paidSubjectMonths, paidTuitionMonths, subjectExitCountDate, subjectRunStart } from "./exit-month";

const row = (period: string, status = "paid", amount_paid: number | string = 300000, category = "tuition") => ({ period, status, amount_paid, category });

describe("퇴원월 = 수강료를 낸 마지막 달", () => {
  it("10/1 퇴원 · 9월까지 냄 → 9월 퇴원(기간 판정 9/30)", () => {
    const paid = paidTuitionMonths([row("2026-08"), row("2026-09")]);
    expect(exitMonthOf("2026-10-01", paid)).toBe("2026-09");
    expect(exitCountDate("2026-10-01", paid)).toBe("2026-09-30");
  });

  it("10/15 퇴원 · 10월 내고 일부 환불 → 10월 퇴원(퇴원일 그대로)", () => {
    const paid = paidTuitionMonths([row("2026-09"), row("2026-10", "partial", 120000)]);
    expect(exitMonthOf("2026-10-15", paid)).toBe("2026-10");
    expect(exitCountDate("2026-10-15", paid)).toBe("2026-10-15");
  });

  it("10월 청구가 전액 환불·취소·미납이면 낸 달이 아니다", () => {
    for (const r of [row("2026-10", "refunded"), row("2026-10", "void"), row("2026-10", "unpaid", 0)]) {
      expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), r]))).toBe("2026-09");
    }
  });

  it("전액 환불은 상태가 paid여도 줄의 환불로 낸 달이 아니다 · 일부 환불은 낸 달", () => {
    const line = (refund: number, type: string) => [{ kind: "수업", description: "수학", amount: 300000, paid: 300000, refunds: [{ status: "active", type, amount: refund }] }];
    const full = { ...row("2026-10"), line_items: line(300000, "full") };
    const partial = { ...row("2026-10"), line_items: line(120000, "partial") };
    expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), full]))).toBe("2026-09");
    expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), partial]))).toBe("2026-10");
  });

  it("수업료가 아닌 청구(교재 등)는 보지 않는다", () => {
    expect(exitMonthOf("2026-10-15", paidTuitionMonths([row("2026-09"), row("2026-10", "paid", 30000, "material")]))).toBe("2026-09");
  });

  it("낸 기록이 없으면 퇴원일의 달", () => {
    expect(exitMonthOf("2026-10-15", [])).toBe("2026-10");
    expect(exitCountDate("2026-10-15", [])).toBe("2026-10-15");
  });

  it("퇴원일 뒤 달에 낸 기록은 보지 않는다", () => {
    expect(exitMonthOf("2026-10-15", ["2026-09", "2026-11"])).toBe("2026-09");
  });

  it("오래 휴원하다 퇴원해도 돈을 낸 그 달(원장 확정 — 거슬러 올라가는 폭 제한 없음)", () => {
    expect(exitMonthOf("2026-10-20", ["2026-05", "2026-06"])).toBe("2026-06");
    expect(exitCountDate("2026-10-20", ["2026-05", "2026-06"])).toBe("2026-06-30");
  });

  it("2월 말일도 맞게", () => {
    expect(exitCountDate("2026-03-02", ["2026-02"])).toBe("2026-02-28");
  });
});

describe("과목 수강종료 = 그 과목 수업료를 낸 마지막 달", () => {
  const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }];
  const lesson = (description: string, paid: number, refund = 0) => ({
    kind: "수업", description, amount: paid, paid, refunds: refund ? [{ status: "active", type: "full", amount: refund }] : [],
  });
  const inv = (period: string, items: unknown[]) => ({ period, status: "paid", category: "tuition", amount_paid: 1, line_items: items });

  it("10/1 수학 종료 · 9월까지만 수학을 냄(10월은 영어만) → 9월", () => {
    const paid = paidSubjectMonths([
      inv("2026-09", [lesson("중등M 중1 EL2T 화금 *", 192000), lesson("중등E_중1 정규 B Jennifer", 254000)]),
      inv("2026-10", [lesson("중등E_중1 정규 B Jennifer", 302000)]),
    ], subjects);
    expect(subjectExitCountDate("2026-10-01", "math", paid, subjects)).toBe("2026-09-30");
    expect(subjectExitCountDate("2026-10-01", "english", paid, subjects)).toBe("2026-10-01");
  });

  it("10월 수학 줄을 전액 환불했으면 9월 · 일부 환불이면 10월", () => {
    const full = paidSubjectMonths([inv("2026-09", [lesson("중등M 중3 BS3Q 화금 *", 278000)]), inv("2026-10", [lesson("중등M 중3 BS3Q 화금 *", 278000, 278000)])], subjects);
    expect(subjectExitCountDate("2026-10-01", "math", full, subjects)).toBe("2026-09-30");
    const part = paidSubjectMonths([inv("2026-10", [lesson("고등M 고1 BS4F 화금", 336000, 288000)])], subjects);
    expect(subjectExitCountDate("2026-10-07", "math", part, subjects)).toBe("2026-10-07");
  });

  it("EiE 줄도 영어 · 과목을 모르는 줄('강의하는아이들')은 어느 과목으로도 세지 않는다", () => {
    const paid = paidSubjectMonths([
      inv("2026-09", [lesson("[EIE] Junior Plus 3 *", 260000), lesson("초등M 개별 BS2G 월목 *", 158000)]),
      inv("2026-10", [lesson("[강아] 강의하는아이들 (허주연) *", 30000)]),
    ], subjects);
    expect(subjectExitCountDate("2026-10-01", "english", paid, subjects)).toBe("2026-09-30");
    expect(subjectExitCountDate("2026-10-01", "math", paid, subjects)).toBe("2026-09-30");
  });

  it("그 과목을 낸 기록이 없으면 종료일 그대로", () => {
    expect(subjectExitCountDate("2026-10-01", "math", new Map(), subjects)).toBe("2026-10-01");
  });
});

describe("과목을 다시 다닌 경우 — 마지막으로 이어 다닌 시작 전 납부는 보지 않는다", () => {
  const subjects = [{ key: "math", label: "수학" }];
  it("3월에 그만두고 9/15에 다시 시작 · 10/1 종료 · 9·10월 미납 → 종료일 그대로(3월로 세지 않는다)", () => {
    const paid = new Map([["math", ["2026-02", "2026-03"]]]);
    const since = subjectRunStart([{ startDate: "2025-09-01", endDate: "2026-03-31" }, { startDate: "2026-09-15", endDate: "2026-10-01" }], "2026-09-15");
    expect(since).toBe("2026-09-15");
    expect(subjectExitCountDate("2026-10-01", "math", paid, subjects, since)).toBe("2026-10-01");
  });
  it("반 이동 사슬(틈 31일 안)은 한 번에 다닌 것 — 앞 반 시작부터 본다", () => {
    expect(subjectRunStart([{ startDate: "2026-03-02", endDate: "2026-08-04" }, { startDate: "2026-08-04", endDate: "2026-10-01" }], "2026-08-04")).toBe("2026-03-02");
  });
});
