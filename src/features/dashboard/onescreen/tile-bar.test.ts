import { describe, it, expect } from "vitest";
import {
  attendanceBar,
  attendanceBarTitle,
  normalizeSegments,
  paymentBar,
  paymentBarTitle,
} from "./tile-bar";

describe("normalizeSegments — 막대가 한 줄을 넘지 않는다", () => {
  it("🔴 반올림으로 100을 넘기지 않는다 — 넘치면 칸 높이가 밀린다", () => {
    const out = normalizeSegments([
      { key: "a", pct: 33.4, tone: "positive" },
      { key: "b", pct: 33.4, tone: "caution" },
      { key: "c", pct: 33.4, tone: "critical" },
    ]);
    expect(out.reduce((n, s) => n + s.pct, 0)).toBeLessThanOrEqual(100);
  });

  it("아주 작은 값도 최소 2%로 세운다 — '1건 남음'이 화면에서 사라지지 않게", () => {
    const out = normalizeSegments([
      { key: "big", pct: 99.6, tone: "positive" },
      { key: "tiny", pct: 0.4, tone: "critical" },
    ]);
    expect(out.find((s) => s.key === "tiny")?.pct).toBeGreaterThanOrEqual(2);
    expect(out.reduce((n, s) => n + s.pct, 0)).toBeLessThanOrEqual(100);
  });

  it("진짜 0은 조각을 만들지 않는다 — 없는 것을 그리지 않는다", () => {
    const out = normalizeSegments([
      { key: "a", pct: 100, tone: "positive" },
      { key: "b", pct: 0, tone: "critical" },
    ]);
    expect(out.map((s) => s.key)).toEqual(["a"]);
  });
});

describe("attendanceBar — 반 단위로 센다", () => {
  it("11개 반 중 9개 미기록", () => {
    const out = attendanceBar({ startedClasses: 11, unmarkedClasses: 9 });
    expect(out.map((s) => s.key)).toEqual(["recorded", "unmarked"]);
    expect(out.find((s) => s.key === "unmarked")!.pct).toBeGreaterThan(
      out.find((s) => s.key === "recorded")!.pct,
    );
  });

  it("🔴 시작한 반이 0이면 막대 없음 — 잴 것이 없는 것과 다 찍은 것은 다르다", () => {
    expect(attendanceBar({ startedClasses: 0, unmarkedClasses: 0 })).toEqual([]);
  });

  it("다 찍었으면 초록 하나", () => {
    const out = attendanceBar({ startedClasses: 5, unmarkedClasses: 0 });
    expect(out.map((s) => s.key)).toEqual(["recorded"]);
  });

  it("설명은 세 숫자의 관계를 말한다", () => {
    expect(attendanceBarTitle({ startedClasses: 11, unmarkedClasses: 9 })).toBe(
      "시작한 11개 반 중 2개 입력 · 9개 미기록",
    );
  });
});

describe("paymentBar — 건수 축", () => {
  it("2026-09 실측: 완납 311 · 부분납 26 · 미납 0", () => {
    const out = paymentBar({ paidCount: 311, partialCount: 26, fullyUnpaidCount: 0 });
    expect(out.map((s) => s.key)).toEqual(["paid", "partial"]);
    expect(out.reduce((n, s) => n + s.pct, 0)).toBeLessThanOrEqual(100);
  });

  it("전건이 0이면 막대 없음", () => {
    expect(paymentBar({ paidCount: 0, partialCount: 0, fullyUnpaidCount: 0 })).toEqual([]);
  });

  it("🔴 설명이 '건수 기준'임을 먼저 말한다 — 주숫자는 금액 기준이라 축이 다르다", () => {
    const t = paymentBarTitle({ paidCount: 311, partialCount: 26, fullyUnpaidCount: 0 });
    expect(t.startsWith("건수 기준")).toBe(true);
    expect(t).toContain("완납 311건");
    expect(t).toContain("부분납 26건");
    expect(t).not.toContain("미납 0건"); // 0은 안 적는다
  });
});
