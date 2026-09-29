import { describe, expect, it } from "vitest";
import { enrolledOn, monthlyPoints, yearlyPoints, type TrendStudent } from "./enrolled-trend";

const s = (id: string, status: string, enrolledAt: string | null, withdrawnAt: string | null = null): TrendStudent => ({ id, status, enrolledAt, withdrawnAt });

describe("재원생 추이 — 그날의 재원생(원장 2026-09-29)", () => {
  const students = [
    s("a", "enrolled", "2026-01-10"),
    s("b", "withdrawn", "2025-12-01", "2026-03-15"),
    s("c", "enrolled", "2026-09-01"), // 첫 수강이 10/1 — 아직 시작 전
    s("d", "on_hold", "2025-01-01"), // 휴원은 카드도 안 센다
    s("e", "prospect", "2025-01-01"),
    s("f", "enrolled", "2026-02-01", "2026-10-01"), // 퇴원 예약 — 그날 전까지 재원
    s("g", "withdrawn", "2025-01-01", "2026-07-10"), // 시스템 정리(수강 이력 없음) — 뺀다
  ];
  const first = new Map([["a", "2026-01-12"], ["b", "2025-12-02"], ["c", "2026-10-01"], ["f", "2026-02-02"]]);
  it("퇴원일 전까지·첫 수강 시작 뒤만 센다", () => {
    const en = { firstStart: first, ended: new Set<string>() };
    expect(enrolledOn(students, en, "2026-02-28")).toBe(3); // a b f
    expect(enrolledOn(students, en, "2026-03-15")).toBe(2); // 퇴원일 당일부터 빠진다
    expect(enrolledOn(students, en, "2026-09-29")).toBe(2); // c는 시작 전
    expect(enrolledOn(students, en, "2026-10-01")).toBe(2); // f 퇴원 · c 시작
  });
  it("병합으로 흡수된 학생은 빼고, 등록일이 빈 재원생은 센다(카드와 같게)", () => {
    const en = { firstStart: new Map<string, string>(), ended: new Set<string>() };
    const merged = { ...s("m", "withdrawn", "2025-07-15", "2026-07-07"), notes: "중복 병합: abc와 통합됨" };
    expect(enrolledOn([merged], en, "2026-01-01")).toBe(0);
    expect(enrolledOn([s("n", "enrolled", null)], en, "2026-09-29")).toBe(1);
  });
  it("월별 12칸 — 이번 달은 오늘, 연도별 — 올해는 오늘", () => {
    const m = monthlyPoints("2026-09-29");
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ key: "2025-10", date: "2025-10-31" });
    expect(m[11]).toMatchObject({ key: "2026-09", date: "2026-09-29" });
    expect(yearlyPoints("2026-09-29", 2025).map((p) => p.date)).toEqual(["2025-12-31", "2026-09-29"]);
  });
});
