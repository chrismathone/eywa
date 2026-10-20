import { describe, expect, it } from "vitest";
import { firstClassTrend } from "./first-class-trend";
import { resolveFirstClasses, type DayEnrollmentRow } from "@/features/dashboard/day-arrivals";
import { parseStatsPeriod } from "@/features/stats/period";

const subjects = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
];
const row = (studentId: string, startDate: string, subject: string, o: Partial<DayEnrollmentRow> = {}): DayEnrollmentRow => ({
  studentId,
  studentName: "",
  startDate,
  endDate: null,
  isTransferred: false,
  isTransferredIn: false,
  onHold: false,
  subject,
  ...o,
});
const TODAY = "2026-10-20";

describe("firstClassTrend — 첫 수업 추이", () => {
  const rows = [
    row("a", "2026-10-05", "math"), // 첫 등원
    row("b", "2026-03-02", "math"),
    row("b", "2026-10-05", "english"), // 새 과목
    row("c", "2026-03-02", "math"),
    row("c", "2026-10-06", "math"), // 같은 과목 반 추가 — 첫 수업 아님
    row("d", "2026-10-07", "english", { isTransferredIn: true }), // 반이동 — 아님
    row("e", "2026-10-20", "english"), // 오늘 첫 등원
    row("f", "2026-10-25", "math"), // 아직 안 온 날
  ];

  it("일별 — 운영실과 같은 판정(첫 등원 · 새 과목) · 오늘 칸 = resolveFirstClasses(오늘) · 오늘 뒤는 null", () => {
    const t = firstClassTrend({ rows, period: parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY), today: TODAY, subjects, trustFrom: "2026-04" });
    const at = (d: string) => t.keys.indexOf(d);
    expect([t.first[at("2026-10-05")], t.newSubject[at("2026-10-05")]]).toEqual([1, 1]);
    expect([t.first[at("2026-10-06")], t.newSubject[at("2026-10-06")], t.first[at("2026-10-07")]]).toEqual([0, 0, 0]);
    expect(t.first[at(TODAY)]).toBe(resolveFirstClasses(rows, TODAY, subjects).length);
    expect(t.keys.at(-1)).toBe(TODAY);
  });

  it("월별 = 날마다 센 수의 합 · 기록이 갖춰지기 전 달은 null · 과목 관리자는 그 과목 첫 수업만", () => {
    const t = firstClassTrend({ rows, period: parseStatsPeriod({}, TODAY), today: TODAY, subjects, trustFrom: "2026-04" });
    expect([t.first.at(-1), t.newSubject.at(-1)]).toEqual([2, 1]);
    expect(t.first[t.keys.indexOf("2026-03")]).toBeNull();
    const math = firstClassTrend({ rows, period: parseStatsPeriod({}, TODAY), today: TODAY, subjects, trustFrom: null, inScope: (s) => s === "math" });
    expect([math.first.at(-1), math.newSubject.at(-1)]).toEqual([1, 0]);
  });
});
