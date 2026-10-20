import { describe, expect, it } from "vitest";
import { breakdownTrendOf, enrolledOn, subjectTrendOf, type TrendStudent } from "./enrolled-trend";
import { billedTuitionMonths } from "./trend-billing";

/**
 * 수업 기록이 있는 장부 정리 = 청구로 센다(원장 2026-10-20 '청구 기록으로 맞추기' · *"청구가 취소된 것이 있을 수도 있으니까 체크"*).
 * 퇴원일이 마지막 수업 종료일(07-03 일괄 종료 같은 장부 날짜)이라, 청구 기록이 있는 달부터는 청구가 살아 있는 달에만 센다.
 */
describe("장부 정리 학생의 재원생 판정", () => {
  // 3월부터 다니다 4월까지 수업료를 냈는데 수강이 7/3에 일괄로 끝나 퇴원일이 7/3으로 남은 학생.
  const k: TrendStudent = { id: "k", status: "withdrawn", enrolledAt: "2026-03-02", withdrawnAt: "2026-07-03", cleanup: true };
  const billing = (months: string[]) => ({ from: "2026-01", today: "2026-10-20", months: new Map([["k", months]]) });
  const en = { firstStart: new Map([["k", "2026-03-02"]]), ended: new Set(["k"]), billing: billing(["2026-03", "2026-04"]) };
  const withMonths = (months: string[]) => ({ ...en, billing: billing(months) });

  it("청구 기록이 있는 달부터는 청구가 살아 있는 달에만 센다 — 퇴원일과 상관없이", () => {
    expect(enrolledOn([k], en, "2026-03-31")).toBe(1);
    expect(enrolledOn([k], en, "2026-04-30")).toBe(1);
    expect(enrolledOn([k], en, "2026-05-31")).toBe(0); // 퇴원일(7/3) 전이지만 청구가 없다
    expect(enrolledOn([k], en, "2026-06-30")).toBe(0);
  });

  it("퇴원일보다 늦어도 그달 청구가 살아 있으면 센다(7/3에 수강이 끝났지만 7월 수업료를 냈다)", () => {
    expect(enrolledOn([k], withMonths(["2026-07"]), "2026-07-31")).toBe(1);
    expect(enrolledOn([k], withMonths(["2026-07"]), "2026-08-31")).toBe(0);
  });

  it("청구 기록이 시작되기 전 달은 종전대로 퇴원일까지 · 등록·첫 수강 전은 청구가 있어도 세지 않는다", () => {
    const old = { ...k, enrolledAt: "2025-09-01" };
    const en2 = { ...withMonths(["2026-01"]), firstStart: new Map([["k", "2025-09-02"]]) };
    expect(enrolledOn([old], en2, "2025-12-31")).toBe(1);
    expect(enrolledOn([old], en2, "2025-08-31")).toBe(0);
    expect(enrolledOn([{ ...k, enrolledAt: "2026-02-01" }], withMonths(["2026-02"]), "2026-02-28")).toBe(0); // 첫 수강 3/2 전
  });

  it("오늘 점은 운영실 카드와 같은 퇴원일 규칙 · 청구가 없는 지점은 종전대로 퇴원일까지", () => {
    expect(enrolledOn([k], withMonths(["2026-10"]), "2026-10-20")).toBe(0);
    expect(enrolledOn([k], withMonths(["2026-10"]), "2026-10-13")).toBe(1);
    const noBilling = { firstStart: en.firstStart, ended: en.ended };
    expect(enrolledOn([k], noBilling, "2026-05-31")).toBe(1);
    expect(enrolledOn([k], noBilling, "2026-07-03")).toBe(0);
  });

  it("청구 재료에 없는 학생(재료를 만든 뒤 정리된 학생)은 모른다 — 종전대로 퇴원일까지(과거 추이에서 통째로 빠지지 않게)", () => {
    const enOther = { ...en, billing: { from: "2026-01", today: "2026-10-20", months: new Map([["x", ["2026-03"]]]) } };
    expect(enrolledOn([k], enOther, "2026-05-31")).toBe(1);
    expect(enrolledOn([k], enOther, "2026-07-03")).toBe(0);
  });

  it("수업 기록 없는 장부 정리는 청구가 있어도 통째로 뺀다(2026-10-15 그대로) · 다시 등록한 학생은 보통대로", () => {
    expect(enrolledOn([k], { ...en, ended: new Set<string>() }, "2026-03-31")).toBe(0);
    expect(enrolledOn([{ ...k, status: "enrolled", withdrawnAt: null }], withMonths([]), "2026-05-31")).toBe(1);
  });

  it("수강이 끝난 뒤 청구로 세어지면 마지막으로 끝난 수강의 과목으로 가른다(모름으로 모든 과목에 들지 않는다)", () => {
    const july = k;
    const enJuly = withMonths(["2026-07"]);
    const rows = [
      { studentId: "k", subject: "english", start: "2026-03-02", end: "2026-05-01", transferred: true },
      { studentId: "k", subject: "math", start: "2026-05-01", end: "2026-07-03", transferred: false },
    ];
    const pts = [{ key: "2026-07", label: "7월", date: "2026-07-31" }];
    expect(subjectTrendOf([july], enJuly, rows, pts, (x) => x === "math", "2026-10-20")[0]!.count).toBe(1);
    expect(subjectTrendOf([july], enJuly, rows, pts, (x) => x === "english", "2026-10-20")[0]!.count).toBe(0);
    const split = breakdownTrendOf([july], enJuly, rows, pts, ["math", "english"], (x) => x, "2026-10-20");
    expect(split.bySubject.math![0]!.count).toBe(1);
    expect(split.bySubject.english![0]!.count).toBe(0);
    expect(split.mix.mathOnly[0]!.count).toBe(1);
    expect(split.unknown[0]!.count).toBe(0);
    // 퇴원 과목 판정과 같은 14일 폭 — 영어가 6/28, 수학이 7/3에 끝났으면 둘 다(퇴원관리·KPI와 같은 과목, 적대 리뷰 2026-10-20).
    const both = [
      { studentId: "k", subject: "english", start: "2026-03-02", end: "2026-06-28", transferred: false },
      { studentId: "k", subject: "math", start: "2026-03-02", end: "2026-07-03", transferred: false },
    ];
    expect(subjectTrendOf([july], enJuly, both, pts, (x) => x === "english", "2026-10-20")[0]!.count).toBe(1);
    expect(breakdownTrendOf([july], enJuly, both, pts, ["math", "english"], (x) => x, "2026-10-20").mix.both[0]!.count).toBe(1);
  });
});

describe("billedTuitionMonths — 취소·환불 청구는 빼고 미납·부분 납부는 센다", () => {
  it("수업료 청구만 · 달 형식이 아닌 줄은 버리고 · 중복 없이 순서대로", () => {
    expect(
      billedTuitionMonths([
        { period: "2026-07", status: "void", category: "tuition" },
        { period: "2026-07", status: "refunded", category: "tuition" },
        { period: "2026-06", status: "paid", category: "tuition" },
        { period: "2026-05", status: "unpaid", category: "tuition" },
        { period: "2026-04", status: "partial", category: null },
        { period: "2026-03", status: "paid", category: "other" },
        { period: "2026-3", status: "paid", category: "tuition" },
        { period: null, status: "paid", category: "tuition" },
        { period: "2026-06", status: "paid", category: "tuition" },
      ]),
    ).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});
