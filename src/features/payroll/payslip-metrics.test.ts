import { describe, expect, it } from "vitest";
import {
  formatWithdrawalRate,
  monthRange,
  monthsBetween,
  spanOverlapsMonth,
  studentIdsInMonth,
  withdrawalStats,
  yearlyClassMetrics,
  salaryScopedEnrollments,
  type EnrollSpanRow,
} from "./payslip-metrics";

it("개인별 특강 예외는 학생·반 수강별로 걸러 연 누적에 대상 밖 정규 수강이 섞이지 않는다", () => {
  const spans = [
    { student_id: "middle", class_id: "regular", startDate: "2026-01-01", endDate: null },
    { student_id: "middle", class_id: "special", startDate: "2026-09-01", endDate: "2026-09-19" },
    { student_id: "high", class_id: "regular", startDate: "2026-01-01", endDate: null },
  ];
  const grades = new Map([["middle", "중3"], ["high", "고1"]]);
  const classes = new Map([["regular", { className: "고등M 개별", isSpecial: false }], ["special", { className: "주말내신특강(중3) (~26.09.19)", isSpecial: false }]]);
  const filtered = salaryScopedEnrollments(spans, { levels: ["고등"], includeSpecial: true }, grades, classes);
  expect(filtered).toEqual([spans[1], spans[2]]);
  const yearly = yearlyClassMetrics(filtered.map((s) => ({ studentId: s.student_id, startDate: s.startDate, endDate: s.endDate })), 2026, "2026-10");
  expect(yearly.byMonth.find((m) => m.period === "2026-08")?.students).toBe(1);
  expect(yearly.byMonth.find((m) => m.period === "2026-09")?.students).toBe(2);
  expect(yearly.byMonth.find((m) => m.period === "2026-10")?.students).toBe(1);
  expect(salaryScopedEnrollments(spans, { levels: ["고등"] }, grades, classes)).toEqual([spans[2]]);
});

const span = (studentId: string, startDate: string, endDate: string | null = null): EnrollSpanRow => ({
  studentId,
  startDate,
  endDate,
});

describe("월 경계", () => {
  it("말일을 정확히 낸다(윤년 포함)", () => {
    expect(monthRange("2026-07")).toEqual({ first: "2026-07-01", last: "2026-07-31" });
    expect(monthRange("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ first: "2024-02-01", last: "2024-02-29" });
  });
});

describe("그 달에 수업이 살아 있었는가", () => {
  it("겹치기만 하면 포함 — 달 중간 시작·종료 전부", () => {
    expect(spanOverlapsMonth(span("a", "2026-07-15"), "2026-07")).toBe(true);
    expect(spanOverlapsMonth(span("a", "2026-01-01", "2026-07-02"), "2026-07")).toBe(true);
    expect(spanOverlapsMonth(span("a", "2026-01-01", null), "2026-07")).toBe(true);
  });

  it("🔑 종료일 당일까지 재원 — 1일에 끝나도 그 달에 포함된다", () => {
    expect(spanOverlapsMonth(span("a", "2026-01-01", "2026-07-01"), "2026-07")).toBe(true);
    // 하루 전(6/30)에 끝났으면 빠진다
    expect(spanOverlapsMonth(span("a", "2026-01-01", "2026-06-30"), "2026-07")).toBe(false);
  });

  it("달 이후에 시작한 수강은 빠진다", () => {
    expect(spanOverlapsMonth(span("a", "2026-08-01"), "2026-07")).toBe(false);
    // 말일에 시작하면 포함
    expect(spanOverlapsMonth(span("a", "2026-07-31"), "2026-07")).toBe(true);
  });
});

describe("수업인원", () => {
  it("같은 학생이 여러 반이어도 1명", () => {
    const rows = [span("a", "2026-01-01"), span("a", "2026-01-01"), span("b", "2026-01-01")];
    expect(studentIdsInMonth(rows, "2026-07").sort()).toEqual(["a", "b"]);
  });

  it("재등록으로 구간이 갈려 있어도 1명", () => {
    const rows = [span("a", "2026-01-01", "2026-03-31"), span("a", "2026-07-01")];
    expect(studentIdsInMonth(rows, "2026-07")).toEqual(["a"]);
    expect(studentIdsInMonth(rows, "2026-05")).toEqual([]);
  });
});

describe("월 목록", () => {
  it("경계 포함", () => {
    expect(monthsBetween("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthsBetween("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthsBetween("2026-05", "2026-05")).toEqual(["2026-05"]);
  });

  it("역순이면 빈 배열", () => {
    expect(monthsBetween("2026-05", "2026-01")).toEqual([]);
  });
});

describe("연 누적 지표", () => {
  it("누적은 고유 학생 수, 평균은 **수업이 있었던 달만**", () => {
    // 1월 2명(a,b) · 2월 3명(a,b,c) · 3월 이후 없음
    const rows = [
      span("a", "2026-01-01", "2026-02-28"),
      span("b", "2026-01-01", "2026-02-28"),
      span("c", "2026-02-01", "2026-02-28"),
    ];
    const m = yearlyClassMetrics(rows, 2026, "2026-06");
    expect(m.cumulativeStudents).toBe(3);
    expect(m.averageStudents).toBe(2.5); // (2+3)/2 — 3~6월 0은 분모에서 제외
    expect(m.byMonth.map((x) => x.students)).toEqual([2, 3, 0, 0, 0, 0]);
  });

  it("0인 달을 분모에 넣지 않는다 — 연초에 뽑아도 평균이 안 무너진다", () => {
    const rows = [span("a", "2026-01-01"), span("b", "2026-01-01")];
    // 12월까지 조회해도 평균은 여전히 2 (그 달들도 재원이므로 전부 2)
    expect(yearlyClassMetrics(rows, 2026, "2026-12").averageStudents).toBe(2);
  });

  it("수업이 아예 없으면 평균 0 (NaN이 새지 않는다)", () => {
    const m = yearlyClassMetrics([], 2026, "2026-07");
    expect(m.averageStudents).toBe(0);
    expect(m.cumulativeStudents).toBe(0);
  });
});

describe("퇴원 지표", () => {
  const students = ["s1", "s2", "s3"];

  it("그 달 퇴원만 세고 명단은 가나다순", () => {
    const w = withdrawalStats(
      [
        { studentId: "s1", name: "이윤", withdrawnAt: "2026-07-14" },
        { studentId: "s2", name: "김채은", withdrawnAt: "2026-07-02" },
        { studentId: "s3", name: "박아무개", withdrawnAt: "2026-06-30" }, // 지난달 → 제외
      ],
      students,
      "2026-07",
      [],
    );
    expect(w.count).toBe(2);
    expect(w.names).toEqual(["김채은", "이윤"]);
    expect(w.rate).toBeCloseTo(2 / 3);
  });

  it("🔴 시스템 일괄 도장일(2026-07-10)은 세지 않고 몇 명인지 밝힌다", () => {
    const w = withdrawalStats(
      [
        { studentId: "s1", name: "실제퇴원", withdrawnAt: "2026-07-14" },
        { studentId: "s2", name: "일괄도장", withdrawnAt: "2026-07-10" },
      ],
      students,
      "2026-07",
      ["2026-07-10", "2026-07-03"],
    );
    expect(w.count).toBe(1);
    expect(w.names).toEqual(["실제퇴원"]);
    expect(w.unknownDateCount).toBe(1);
  });

  it("이 강사에게 안 배우던 학생은 세지 않는다", () => {
    const w = withdrawalStats(
      [{ studentId: "outsider", name: "남의반", withdrawnAt: "2026-07-14" }],
      students,
      "2026-07",
      [],
    );
    expect(w.count).toBe(0);
  });

  it("같은 학생이 중복으로 들어와도 1명", () => {
    const w = withdrawalStats(
      [
        { studentId: "s1", name: "이윤", withdrawnAt: "2026-07-14" },
        { studentId: "s1", name: "이윤", withdrawnAt: "2026-07-14" },
      ],
      students,
      "2026-07",
      [],
    );
    expect(w.count).toBe(1);
  });

  it("수업인원이 0이면 율은 null — 0%로 지어내지 않는다", () => {
    const w = withdrawalStats([], [], "2026-07", []);
    expect(w.rate).toBeNull();
    expect(formatWithdrawalRate(w.rate)).toBe("—");
  });

  it("율 표기는 시트와 같은 소수 둘째 자리", () => {
    expect(formatWithdrawalRate(0.06)).toBe("6.00%"); // 시트 김은정 26.07 실측
    expect(formatWithdrawalRate(3 / 51)).toBe("5.88%");
  });
});
